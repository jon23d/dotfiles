import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import type { HarnessAdapter, HarnessSessionHandle } from './harness.js';
import type { Logger } from './logger.js';

/**
 * The opencode adapter (KAN-5). Live-verified against a real local
 * `opencode serve` (v1.18.18) rather than guessed from docs alone -- see the
 * KAN-5 report for exactly what was checked. The one finding that shapes
 * this whole module: `POST /session` and `POST /session/:id/prompt_async`
 * both accept an optional `?directory=` query parameter, and a single
 * running `opencode serve` instance happily serves sessions across many
 * different directories through it (its own on-disk session store is global,
 * not scoped to whatever `--cwd` the server itself was started in). That
 * means this harness spawns **one shared `opencode serve` process total**
 * (lazily, on the first `start()`), not one process per session -- cheaper,
 * no per-session port/readiness overhead, and it matches how opencode
 * itself already models "sessions across projects."
 *
 * Consequence: a session's `stop()` must delete only that one opencode
 * session (`DELETE /session/:id`) and must NOT touch the shared process --
 * killing it would take every other session down too. Only a full daemon
 * shutdown (out of scope here) should ever kill the shared child.
 */

/** Minimal surface of node:child_process's ChildProcess this module needs --
 * same DI convention as socketClient.ts's WebSocketLike: real `spawn()`
 * output satisfies this structurally, tests supply a fake. */
export interface SpawnedProcessLike {
  readonly stderr: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  /** The OS pid of the spawned process, when known (KAN-12: used by
   * `verifyGeneralEnvironmentAvailable` to read the child's real environment from
   * `/proc/<pid>/environ`). Real `node:child_process.spawn()` output always has this; test
   * doubles may supply a fake pid that has no corresponding `/proc` entry, which is exactly
   * the "unreadable" case that check degrades gracefully on rather than treating as fatal. */
  readonly pid?: number | undefined;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(): void;
}

