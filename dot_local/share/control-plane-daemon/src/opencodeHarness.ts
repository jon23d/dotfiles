import { spawn as nodeSpawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:net';
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
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(): void;
}

export interface OpencodeHarnessConfig {
  spawnProcess?: (command: string, args: string[], options: { cwd: string }) => SpawnedProcessLike;
  pickPort?: () => Promise<number>;
  fetchImpl?: typeof fetch;
  /** How long to wait for `opencode serve` to report healthy before giving up. */
  readyTimeoutMs?: number;
  readyPollIntervalMs?: number;
}

function defaultSpawn(command: string, args: string[], options: { cwd: string }): SpawnedProcessLike {
  return nodeSpawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
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

const sessionSchema = z.object({ id: z.string().min(1) }).passthrough();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}

export function createOpencodeHarness(config: OpencodeHarnessConfig = {}): HarnessAdapter {
  const {
    spawnProcess = defaultSpawn,
    pickPort = pickFreePort,
    fetchImpl = fetch,
    readyTimeoutMs = 10_000,
    readyPollIntervalMs = 150,
  } = config;

  let shared: SharedServer | undefined;

  function notifyExit(server: SharedServer, code: number | null): void {
    server.exited = true;
    server.exitCode = code;
    for (const cb of server.exitCallbacks.splice(0)) cb({ code });
  }

  async function ensureSharedServer(logger: Logger): Promise<SharedServer> {
    if (shared && !shared.exited) return shared;

    const port = await pickPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawnProcess('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: process.cwd(),
    });

    const server: SharedServer = { baseUrl, exited: false, exitCode: null, exitCallbacks: [], child };
    shared = server;

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
      try {
        const res = await fetchImpl(`${baseUrl}/global/health`);
        if (res.ok) break;
      } catch {
        // Connection refused while the server is still booting -- expected, keep polling.
      }
      if (Date.now() >= deadline) {
        child.kill();
        throw new Error(`opencode serve on port ${port} did not become ready within ${readyTimeoutMs}ms`);
      }
      await sleep(readyPollIntervalMs);
    }

    logger.info('shared opencode serve process is ready', { port });
    return server;
  }

  async function createSession(server: SharedServer, folder: string): Promise<string> {
    const res = await fetchImpl(`${server.baseUrl}/session?directory=${encodeURIComponent(folder)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable body>');
      throw new Error(`opencode session create failed: ${res.status} ${res.statusText} - ${text}`);
    }
    const parsed = sessionSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`opencode session create returned an unexpected response shape: ${JSON.stringify(parsed.error.issues)}`);
    }
    return parsed.data.id;
  }

  return {
    name: 'opencode',

    async start({ folder, logger }) {
      await validateFolder(folder);
      const server = await ensureSharedServer(logger);
      const sessionId = await createSession(server, folder);

      const handle: HarnessSessionHandle = {
        async sendPrompt(message) {
          const res = await fetchImpl(
            `${server.baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(folder)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parts: [{ type: 'text', text: message }] }),
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
        },

        onExit(callback) {
          if (server.exited) {
            callback({ code: server.exitCode });
            return;
          }
          server.exitCallbacks.push(callback);
        },
      };

      return handle;
    },
  };
}
