import type { Plugin } from "@opencode-ai/plugin"
import { hostname } from "node:os"

/**
 * Fleet status plugin — the opencode counterpart to the Claude Code
 * `fleet-status.sh` hook (~/.claude/hooks/fleet-status.sh). Both exist so the
 * Orchestrator agent's "Fleet status reporting" contract (see
 * ~/.config/opencode/agents/orchestrator.md) gets a harness-enforced floor
 * instead of depending entirely on the model remembering to POST before
 * every blocking call.
 *
 * Mapping (verified against @opencode-ai/plugin's Hooks type, not scraped
 * docs — opencode has no direct AskUserQuestion/ExitPlanMode/SessionStart
 * analogs, but does expose these ground-truth equivalents):
 *   - Claude Code SessionStart      -> event "session.created"
 *   - Claude Code UserPromptSubmit  -> hook "chat.message"
 *   - Claude Code PreToolUse(AskUserQuestion) -> hook "tool.execute.before"
 *     matched on tool === "question" (opencode's built-in equivalent tool)
 *   - Claude Code ExitPlanMode      -> no opencode analog found; not covered
 *
 * Best-effort only: no-ops silently if AGENT_STATUS_SERVICE_URL isn't set,
 * and a failed/slow POST never throws or blocks a hook — `fetch` is fired
 * and its result is deliberately not awaited by callers.
 */

const STATUS_URL = process.env.AGENT_STATUS_SERVICE_URL

type FleetState = "working" | "waiting" | "stopped"

function post(state: FleetState, description: string): void {
  if (!STATUS_URL) return
  try {
    const identifier = hostname()
    void fetch(`${STATUS_URL.replace(/\/$/, "")}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, state, description }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // best-effort only; a dead/slow status endpoint must never break a hook
    })
  } catch {
    // never let a status-reporting failure affect the actual session
  }
}

// Delegated subagent work runs as its own opencode session under the hood.
// Track the root (non-subagent) session so a subagent's own message/tool
// activity never resets or masks the primary orchestrator's dashboard row —
// mirrors "a running subagent is not a `waiting` trigger by itself" from the
// orchestrator's Fleet status reporting contract.
let rootSessionID: string | undefined

export const FleetStatusPlugin: Plugin = async () => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.created") return
      const info = event.properties.info
      if (info.parentID) return // subagent session — not the root, ignore
      rootSessionID = info.id
      post("stopped", "idle")
    },

    "chat.message": async (input) => {
      if (rootSessionID && input.sessionID !== rootSessionID) return
      post("working", "resumed")
    },

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "question") return
      if (rootSessionID && input.sessionID !== rootSessionID) return
      // Defensive extraction: the built-in `question` tool's exact arg shape
      // isn't published in the type packages available locally. Handle both
      // a single question object and an array of them (Claude Code's
      // AskUserQuestion, which this tool mirrors, uses the array form).
      const args: any = output?.args ?? {}
      const first = Array.isArray(args.questions) ? args.questions[0] : args
      const label = first?.header ?? first?.question ?? "user input"
      post("waiting", `waiting: ${String(label).slice(0, 80)}`)
    },
  }
}