export interface OpencodeHarnessConfig {
  spawnProcess?: (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => SpawnedProcessLike;
  pickPort?: () => Promise<number>;
  fetchImpl?: typeof fetch;
  /** How long to wait for `opencode serve` to report healthy before giving up. */
  readyTimeoutMs?: number;
  readyPollIntervalMs?: number;
  /** Reads the real, resolved environment of the spawned child by pid (KAN-12), used by
   * `verifyGeneralEnvironmentAvailable` to confirm the zsh-wrapper fix actually took effect for
   * this particular spawn, not just that the wrapper command was constructed correctly. Defaults
   * to reading `/proc/<pid>/environ` (Linux-only, consistent with this daemon's existing
   * Linux-only deployment assumption -- see the install script's own `uname` guard). Injectable
   * so tests can simulate both a genuinely-missing var (inject a fake resolving without it) and
   * an unreadable environment (the real default, against a test double's fake pid, which has no
   * corresponding `/proc` entry -- see `fakeChildProcess`'s doc comment in the test file). */
  readChildEnviron?: (pid: number) => Promise<Record<string, string>>;
}

/**
 * Marks the shared `opencode serve` process (and every session running under
 * it) as daemon-managed (KAN-7 review kan7-2 F4). Without this, nothing lets
 * an in-session agent tell "am I running under the control-plane daemon or a
 * plain interactive `opencode` session" -- orchestrator.md's rename-on-pickup
 * instruction names this exact variable so the condition is actually
 * checkable, not just described. Set once on the shared process, not
 * per-session: every session this harness creates runs under it by
 * construction (KAN-5's one-shared-process design), so there's no per-session
 * variant to track.
 */
export const CONTROL_PLANE_DAEMON_ENV_VAR = 'CONTROL_PLANE_DAEMON';

/**
 * Who the operator is (KAN-10), delivered the exact same way as
 * `CONTROL_PLANE_DAEMON_ENV_VAR` above and for the same reason: the operator
 * is genuinely process-wide (one operator per VM, per this whole epic's
 * design -- see startCommand.ts's `StartDeps.operatorUserId`, resolved once
 * at daemon startup by resolveDmChannel.ts), so it fits the shared-process
 * env var pattern with no per-session complication. Set once, at spawn --
 * every session on this shared server sees the same operator by
 * construction, so there is no per-session variant to track (identical
 * reasoning to `CONTROL_PLANE_DAEMON_ENV_VAR`'s own doc comment).
 */
export const MATTERMOST_OPERATOR_USER_ID_ENV_VAR = 'MATTERMOST_OPERATOR_USER_ID';

/**
 * The key an in-session agent finds its own session's Mattermost channel id
 * under (KAN-10), once it sources `SESSION_ENV_FILE_NAME` from its own
 * working directory. NOT a process env var like the two constants above --
 * deliberately can't be, since a session's channel id is inherently
 * per-session while every session on this harness shares one `opencode
 * serve` process (KAN-5). See `provisionChannelId`'s doc comment on
 * `HarnessSessionHandle` (harness.ts) for the full investigation: opencode's
 * `POST /session` and `POST /session/:id/prompt_async` request schemas (live
 * -checked via a real server's `GET /doc`, opencode 1.18.18) have no `env`
 * field anywhere, and the `Session` response schema has no `env` property
 * either -- only an arbitrary `metadata` bag that's retrievable via the API,
 * not injected into the bash tool's subprocess env. A live round-trip
 * against that same server confirmed the bash tool's cwd is exactly the
 * session's own `directory`, and that a file placed there beforehand is
 * readable from a relative path -- so this uses that instead, needing no
 * opencode cooperation at all.
 */
export const MATTERMOST_SESSION_CHANNEL_ID_ENV_VAR = 'MATTERMOST_SESSION_CHANNEL_ID';

/**
 * Filename `provisionChannelId` writes into a session's own folder (KAN-10).
 * Hidden (dot-prefixed) so it doesn't clutter a directory listing of the
 * project the agent is actually working in. Shell-sourceable
 * (`export KEY='value'` lines) rather than a bare value or JSON, since each
 * bash-tool invocation is its own fresh subprocess (proven by
 * `CONTROL_PLANE_DAEMON_ENV_VAR` needing to live on the *parent* process's
 * env in the first place, rather than being exportable once and persisting
 * across calls) -- `source`-ing this file is a one-line, well-known,
 * zero-guesswork way for the agent to load these values into whichever
 * shell invocation actually needs them.
 */
export const SESSION_ENV_FILE_NAME = '.control-plane-session-env';

/**
 * Ignore pattern `ensureSessionEnvFileGitignored` writes into a session's
 * folder's own `.gitignore` (review kan10-1 F3). Covers `SESSION_ENV_FILE_NAME`
 * itself and its transient `.tmp-<pid>-<uuid>` write-siblings (see the atomic
 * write in `provisionChannelId` below) with one glob, rather than needing a
 * second entry for the tmp path pattern.
 */
const SESSION_ENV_GITIGNORE_ENTRY = `${SESSION_ENV_FILE_NAME}*`;

/**
 * Single-quotes `value` for safe embedding in a POSIX shell `export`
 * statement, escaping any embedded single quote the standard way
 * (`'...'\''...'`) -- the same defensive posture as startCommand.ts's
 * `stripBackticks` for backtick-quoted spans (kan7-1 F1 and friends): a
 * channel id is Mattermost-controlled, not something this daemon should
 * ever trust blindly when writing it into a file another process will
 * `source`.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

/**
 * Best-effort: adds `SESSION_ENV_GITIGNORE_ENTRY` to the session's own
 * folder's own `.gitignore` (review kan10-1 F3). `folder` is the operator's
 * actual project directory (the `folder` argument to `start <harness>
 * <folder>`), not a daemon-owned location -- nothing otherwise stops an
 * ordinary `git add -A`/`git commit -a` run by the agent or operator working
 * in that folder from committing the session's Mattermost channel id into
 * the project's own git history. Idempotent (checks for an existing
 * identical entry first) and never throws -- failure here is logged and
 * swallowed rather than propagated, since this is a defense-in-depth nicety
 * around `provisionChannelId`'s actual job, not the loud-on-failure delivery
 * of the channel id itself (that's the `writeFile`/`rename` below); a folder
 * this can't be written to for some unrelated reason (e.g. no `.gitignore`
 * write permission) shouldn't block the session from working.
 */
async function ensureSessionEnvFileGitignored(folder: string, logger: Logger): Promise<void> {
  const gitignorePath = join(folder, '.gitignore');
  try {
    let existing = '';
    try {
      existing = await readFile(gitignorePath, 'utf8');
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
    }
    if (existing.split('\n').some((line) => line.trim() === SESSION_ENV_GITIGNORE_ENTRY)) return; // already present
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    const addition = `${separator}# control-plane-daemon (KAN-10): this session's own Mattermost channel id -- never commit it\n${SESSION_ENV_GITIGNORE_ENTRY}\n`;
    await writeFile(gitignorePath, existing + addition, 'utf8');
  } catch (err) {
    logger.error("failed to add the session-env marker file to this folder's .gitignore (best-effort, ignored)", {
      err,
      folder,
    });
  }
}

/**
 * The identifier opencode's `agent` fields need to select the orchestrator
 * agent (KAN-9). Live-verified against a real local `opencode serve`
 * (1.18.18), not assumed:
 *   - `opencode agent list` and `GET /agent` both resolve the agent by its
 *     frontmatter `name:` field (`dot_config/opencode/agents/orchestrator.md`
 *     has `name: Orchestrator`) -- NOT the `orchestrator.md` filename stem.
 *     `GET /agent` against this machine's real config echoes back exactly
 *     `"name": "Orchestrator"`.
 *   - Agent configs are discovered from the global `~/.config/opencode/agents/`
 *     directory and are available to every session regardless of that
 *     session's own `?directory=` -- confirmed by calling `GET
 *     /agent?directory=<dir-with-no-local-.opencode-config>` and seeing
 *     "Orchestrator" in the list anyway. So there is no per-session-folder
 *     discoverability concern to handle here.
 *   - `POST /session` does NOT validate this value: `{"agent":
 *     "totally-bogus-name"}` is accepted with a 200 and echoed straight back
 *     in the response, so a bad value can't be caught from that response
 *     alone -- see `verifyOrchestratorAgentAvailable` below, which checks
 *     `GET /agent` itself instead.
 *   - Bigger finding, live-verified end to end: `POST /session`'s `agent`
 *     field is NOT what actually selects the agent that runs a message. It's
 *     essentially cosmetic for this headless/API-driven flow. What actually
 *     matters is the *separate*, independent `agent` field on `POST
 *     /session/:id/prompt_async` -- proven by creating a real session with
 *     `agent: "Orchestrator"`, sending a prompt via `prompt_async` with no
 *     `agent` field on that call, and inspecting the resulting message via
 *     `GET /session/:id/message`: `info.agent` came back `"build"` (opencode's
 *     own default), completely ignoring what the session was created with.
 *     Re-sending the identical prompt with `agent: "Orchestrator"` also set
 *     on the `prompt_async` body flipped `info.agent` to `"Orchestrator"`.
 *     That is exactly the silent-fallback failure mode this epic's "never
 *     fail silently" principle forbids, and it means both `createSession`
 *     (this session's declared default) and `sendPrompt` (what actually runs)
 *     must send this field -- setting it in only one place looks correct but
 *     silently doesn't work.
 */
export const ORCHESTRATOR_AGENT_NAME = 'Orchestrator';

/**
 * Defense-in-depth model pin (KAN-13). `dot_config/opencode/opencode.jsonc`
 * declares several models under the `litellm` provider but -- until this
 * fix -- pinned no default. With no `model` field on either `POST /session`
 * or `POST /session/:id/prompt_async`, opencode's own default-model
 * resolution silently picked `small-model` (4096-token context), which the
 * Orchestrator agent's system prompt + MCP tool schemas (14,400-63,000
 * tokens depending on config) always overflows on the very first turn --
 * LiteLLM correctly rejects the oversized request, and opencode's
 * compaction/auto-continue handler loops forever trying to shrink
 * conversation history that isn't the actual oversized part (full root
 * cause: `.agent/research-kan13.md`). Sending this field explicitly on both
 * calls means the daemon no longer depends solely on opencode.jsonc's
 * default resolution -- a future config regression there degrades back to
 * "wrong model" at worst, not "silent infinite loop."
 *
 * `POST /session` and `POST /session/:id/prompt_async` were confirmed via a
 * live server's `GET /doc` (opencode 1.18.18) to each accept `model` with a
 * *different* shape -- do not assume they match:
 *   - `POST /session`: `{ id: string, providerID: string, variant?: string }`
 *     (required: `id`, `providerID`)
 *   - `POST /session/:id/prompt_async`: `{ providerID: string, modelID: string }`
 *     (required: `providerID`, `modelID`) -- note `modelID`, not `id`.
 *
 * `ORCHESTRATOR_MODEL_ID` ('deepseek-v4-pro') was confirmed live against
 * LiteLLM's real proxy (`GET {LITELLM_URL}/models` and `GET
 * {LITELLM_URL}/model/info`, 2026-08-17) -- 1,000,000-token input context,
 * 8,192-token max output, routed to the real DeepSeek API
 * (`custom_llm_provider: "deepseek"`), not the local LM Studio backend the
 * other `litellm`-provider models here use. Matches the same model now
 * pinned as opencode.jsonc's top-level default (`"model":
 * "litellm/deepseek-v4-pro"`) -- update both together if this ever changes.
 */
export const ORCHESTRATOR_MODEL_PROVIDER_ID = 'litellm';
export const ORCHESTRATOR_MODEL_ID = 'deepseek-v4-pro';

const agentListSchema = z.array(z.object({ name: z.string() }).passthrough());

/**
 * Confirms opencode actually has an agent named `ORCHESTRATOR_AGENT_NAME`
 * before this harness will create any session against it (KAN-9). Runs once
 * per shared server, right after the health-check loop in
 * `spawnSharedServer` -- same lifetime as the health check itself, not
 * per-session -- because the agent list is server-global config (see the doc
 * comment on `ORCHESTRATOR_AGENT_NAME`), not something that varies per
 * session folder. A missing/wrong agent throws here, loudly, and that
 * rejection propagates out of `spawnSharedServer` exactly like a failed
 * health check does -- there is no code path that lets `start()` succeed
 * while quietly running under the wrong agent.
 */
async function verifyOrchestratorAgentAvailable(baseUrl: string, fetchImpl: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/agent`);
  } catch (cause) {
    throw new Error(
      `failed to verify opencode's "${ORCHESTRATOR_AGENT_NAME}" agent is available (GET /agent unreachable): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable body>');
    throw new Error(
      `failed to verify opencode's "${ORCHESTRATOR_AGENT_NAME}" agent is available: GET /agent returned ${res.status} ${res.statusText} - ${text}`,
    );
  }
  const parsed = agentListSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`opencode's GET /agent returned an unexpected response shape: ${JSON.stringify(parsed.error.issues)}`);
  }
  const found = parsed.data.some((agent) => agent.name === ORCHESTRATOR_AGENT_NAME);
  if (!found) {
    const available = parsed.data.map((agent) => agent.name).join(', ') || '<none>';
    throw new Error(
      `opencode has no agent named "${ORCHESTRATOR_AGENT_NAME}" (checked GET /agent) -- refusing to create sessions rather than silently falling back to opencode's own default agent. Available agents: ${available}`,
    );
  }
}

/**
 * The env var `verifyGeneralEnvironmentAvailable` checks for in the spawned child's real,
 * resolved environment (KAN-12). Chosen as the sentinel because it's literally the reported
 * symptom and a reliable proxy for "configs.env was sourced" -- `dot_config/configs.env` today
 * only defines `TOOLSETS` and `MATTERMOST_MCP_URL`, and the latter is the one every downstream
 * MCP consumer (`dot_config/opencode/opencode.jsonc`'s `mattermost` MCP server,
 * `{env:MATTERMOST_MCP_URL}`) actually depends on.
 */
const MATTERMOST_MCP_URL_ENV_VAR = 'MATTERMOST_MCP_URL';

/**
 * Reads a spawned process's real, resolved environment by pid (KAN-12), from
 * `/proc/<pid>/environ` -- a NUL-separated sequence of `KEY=value` records. Linux-only, same
 * assumption the rest of this daemon's deployment already makes (the install script's own
 * `[ "$(uname)" = "Linux" ] || exit 0` guard). Deliberately the *default*, not the only,
 * implementation -- `OpencodeHarnessConfig.readChildEnviron` exists precisely so this can be
 * swapped out, and so a rejection from it (ENOENT, permission denied, non-Linux, or a test
 * double's fake pid with no real `/proc` entry) is a normal, expected outcome for
 * `verifyGeneralEnvironmentAvailable` to catch and degrade gracefully on, not a bug in this
 * function.
 */
async function defaultReadChildEnviron(pid: number): Promise<Record<string, string>> {
  const raw = await readFile(`/proc/${pid}/environ`, 'utf8');
  const environ: Record<string, string> = {};
  for (const entry of raw.split('\0')) {
    if (entry.length === 0) continue; // trailing NUL leaves one empty entry after the split
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) continue; // defensive -- every real /proc/<pid>/environ record has one
    environ[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
  }
  return environ;
}

/**
 * Confirms the spawned `opencode serve` child's *real, resolved* environment actually contains
 * `MATTERMOST_MCP_URL` (KAN-12) -- i.e. that the zsh-wrapper fix genuinely worked for this
 * particular spawn (configs.env was sourced), not merely that the wrapper command was
 * constructed correctly. Runs once per shared server, same lifecycle as
 * `verifyOrchestratorAgentAvailable` (after the health-check loop succeeds, before
 * `spawnSharedServer` returns).
 *
 * Two distinct outcomes, deliberately different severities -- this is the load-bearing design
 * decision here, confirmed with the ticket's own author before implementation:
 *   - The environment was read successfully and the var is genuinely absent -> throw, and the
 *     caller kills the child. Same "never limp along" posture as
 *     `verifyOrchestratorAgentAvailable` for a *confirmed* misconfiguration, not a merely
 *     suspected one.
 *   - The environment could not be read at all (ENOENT, permission, non-Linux, or a test
 *     double's fake pid with no real `/proc` entry) -> `logger.warn` and continue, not throw.
 *     Unlike the HTTP-reachable `GET /agent` check, `/proc` reads are inherently
 *     environment-fragile (containers, non-Linux dev boxes, sandboxes, tests) -- treating
 *     "couldn't check" as fatal would make the daemon brittle in exactly the kind of edge case
 *     this codebase elsewhere goes out of its way to tolerate gracefully (e.g.
 *     `ensureSessionEnvFileGitignored`'s best-effort posture). Still loud (a `warn` line lands
 *     in journald, not silence) -- just not fatal. This also means the ~30 other existing tests
 *     that reach `spawnSharedServer` via `fakeChildProcess()`'s fake pid don't need to be
 *     touched for this check at all: none of them have a real `/proc` entry, so the default
 *     `readChildEnviron` hits this warn-and-continue branch, not the throw branch.
 */
async function verifyGeneralEnvironmentAvailable(
  child: SpawnedProcessLike,
  readChildEnviron: (pid: number) => Promise<Record<string, string>>,
  logger: Logger,
): Promise<void> {
  if (child.pid === undefined) {
    logger.warn(
      "could not verify the spawned opencode serve child's real environment (KAN-12): the spawned process handle has no pid -- continuing without this check",
    );
    return;
  }
  let environ: Record<string, string>;
  try {
    environ = await readChildEnviron(child.pid);
  } catch (err) {
    logger.warn(
      "could not read the spawned opencode serve child's real /proc/<pid>/environ (KAN-12) -- non-Linux, a permissions issue, or a test double's fake pid all produce this; continuing without this check",
      { pid: child.pid, err },
    );
    return;
  }
  if (!(MATTERMOST_MCP_URL_ENV_VAR in environ)) {
    throw new Error(
      `the spawned opencode serve child's real environment is missing ${MATTERMOST_MCP_URL_ENV_VAR} -- this means ` +
        `~/.config/configs.env was NOT actually sourced into it (check that the file exists and that ` +
        `dot_config/zsh/rc.sh is still sourcing it correctly), which would otherwise surface later only as a ` +
        `silent, confusing "mattermost" MCP connection failure inside a spawned session instead of this explicit one`,
    );
  }
}

function defaultSpawn(command: string, args: string[], options: { cwd: string; env: Record<string, string> }): SpawnedProcessLike {
  return nodeSpawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('failed to pick a free port for opencode serve: unexpected address type'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function validateFolder(folder: string): Promise<void> {
  let info;
  try {
    info = await stat(folder);
  } catch (cause) {
    throw new Error(`folder "${folder}" is not accessible: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
  if (!info.isDirectory()) {
    throw new Error(`folder "${folder}" is not a directory`);
  }
}

const sessionSchema = z.object({ id: z.string().min(1), title: z.string().optional() }).passthrough();

// The `/event` SSE stream (KAN-7) carries every event type opencode emits
// (message parts, permissions, session lifecycle, ...) -- this only
// describes the one shape this module cares about, `session.updated`.
// `safeParse`-ing every frame against it and silently ignoring a mismatch is
// the correct behavior for the other event types, not an error condition.
const sessionUpdatedEventSchema = z
  .object({
    type: z.literal('session.updated'),
    properties: z.object({
      sessionID: z.string().min(1),
      info: z.object({ title: z.string() }).passthrough(),
    }),
  })
  .passthrough();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upper bound on how long any *single* `/global/health` poll attempt inside `spawnSharedServer`
 * is allowed to hang before it's aborted and the loop moves on to its next attempt. Fixes a
 * live-diagnosed incident from KAN-12's own verification: a real, genuinely healthy `opencode
 * serve` process (`curl .../global/health` kept responding in milliseconds throughout) got
 * killed because one `fetchImpl()` call inside the readiness loop hung for ~318s -- consistent
 * with Node/undici's default fetch timeouts (headersTimeout/bodyTimeout, 300_000ms) -- while the
 * loop's own blanket `catch { keep polling }` silently absorbed it, having been written assuming
 * every failure here is a fast connection-refused error, never a genuinely slow/hung request.
 * The loop's `deadline` was (and still is) only checked *between* attempts, so nothing bounded
 * that one call, and it blew straight through the intended `readyTimeoutMs` budget on its own.
 *
 * Real `opencode serve`, once actually listening, answers `/global/health` in about a second
 * (live-verified) -- a couple of seconds is ample headroom for one live attempt while still
 * failing far faster than undici's 300s default. This is deliberately a robustness bound
 * *inside* `readyTimeoutMs`'s own budget, not a second, competing deadline: the call site below
 * also clamps it to whatever's left of that budget, so a small `readyTimeoutMs` (as several
 * existing tests use) still gives up close to its own configured value, never later.
 */
const HEALTH_CHECK_ATTEMPT_TIMEOUT_MS = 2_000;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Per-session rename-detection state (KAN-7), keyed by opencode session id.
 * `lastTitle` seeds from the title opencode assigned at session creation
 * (its placeholder `New session - <timestamp>` default) so that placeholder
 * never itself counts as a "rename"; only a later, *different* title --
 * meaning the agent explicitly set one via `PATCH /session/:id` -- does.
 * Live-verified (2026-08-16, opencode 1.18.18) that opencode does NOT
 * auto-rewrite this title from conversation content on its own: a real
 * prompt/response round-trip against a real model left the title completely
 * unchanged, so a `session.updated` title change is a safe, deliberate
 * signal, not something ordinary conversation could trigger by accident.
 */
interface RenameState {
  lastTitle: string;
  callbacks: Array<(identifier: string) => void>;
}

function handleRawSseFrame(rawEvent: string, renameState: Map<string, RenameState>, logger: Logger): void {
  const dataLines = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (dataLines.length === 0) return; // e.g. a bare comment/keepalive frame

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
  } catch (cause) {
    logger.error('failed to parse an opencode event-stream frame as JSON -- ignored, stream keeps reading', {
      cause,
      rawEvent,
    });
    return;
  }

  const event = sessionUpdatedEventSchema.safeParse(parsed);
  if (!event.success) return; // most frames on this stream aren't session.updated -- expected, not an error

  const { sessionID, info } = event.data.properties;
  const state = renameState.get(sessionID);
  if (!state) return; // a session this harness isn't tracking (e.g. opened via the opencode TUI directly)
  if (info.title === state.lastTitle) return; // no real change (e.g. a cost/tokens-only update replaying the same title)

  state.lastTitle = info.title;
  for (const cb of state.callbacks) cb(info.title);
}

/** Owns the single shared `opencode serve` process (spawned lazily) and every
 * live session handle created against it. Exit callbacks are fanned out to
 * every handle when the shared process dies, since KAN-5's live testing
 * confirmed the process isn't scoped to one directory -- one death takes
 * every session using it down at once. */
interface SharedServer {
  baseUrl: string;
  exited: boolean;
  exitCode: number | null;
  exitCallbacks: Array<(info: { code: number | null }) => void>;
  child: SpawnedProcessLike;
  /** Rename-detection state (KAN-7), one entry per session this harness
   * started on this shared server, keyed by opencode session id. */
  renameState: Map<string, RenameState>;
  /** Guards the `/event` SSE subscription (KAN-7) to open at most once per
   * shared server, lazily, the first time any session registers an
   * `onRename` callback -- sessions that never use the rename feature never
   * pay for it. */
  eventStreamStarted: boolean;
}

export function createOpencodeHarness(config: OpencodeHarnessConfig = {}): HarnessAdapter {
  const {
    spawnProcess = defaultSpawn,
    pickPort = pickFreePort,
    fetchImpl = fetch,
    readyTimeoutMs = 10_000,
    readyPollIntervalMs = 150,
    readChildEnviron = defaultReadChildEnviron,
  } = config;

  // Caches the in-flight *promise*, not just its resolved value (review
  // kan5-1 F1). `ensureSharedServer` used to check-then-await-then-assign a
  // plain `shared` variable, and the `await pickPort()` in between yielded
  // the event loop -- daemon.ts dispatches incoming posts fire-and-forget
  // (never serialized), so two `start` commands arriving close together
  // could both observe "no shared server yet" and each spawn their own
  // `opencode serve` child, silently leaking one. Setting `sharedPromise`
  // synchronously, before any `await`, closes that window: a second
  // concurrent caller always finds the in-progress promise already cached
  // and awaits that instead of racing a second spawn.
  let sharedPromise: Promise<SharedServer> | undefined;

  function notifyExit(server: SharedServer, code: number | null): void {
    server.exited = true;
    server.exitCode = code;
    for (const cb of server.exitCallbacks.splice(0)) cb({ code });
  }

  async function spawnSharedServer(logger: Logger, operatorUserId: string): Promise<SharedServer> {
    const port = await pickPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // KAN-12: spawn through an interactive zsh shell rather than invoking the `opencode`
    // binary directly. Systemd user services never source ~/.zshrc / dot_config/zsh/rc.sh /
    // dot_config/configs.env, so anything that normally comes from an interactive shell
    // (MATTERMOST_MCP_URL today, anything else configs.env grows tomorrow) was invisible to
    // every session this harness spawned -- silently breaking opencode.jsonc's `mattermost`
    // MCP server (`{env:MATTERMOST_MCP_URL}`). `zsh -ic 'exec opencode serve ...'` makes the
    // child inherit whatever an ordinary interactive shell picks up, by construction, instead
    // of the daemon hand-forwarding individual env vars one at a time (the exact failure mode
    // CONTROL_PLANE_DAEMON_ENV_VAR/MATTERMOST_OPERATOR_USER_ID_ENV_VAR below are a *deliberate*
    // exception to, since those two are genuinely daemon-only facts no rc file could ever
    // produce). Live-confirmed on this host: `env CONTROL_PLANE_DAEMON=1
    // MATTERMOST_OPERATOR_USER_ID=<id> zsh -ic 'exec env' </dev/null` shows both vars intact
    // alongside MATTERMOST_MCP_URL and a correctly-extended PATH -- rc.sh/aliases.sh/prompt.zsh
    // contain no `unset`/`env -i`/`export -n` that could clobber the two injected vars, and
    // `exec`ing into zsh's rc chain sets the env before spawnProcess's own `env` option below
    // is even applied, so ordering is safe. This also incidentally fixes a second, related bug:
    // the daemon's own systemd-user-service PATH doesn't include `/home/jon23d/.opencode/bin`
    // (confirmed via `systemctl --user show-environment`), so `opencode` was very likely never
    // resolvable via the daemon's own PATH either -- resolving it inside the exec'd zsh (which
    // does get the right PATH via rc.sh) fixes both problems with one change. The port/hostname
    // are trusted/non-adversarial (pickPort() returns an OS-assigned number; hostname is a
    // fixed literal), so there's no live injection vector, but `shellSingleQuote` is reused here
    // anyway for defensive-by-construction consistency with the rest of this file's posture.
    const execString = `exec opencode serve --port ${shellSingleQuote(String(port))} --hostname ${shellSingleQuote('127.0.0.1')}`;
    const child = spawnProcess('zsh', ['-ic', execString], {
      cwd: process.cwd(),
      env: { [CONTROL_PLANE_DAEMON_ENV_VAR]: '1', [MATTERMOST_OPERATOR_USER_ID_ENV_VAR]: operatorUserId },
    });

    const server: SharedServer = {
      baseUrl,
      exited: false,
      exitCode: null,
      exitCallbacks: [],
      child,
      renameState: new Map(),
      eventStreamStarted: false,
    };

    let stderrOutput = '';
    child.stderr?.on('data', (chunk) => {
      stderrOutput += String(chunk);
    });
    child.on('exit', (code) => {
      logger.error('shared opencode serve process exited -- every session using it is now dead', { code, port });
      notifyExit(server, code);
    });

    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (server.exited) {
        throw new Error(
          `opencode serve exited before it became ready (code ${server.exitCode ?? 'unknown'})` +
            (stderrOutput.trim() ? `: ${stderrOutput.trim()}` : ''),
        );
      }
      // Bound this one attempt so a hung/slow connection can't silently consume the loop's
      // entire `readyTimeoutMs` budget (see HEALTH_CHECK_ATTEMPT_TIMEOUT_MS's doc comment) --
      // clamped to whatever's left of that budget so this never waits *past* the loop's own
      // deadline, only up to it.
      const attemptTimeoutMs = Math.max(0, Math.min(HEALTH_CHECK_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));
      const attemptAbort = new AbortController();
      const attemptTimer = setTimeout(() => attemptAbort.abort(), attemptTimeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/global/health`, { signal: attemptAbort.signal });
        if (res.ok) break;
      } catch (err) {
        if (isAbortError(err)) {
          // A repeated abort here is a much more interesting signal than a plain
          // connection-refused -- it means a request was accepted/in-flight but didn't respond
          // in time, exactly what the live incident this const's doc comment describes would
          // have shown in the logs if this check had existed at the time. Loud, not swallowed.
          logger.warn('opencode serve health check attempt timed out and was aborted -- retrying', { port, attemptTimeoutMs });
        }
        // Otherwise: connection refused while the server is still booting -- expected, keep polling.
      } finally {
        clearTimeout(attemptTimer);
      }
      if (Date.now() >= deadline) {
        child.kill();
        throw new Error(`opencode serve on port ${port} did not become ready within ${readyTimeoutMs}ms`);
      }
      await sleep(readyPollIntervalMs);
    }

    logger.info('shared opencode serve process is ready', { port });

    try {
      await verifyOrchestratorAgentAvailable(baseUrl, fetchImpl);
    } catch (cause) {
      // Same as the ready-timeout branch above -- a failure here means this harness will
      // never use this child (ensureSharedServer's catch clears `sharedPromise` on any
      // rejection, so nothing else keeps a reference to it), so it must be killed here or
      // it leaks as an orphaned process holding `port` (review kan9-1 F1).
      child.kill();
      throw cause;
    }
    logger.info(`confirmed opencode has the "${ORCHESTRATOR_AGENT_NAME}" agent available`, { port });

    try {
      await verifyGeneralEnvironmentAvailable(child, readChildEnviron, logger);
    } catch (cause) {
      // Same posture as the orchestrator-agent check just above -- a confirmed environment-parity
      // failure means this harness will never use this child, so it must be killed here or it
      // leaks as an orphaned process holding `port`.
      child.kill();
      throw cause;
    }

    return server;
  }

  async function ensureSharedServer(logger: Logger, operatorUserId: string): Promise<SharedServer> {
    if (!sharedPromise) {
      sharedPromise = spawnSharedServer(logger, operatorUserId);
    }
    const attempted = sharedPromise;

    let server: SharedServer;
    try {
      server = await attempted;
    } catch (err) {
      // The spawn itself failed. Clear the cache only if nobody else has
      // already replaced it with a fresh attempt, so the next `start` call
      // gets a real retry instead of forever awaiting this same rejection.
      if (sharedPromise === attempted) sharedPromise = undefined;
      throw err;
    }

    if (server.exited) {
      // Stale -- the shared process died since it was spawned. Respawn,
      // but only the first caller to notice does so (compare-and-swap on
      // `sharedPromise`); any other concurrent caller that also observes
      // the staleness converges on the same fresh attempt instead of
      // triggering its own.
      if (sharedPromise === attempted) {
        sharedPromise = spawnSharedServer(logger, operatorUserId);
      }
      return ensureSharedServer(logger, operatorUserId);
    }

    return server;
  }

  async function createSession(server: SharedServer, folder: string): Promise<{ id: string; title: string }> {
    const res = await fetchImpl(`${server.baseUrl}/session?directory=${encodeURIComponent(folder)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: ORCHESTRATOR_AGENT_NAME,
        // KAN-13 defense-in-depth: see ORCHESTRATOR_MODEL_ID's doc comment. `POST /session`'s
        // `model` shape is `{ id, providerID }` -- distinct from prompt_async's `{ providerID,
        // modelID }` below, confirmed via a live server's `GET /doc`.
        model: { id: ORCHESTRATOR_MODEL_ID, providerID: ORCHESTRATOR_MODEL_PROVIDER_ID },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable body>');
      throw new Error(`opencode session create failed: ${res.status} ${res.statusText} - ${text}`);
    }
    const parsed = sessionSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`opencode session create returned an unexpected response shape: ${JSON.stringify(parsed.error.issues)}`);
    }
    // Real opencode (1.18.18, live-verified) always includes `title` in this
    // response -- the `?? ''` fallback only guards a hypothetically
    // nonconforming server; if it ever triggers, the first genuine title the
    // agent sets will still correctly be detected as a change from ''.
    return { id: parsed.data.id, title: parsed.data.title ?? '' };
  }

  /**
   * Opens the shared server's `/event` SSE stream at most once (KAN-7),
   * lazily -- the first time any session on this shared server registers an
   * `onRename` callback. Deliberately does NOT reconnect if the stream ends
   * or errors: this mirrors the rest of this module's risk posture (there is
   * no ongoing health-monitoring of the shared process either, beyond its
   * one-time `exit` event) rather than building bespoke reconnect/backoff
   * infrastructure for a best-effort detection feature. A dropped stream is
   * logged loudly (never silent -- same principle as everywhere else in this
   * epic) so it's visible in the daemon's logs, even though nothing here
   * retries it automatically.
   */
  function ensureEventStream(server: SharedServer, logger: Logger): void {
    if (server.eventStreamStarted) return;
    server.eventStreamStarted = true;
    void readEventStream(server, logger);
  }

  async function readEventStream(server: SharedServer, logger: Logger): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(`${server.baseUrl}/event`);
    } catch (err) {
      logger.error(
        'failed to open the opencode event stream -- session-rename detection (KAN-7) will not work for this shared server',
        { err },
      );
      return;
    }
    if (!res.ok || !res.body) {
      logger.error(
        'opencode event stream responded without a usable body -- session-rename detection (KAN-7) will not work for this shared server',
        { status: res.status, statusText: res.statusText },
      );
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          handleRawSseFrame(buffer.slice(0, sepIndex), server.renameState, logger);
          buffer = buffer.slice(sepIndex + 2);
          sepIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      logger.error(
        'opencode event stream read failed -- session-rename detection (KAN-7) has stopped for this shared server',
        { err },
      );
      return;
    }
    logger.warn('opencode event stream ended -- session-rename detection (KAN-7) has stopped for this shared server');
  }

  return {
    name: 'opencode',

    async start({ folder, operatorUserId, logger }) {
      await validateFolder(folder);
      const server = await ensureSharedServer(logger, operatorUserId);
      const { id: sessionId, title: initialTitle } = await createSession(server, folder);
      server.renameState.set(sessionId, { lastTitle: initialTitle, callbacks: [] });

      const handle: HarnessSessionHandle = {
        async sendPrompt(message) {
          const res = await fetchImpl(
            `${server.baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(folder)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // `agent` here, not just on `POST /session`, is what actually selects the running
              // agent for this message -- see ORCHESTRATOR_AGENT_NAME's doc comment (KAN-9).
              // `model` here (KAN-13 defense-in-depth) is what actually resolves the model for
              // this specific request -- see ORCHESTRATOR_MODEL_ID's doc comment. Note the shape
              // is `{ providerID, modelID }`, NOT `{ id, providerID }` like `POST /session` uses.
              body: JSON.stringify({
                agent: ORCHESTRATOR_AGENT_NAME,
                model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
                parts: [{ type: 'text', text: message }],
              }),
            },
          );
          if (!res.ok) {
            const text = await res.text().catch(() => '<unreadable body>');
            throw new Error(`opencode prompt_async failed: ${res.status} ${res.statusText} - ${text}`);
          }
        },

        stop() {
          // Best-effort, per the interface contract -- never throws. Deletes
          // only this one opencode session; the shared server process keeps
          // running for every other session using it.
          fetchImpl(`${server.baseUrl}/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch((err) => {
            logger.error('failed to delete opencode session on stop (best-effort, ignored)', { err, sessionId });
          });
          // Stop tracking rename state for a session that's gone -- nothing
          // will ever call these callbacks again, and this keeps the map
          // from growing unbounded across many start/stop cycles over the
          // daemon's lifetime (KAN-7).
          server.renameState.delete(sessionId);
        },

        onExit(callback) {
          if (server.exited) {
            callback({ code: server.exitCode });
            return;
          }
          server.exitCallbacks.push(callback);
        },

        onRename(callback) {
          server.renameState.get(sessionId)?.callbacks.push(callback);
          ensureEventStream(server, logger);
        },

        async provisionChannelId(channelId) {
          // Best-effort, logged-not-thrown (review kan10-1 F3) -- runs before the
          // real write below so the ignore rule is in place before the file it
          // protects exists, but its own failure must never block the loud-on-
          // failure delivery that follows.
          await ensureSessionEnvFileGitignored(folder, logger);

          const filePath = join(folder, SESSION_ENV_FILE_NAME);
          const contents =
            `# Auto-generated by control-plane-daemon (KAN-10) -- \`source\` this file to load\n` +
            `# this session's own values into your shell.\n` +
            `export ${MATTERMOST_SESSION_CHANNEL_ID_ENV_VAR}=${shellSingleQuote(channelId)}\n`;
          // Same atomic tmp-write-then-rename pattern as sessionNumberStore.ts's
          // `allocateOnce` and stateStore.ts's `writeLastSeen` (review kan10-1 F1):
          // nothing ever reads this file back to notice a torn write the way those
          // two do on their own next read, so a crash mid-`writeFile` here would
          // otherwise leave a silently-corrupt file (e.g. a dangling `export ...='chan-ab`
          // with no closing quote) that nothing detects until the (separately-tracked)
          // external-chat skill eventually tries to `source` it. `rename()` on the same
          // filesystem is atomic, so this file is always either fully absent/stale or
          // fully correct, never half-written.
          const tmpPath = join(folder, `${SESSION_ENV_FILE_NAME}.tmp-${process.pid}-${randomUUID()}`);
          try {
            await writeFile(tmpPath, contents, 'utf8');
            await rename(tmpPath, filePath);
          } catch (cause) {
            throw new Error(
              `failed to write this session's channel id into ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          }
        },
      };

      return handle;
    },
  };
}
