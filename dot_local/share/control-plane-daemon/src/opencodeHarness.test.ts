import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROL_PLANE_DAEMON_ENV_VAR,
  MATTERMOST_OPERATOR_USER_ID_ENV_VAR,
  MATTERMOST_SESSION_CHANNEL_ID_ENV_VAR,
  ORCHESTRATOR_AGENT_NAME,
  ORCHESTRATOR_MODEL_ID,
  ORCHESTRATOR_MODEL_PROVIDER_ID,
  SESSION_ENV_FILE_NAME,
  createOpencodeHarness,
} from './opencodeHarness.js';
import type { SpawnedProcessLike } from './opencodeHarness.js';
import type { Logger } from './logger.js';

const PORT = 47999;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OPERATOR_USER_ID = 'operator-1';

const server = setupServer();

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A minimal fake child process -- mirrors socketClient.test.ts's WebSocketLike fakes: an
 * EventEmitter standing in for the real node:child_process handle, with test-only helpers
 * to simulate the events opencodeHarness.ts actually listens for.
 *
 * `pid` is a fixed fake value (KAN-12) -- it has no corresponding real `/proc/<pid>/environ`
 * entry, which is exactly the "unreadable" case `verifyGeneralEnvironmentAvailable`'s default
 * real `readChildEnviron` degrades gracefully on (warn, not throw). That's what lets the ~30
 * other tests reaching `spawnSharedServer` through this one factory pass unmodified: none of
 * them inject a fake `readChildEnviron`, so they all hit the unreadable branch and warn. */
function fakeChildProcess(): SpawnedProcessLike & { emitExit(code: number | null): void; emitStderr(chunk: string): void } {
  const emitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const proc = {
    stderr: stderrEmitter,
    pid: 12345,
    on: (event: 'exit', listener: (code: number | null) => void) => {
      emitter.on(event, listener);
      return proc;
    },
    kill: vi.fn(),
    emitExit(code: number | null) {
      emitter.emit('exit', code);
    },
    emitStderr(chunk: string) {
      stderrEmitter.emit('data', chunk);
    },
  };
  return proc;
}

function healthyHandler() {
  return http.get(`${BASE_URL}/global/health`, () => HttpResponse.json({ healthy: true, version: '1.0.0' }));
}

/** GET /agent, listing the orchestrator agent under the real identifier opencode
 * uses to select it (KAN-9: confirmed live against opencode 1.18.18 to be the
 * frontmatter `name:` field, "Orchestrator" -- NOT the `orchestrator.md` filename
 * stem). `spawnSharedServer` checks this list is present and contains that name
 * before it will hand back a server to create sessions against, so every test
 * that reaches a healthy shared server needs this handler registered too. */
function agentAvailableHandler(names: string[] = [ORCHESTRATOR_AGENT_NAME]) {
  return http.get(`${BASE_URL}/agent`, () => HttpResponse.json(names.map((name) => ({ name, mode: 'primary' }))));
}

/** A hand-controlled SSE stream for `/event` -- lets a test push synthetic opencode
 * events (`session.updated`, etc.) at exactly the moment it wants, rather than
 * pre-loading a fixed array and racing the harness's own async stream-reading loop
 * (KAN-7). Mirrors real SSE framing: `data: <json>\n\n` per event. */
function controllableEventStream() {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  return {
    handler: http.get(`${BASE_URL}/event`, () => new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })),
    push(event: unknown) {
      controllerRef?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controllerRef?.close();
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  server.resetHandlers();
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

describe('createOpencodeHarness', () => {
  it('rejects with a clear error and never spawns anything when the folder does not exist', async () => {
    const spawnProcess = vi.fn();
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    await expect(
      harness.start({ folder: join(dir, 'does-not-exist'), operatorUserId: OPERATOR_USER_ID, logger: silentLogger() }),
    ).rejects.toThrow(
      /does-not-exist/,
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('rejects with a clear error when the folder is a file, not a directory', async () => {
    const { writeFile } = await import('node:fs/promises');
    const filePath = join(dir, 'a-file');
    await writeFile(filePath, 'not a directory', 'utf8');
    const spawnProcess = vi.fn();
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    await expect(harness.start({ folder: filePath, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(/not a directory/i);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('spawns `opencode serve`, waits for it to become healthy, and creates a session scoped to the requested directory', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    let createdWithDirectory: string | undefined;
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, ({ request }) => {
        createdWithDirectory = new URL(request.url).searchParams.get('directory') ?? undefined;
        return HttpResponse.json({ id: 'ses_abc123' });
      }),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    expect(handle).toBeDefined();
    // KAN-12: spawned through an interactive zsh shell (`zsh -ic 'exec opencode serve ...'`),
    // not the `opencode` binary directly, so the child inherits whatever an ordinary
    // interactive shell picks up (configs.env, sourced only via .zshrc) instead of the daemon
    // hand-forwarding individual env vars one at a time.
    expect(spawnProcess).toHaveBeenCalledWith(
      'zsh',
      expect.arrayContaining([
        '-ic',
        expect.stringMatching(new RegExp(`exec opencode serve --port '?${PORT}'? --hostname '?127\\.0\\.0\\.1'?`)),
      ]),
      expect.objectContaining({}),
    );
    expect(createdWithDirectory).toBe(dir);
  });

  describe('orchestrator agent selection (KAN-9)', () => {
    it('sends the confirmed orchestrator agent identifier in the POST /session body instead of an empty body', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      let capturedBody: unknown;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ id: 'ses_abc123' });
        }),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

      await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      // `toStrictEqual`, not `toEqual` -- `toEqual` treats `{}` and `{ agent: undefined }` as
      // equal (undefined-valued keys are ignored), which would let this test pass even if
      // `ORCHESTRATOR_AGENT_NAME` failed to import (vitest's transform doesn't type-check, so a
      // missing export silently becomes `undefined` here rather than a compile error).
      // KAN-13 defense-in-depth: with no `model` field sent on either endpoint, opencode's own
      // default-model resolution silently picked a 4096-token-context model, which the
      // Orchestrator's system prompt + MCP tool schemas always overflowed, causing an unbounded
      // compaction loop (see .agent/research-kan13.md). `POST /session`'s `model` shape is
      // `{ id, providerID }` per a live server's `GET /doc` (opencode 1.18.18) -- distinct from
      // prompt_async's `{ providerID, modelID }` shape, covered separately below.
      expect(capturedBody).toStrictEqual({
        agent: ORCHESTRATOR_AGENT_NAME,
        model: { id: ORCHESTRATOR_MODEL_ID, providerID: ORCHESTRATOR_MODEL_PROVIDER_ID },
      });
    });

    it('rejects loudly and never creates a session when opencode has no agent matching the confirmed identifier, rather than silently falling back', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const createSessionHandler = vi.fn(() => HttpResponse.json({ id: 'ses_abc123' }));
      server.use(
        healthyHandler(),
        // Opencode is up, but the orchestrator agent isn't among its known agents --
        // e.g. orchestrator.md failed to load, or the frontmatter name drifted.
        agentAvailableHandler(['build', 'plan', 'general']),
        http.post(`${BASE_URL}/session`, createSessionHandler),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

      await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(
        new RegExp(ORCHESTRATOR_AGENT_NAME),
      );
      expect(createSessionHandler).not.toHaveBeenCalled();
      // The shared `opencode serve` child was already spawned and passed its health check by
      // the time verification fails -- it must be killed here or it leaks as an orphaned
      // process holding its port, since nothing else keeps a reference to it once
      // `ensureSharedServer`'s catch clears `sharedPromise` (review kan9-1 F1). Matches the
      // assertion the pre-existing ready-timeout test makes for the same reason.
      expect(child.kill).toHaveBeenCalled();
    });

    it('rejects loudly and kills the shared child when GET /agent responds with a server error', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const createSessionHandler = vi.fn(() => HttpResponse.json({ id: 'ses_abc123' }));
      server.use(
        healthyHandler(),
        http.get(`${BASE_URL}/agent`, () => new HttpResponse(null, { status: 500 })),
        http.post(`${BASE_URL}/session`, createSessionHandler),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

      await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(/agent/i);
      expect(createSessionHandler).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalled();
    });

    it('rejects loudly and kills the shared child when GET /agent is genuinely unreachable (network failure, not just a bad status)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const createSessionHandler = vi.fn(() => HttpResponse.json({ id: 'ses_abc123' }));
      server.use(
        healthyHandler(),
        // Distinct from the 500-response test above: this makes the `fetchImpl` call itself
        // reject (simulating connection refused/DNS failure/etc.), exercising
        // `verifyOrchestratorAgentAvailable`'s `catch` block around the fetch, not its
        // `!res.ok` branch (review kan9-1 F2).
        http.get(`${BASE_URL}/agent`, () => HttpResponse.error()),
        http.post(`${BASE_URL}/session`, createSessionHandler),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

      await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(/unreachable/i);
      expect(createSessionHandler).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalled();
    });
  });

  describe('general environment availability check (KAN-12)', () => {
    /**
     * Runs once per shared-server spawn, right after the orchestrator-agent check, and reads
     * the spawned child's *real* resolved environment (via the injectable `readChildEnviron`)
     * to confirm the interactive-zsh-shell fix actually worked -- i.e. that `configs.env` was
     * genuinely sourced into the child, not just that the zsh wrapper command was constructed
     * correctly (that part is covered by the top-level "spawns ... zsh ..." test above).
     * `MATTERMOST_MCP_URL` is the sentinel: it's the literal reported symptom, and `configs.env`
     * today only defines `TOOLSETS` and `MATTERMOST_MCP_URL`, with the latter being the one
     * every downstream MCP consumer actually depends on.
     */
    it('throws naming configs.env and kills the child when the spawned child\'s real environment is confirmably missing MATTERMOST_MCP_URL', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const createSessionHandler = vi.fn(() => HttpResponse.json({ id: 'ses_abc123' }));
      server.use(healthyHandler(), agentAvailableHandler(), http.post(`${BASE_URL}/session`, createSessionHandler));
      const readChildEnviron = vi.fn().mockResolvedValue({ PATH: '/usr/bin' }); // no MATTERMOST_MCP_URL
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT, readChildEnviron });

      await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(
        /MATTERMOST_MCP_URL.*configs\.env|configs\.env.*MATTERMOST_MCP_URL/is,
      );
      expect(createSessionHandler).not.toHaveBeenCalled();
      // Same "never limp along" posture as verifyOrchestratorAgentAvailable above -- a
      // confirmed, not merely suspected, misconfiguration kills the shared child rather than
      // leaving an orphaned process holding its port (nothing else keeps a reference to it once
      // ensureSharedServer's catch clears sharedPromise).
      expect(child.kill).toHaveBeenCalled();
    });

    it('succeeds and creates the session when the spawned child\'s real environment does contain MATTERMOST_MCP_URL', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(healthyHandler(), agentAvailableHandler(), http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })));
      const readChildEnviron = vi.fn().mockResolvedValue({ PATH: '/usr/bin', MATTERMOST_MCP_URL: 'https://mattermost.example/plugins/mcp' });
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT, readChildEnviron });

      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      expect(handle).toBeDefined();
      expect(child.kill).not.toHaveBeenCalled();
    });

    it('logs a warn (not a throw) and still succeeds when the child\'s environment cannot be read at all -- e.g. a test double\'s fake pid with no real /proc entry', async () => {
      const child = fakeChildProcess(); // pid 12345, no corresponding real /proc/12345/environ
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(healthyHandler(), agentAvailableHandler(), http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })));
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT }); // default real readChildEnviron
      const logger = silentLogger();

      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });

      expect(handle).toBeDefined();
      expect(child.kill).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/environ/i), expect.objectContaining({ pid: 12345 }));
    });
  });

  it('spawns `opencode serve` with a distinguishing env var so an in-session agent can tell it is running under the daemon (kan7-2 F4)', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    expect(spawnProcess).toHaveBeenCalledWith(
      'zsh',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ [CONTROL_PLANE_DAEMON_ENV_VAR]: '1' }) }),
    );
  });

  describe('operator user id env var (KAN-10)', () => {
    it('spawns `opencode serve` with the operator user id in its env, the same process-wide mechanism as CONTROL_PLANE_DAEMON, since the operator is one-per-VM just like KAN-7\'s marker', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

      await harness.start({ folder: dir, operatorUserId: 'operator-42', logger: silentLogger() });

      expect(spawnProcess).toHaveBeenCalledWith(
        'zsh',
        expect.any(Array),
        expect.objectContaining({ env: expect.objectContaining({ [MATTERMOST_OPERATOR_USER_ID_ENV_VAR]: 'operator-42' }) }),
      );
    });

    it('does not re-spawn (and so keeps the first operator id, ignoring a differing second one) when a second session starts against the already-running shared server', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-operator-'));

      // Deliberately different values across the two calls (review kan10-1 F2): using
      // the same id for both would make "kept the first" and "kept the second"
      // indistinguishable. The shared server is spawned once, from the first call, so
      // its env must reflect operator-42 specifically, not operator-99.
      await harness.start({ folder: dir, operatorUserId: 'operator-42', logger: silentLogger() });
      await harness.start({ folder: dir2, operatorUserId: 'operator-99', logger: silentLogger() });

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(spawnProcess).toHaveBeenCalledWith(
        'zsh',
        expect.any(Array),
        expect.objectContaining({ env: expect.objectContaining({ [MATTERMOST_OPERATOR_USER_ID_ENV_VAR]: 'operator-42' }) }),
      );
      await rm(dir2, { recursive: true, force: true });
    });
  });

  it('reuses the already-running shared server for a second session instead of spawning again', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-2-'));

    await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
    await harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    await rm(dir2, { recursive: true, force: true });
  });

  it('spawns the shared server exactly once even when two `start()` calls race concurrently with no await between them (review kan5-1 F1)', async () => {
    const spawnProcess = vi.fn().mockImplementation(() => fakeChildProcess());
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );

    // `pickPort` is the exact yield point F1 flagged (the `await` inside
    // ensureSharedServer between its "is there already a shared server"
    // check and actually assigning one). Gating it manually -- rather than
    // just firing two `start()` calls and hoping real `fs.stat` timing
    // inside `validateFolder` happens to interleave them -- makes this
    // deterministic: hold the gate open long enough for a second, buggy
    // concurrent call to also reach `pickPort` (proving the race exists)
    // before releasing it and letting both calls proceed.
    let pickPortCalls = 0;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const pickPort = vi.fn(async () => {
      pickPortCalls += 1;
      await gate;
      return PORT;
    });
    const harness = createOpencodeHarness({ spawnProcess, pickPort });
    const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-race-'));

    // Deliberately not awaited individually -- this is what daemon.ts's
    // fire-and-forget `onPost` dispatch actually does when two `start`
    // commands arrive close together.
    const p1 = harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
    const p2 = harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
    await vi.waitFor(() => expect(pickPortCalls).toBeGreaterThanOrEqual(1));
    // Give a second, racing `ensureSharedServer()` call every chance to
    // also reach `pickPort` before the gate opens -- real time, not just a
    // microtask flush, since `validateFolder`'s `fs.stat` is real I/O.
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseGate?.();

    const [handleA, handleB] = await Promise.all([p1, p2]);

    expect(handleA).toBeDefined();
    expect(handleB).toBeDefined();
    expect(pickPortCalls).toBe(1);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    await rm(dir2, { recursive: true, force: true });
  });

  it('sendPrompt posts the message as a text part to prompt_async, scoped to the session\'s directory', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    let capturedBody: unknown;
    let capturedDirectory: string | null = null;
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, async ({ request }) => {
        capturedBody = await request.json();
        capturedDirectory = new URL(request.url).searchParams.get('directory');
        return new HttpResponse(null, { status: 204 });
      }),
      // KAN-13 follow-up: sendPrompt verifies the pinned model actually resolved by re-reading the
      // message it just sent -- see verifyPromptResolvedPinnedModel's doc comment. This message
      // matches what was sent, under the pinned model, so verification passes silently.
      http.get(`${BASE_URL}/session/ses_abc123/message`, () =>
        HttpResponse.json([
          {
            info: {
              role: 'user',
              model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
            },
            parts: [{ type: 'text', text: 'hello there' }],
          },
        ]),
      ),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    await handle.sendPrompt('hello there');

    // KAN-9: live-verified against a real opencode server that `POST /session`'s `agent` field
    // is NOT enough on its own -- `POST /session/:id/prompt_async` has its own independent
    // `agent` field, and *that* is what actually determines which agent runs the message.
    // Omitting it here silently ran the message under opencode's own default agent ("build"),
    // even though the session itself was created with `agent: "Orchestrator"` -- confirmed by
    // inspecting `GET /session/:id/message`'s `info.agent` on a real server both with and
    // without this field set on prompt_async.
    // KAN-13 defense-in-depth: `model` here is what actually resolves the model for this
    // specific request, per the same reasoning as ORCHESTRATOR_MODEL_ID's doc comment. Shape is
    // `{ providerID, modelID }` -- confirmed via a live server's `GET /doc` to differ from
    // `POST /session`'s `{ id, providerID }` shape (see the createSession test above).
    expect(capturedBody).toEqual({
      agent: ORCHESTRATOR_AGENT_NAME,
      model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
      parts: [{ type: 'text', text: 'hello there' }],
    });
    expect(capturedDirectory).toBe(dir);
  });

  it('sendPrompt rejects with a clear error when opencode responds non-2xx', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () =>
        HttpResponse.json({ name: 'NotFoundError', data: { message: 'Session not found' } }, { status: 404 }),
      ),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    await expect(handle.sendPrompt('hello')).rejects.toThrow(/404/);
  });

  describe('sendPrompt model-pin verification (KAN-13 follow-up)', () => {
    /**
     * Reproduces the real incident live-diagnosed on the daemon's actual host: opencode accepted
     * `prompt_async`'s explicit model pin with a `204` (no error, no `session.error` SSE event
     * anywhere), but the message it actually created resolved under a different model entirely --
     * the exact silent starting point for KAN-13's unbounded compaction loop, just one layer
     * earlier than that ticket's own fix could see.
     */
    it('aborts the session and rejects loudly when opencode silently resolves the prompt to a different model', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      let abortedDirectory: string | null = null;
      let abortCalled = false;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () => new HttpResponse(null, { status: 204 })),
        http.get(`${BASE_URL}/session/ses_abc123/message`, () =>
          HttpResponse.json([
            {
              info: { role: 'user', model: { providerID: 'litellm', modelID: 'small-model' } },
              parts: [{ type: 'text', text: 'hello there' }],
            },
          ]),
        ),
        http.post(`${BASE_URL}/session/ses_abc123/abort`, ({ request }) => {
          abortCalled = true;
          abortedDirectory = new URL(request.url).searchParams.get('directory');
          return HttpResponse.json(true);
        }),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await expect(handle.sendPrompt('hello there')).rejects.toThrow(
        /silently resolved the pinned model litellm\/deepseek-v4-pro to litellm\/small-model/,
      );
      expect(abortCalled).toBe(true);
      expect(abortedDirectory).toBe(dir);
    });

    it('does not abort or throw when the model matches -- only a confirmed mismatch is fatal', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      let abortCalled = false;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () => new HttpResponse(null, { status: 204 })),
        http.get(`${BASE_URL}/session/ses_abc123/message`, () =>
          HttpResponse.json([
            {
              info: {
                role: 'user',
                model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
              },
              parts: [{ type: 'text', text: 'hello there' }],
            },
          ]),
        ),
        http.post(`${BASE_URL}/session/ses_abc123/abort`, () => {
          abortCalled = true;
          return HttpResponse.json(true);
        }),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await expect(handle.sendPrompt('hello there')).resolves.toBeUndefined();
      expect(abortCalled).toBe(false);
    });

    it('does not fail the send when verification itself cannot be completed (best-effort, not a confirmed mismatch)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () => new HttpResponse(null, { status: 204 })),
        // No matching just-sent message in the list ever -- e.g. a race with another send.
        // `promptVerifyMaxAttempts`/`promptVerifyIntervalMs` kept small here (rather than the
        // real 5x300ms default) purely so this test doesn't spend 1.5s exhausting real retries.
        http.get(`${BASE_URL}/session/ses_abc123/message`, () => HttpResponse.json([])),
      );
      const harness = createOpencodeHarness({
        spawnProcess,
        pickPort: async () => PORT,
        promptVerifyMaxAttempts: 2,
        promptVerifyIntervalMs: 1,
      });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await expect(handle.sendPrompt('hello there')).resolves.toBeUndefined();
    });

    it('polls for the just-sent message rather than giving up on the first empty check (cold-server-spawn regression)', async () => {
      // Live-diagnosed (KAN-13 follow-up): immediately after a real, freshly-spawned opencode serve
      // accepts prompt_async, GET /session/:id/message can still return zero results for a
      // short window (observed: not yet visible at +0ms, reliably visible by ~+300ms). A
      // verification check that only looked once would treat this normal window as "can't
      // verify" on nearly every fresh-server send -- exactly when this check matters most.
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      let messageCallCount = 0;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () => new HttpResponse(null, { status: 204 })),
        http.get(`${BASE_URL}/session/ses_abc123/message`, () => {
          messageCallCount += 1;
          if (messageCallCount === 1) return HttpResponse.json([]); // not visible yet, first poll
          return HttpResponse.json([
            {
              info: {
                role: 'user',
                model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
              },
              parts: [{ type: 'text', text: 'hello there' }],
            },
          ]);
        }),
      );
      const harness = createOpencodeHarness({
        spawnProcess,
        pickPort: async () => PORT,
        promptVerifyMaxAttempts: 3,
        promptVerifyIntervalMs: 1,
      });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await expect(handle.sendPrompt('hello there')).resolves.toBeUndefined();
      expect(messageCallCount).toBe(2);
    });

    /**
     * Review kan13-3 F7: identifying "the message we just sent" by exact text equality alone is
     * ambiguous when an *earlier* message in the same session shares that exact text -- entirely
     * plausible for a short reply like "yes"/"ok"/"continue". Live-confirmed against a real
     * `opencode serve` (1.18.18) that `GET /session/:id/message` returns `info.id` and
     * `info.time.created` (epoch ms) on every message; that timestamp is the real disambiguator.
     * This reproduces the race the finding describes: attempt 1's poll response contains only the
     * OLD duplicate-text message (the real just-sent message isn't visible yet -- the same
     * visibility race the "polls for the just-sent message" test above covers) with a model that
     * does NOT match the pin. A version of this check that matches on text alone would treat that
     * stale message as "the one we just sent" and abort a perfectly healthy session on attempt 1.
     * The fix must keep polling instead, and only match a message created at/after the send.
     */
    it('does not mistake an earlier message with identical text for the just-sent one (regression: F7)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const beforeSend = Date.now();
      let messageCallCount = 0;
      let abortCalled = false;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () => new HttpResponse(null, { status: 204 })),
        http.get(`${BASE_URL}/session/ses_abc123/message`, () => {
          messageCallCount += 1;
          const staleDuplicate = {
            info: {
              role: 'user',
              // Deliberately the WRONG model -- if this stale message were mistaken for the
              // just-sent one, verification would abort on a session that is actually healthy.
              model: { providerID: 'litellm', modelID: 'small-model' },
              time: { created: beforeSend - 60_000 },
            },
            parts: [{ type: 'text', text: 'yes' }],
          };
          if (messageCallCount === 1) {
            // Attempt 1: the real just-sent message hasn't landed yet (visibility race) -- only
            // the old duplicate-text message is visible.
            return HttpResponse.json([staleDuplicate]);
          }
          const justSent = {
            info: {
              role: 'user',
              model: { providerID: ORCHESTRATOR_MODEL_PROVIDER_ID, modelID: ORCHESTRATOR_MODEL_ID },
              time: { created: beforeSend + 60_000 },
            },
            parts: [{ type: 'text', text: 'yes' }],
          };
          return HttpResponse.json([staleDuplicate, justSent]);
        }),
        http.post(`${BASE_URL}/session/ses_abc123/abort`, () => {
          abortCalled = true;
          return HttpResponse.json(true);
        }),
      );
      const harness = createOpencodeHarness({
        spawnProcess,
        pickPort: async () => PORT,
        promptVerifyMaxAttempts: 3,
        promptVerifyIntervalMs: 1,
      });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await expect(handle.sendPrompt('yes')).resolves.toBeUndefined();
      expect(abortCalled).toBe(false);
      expect(messageCallCount).toBe(2);
    });
  });

  it('stop() deletes only this session via the opencode API and never throws even if that fails', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    let deletedId: string | undefined;
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.delete(`${BASE_URL}/session/:id`, ({ params }) => {
        deletedId = params.id as string;
        return HttpResponse.json(true);
      }),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    expect(() => handle.stop()).not.toThrow();
    await vi.waitFor(() => expect(deletedId).toBe('ses_abc123'));
    // The shared server process itself must not be killed by stopping one session -- other
    // sessions may still be using it.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('onExit fires every registered session handle when the shared server process exits', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
    const onExit = vi.fn();
    handle.onExit(onExit);

    child.emitExit(1);

    expect(onExit).toHaveBeenCalledWith({ code: 1 });
  });

  it('onExit invokes the callback immediately if the process already exited before onExit was registered', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      agentAvailableHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

    child.emitExit(0);
    const onExit = vi.fn();
    handle.onExit(onExit);

    expect(onExit).toHaveBeenCalledWith({ code: 0 });
  });

  it('rejects with a clear error, including captured stderr, if the process exits before becoming ready', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockImplementation(() => {
      // Simulate the child dying almost immediately, before any health check could succeed.
      queueMicrotask(() => {
        child.emitStderr('opencode: fatal: address already in use');
        child.emitExit(1);
      });
      return child;
    });
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT, readyTimeoutMs: 500, readyPollIntervalMs: 10 });

    await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(/address already in use/);
  });

  it('rejects with a clear timeout error if the server never becomes healthy in time', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    // No `/global/health` handler registered -- every poll fails with a network error, and the
    // fake child process never emits 'exit', so this exercises the timeout path specifically.
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT, readyTimeoutMs: 100, readyPollIntervalMs: 10 });

    await expect(harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() })).rejects.toThrow(/ready|timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  describe('health-check poll attempt timeout (regression: live-diagnosed incident during KAN-12 verification)', () => {
    /**
     * Reproduces the live incident: a single `/global/health` `fetch()` call hung (in
     * production, consistent with Node/undici's default fetch timeout, ~300s) instead of
     * failing fast, and the loop's deadline was only ever checked *between* attempts -- so one
     * hung call blew straight through the entire `readyTimeoutMs` budget while the underlying
     * `opencode serve` process was, the whole time, genuinely healthy. This fake `fetchImpl`
     * never resolves or rejects on its own, simulating exactly that hang; the fix must bound
     * each individual attempt so the loop still gives up close to its own configured deadline.
     */
    it('gives up at approximately its own configured readyTimeoutMs when a health-check fetch hangs, instead of waiting on it indefinitely', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      // Never settles on its own -- exactly like the real hung `fetch()` call in the live
      // incident, whose own signal (undici's default fetch timeout) took ~318s to fire. This
      // fake only settles if something else (the fix under test) actually aborts its signal --
      // a real, unfixed `fetch()` calls with no signal passed at all would never abort here,
      // which is precisely why this test would hang without the fix.
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
          }),
      );
      const readyTimeoutMs = 300;
      const harness = createOpencodeHarness({
        spawnProcess,
        pickPort: async () => PORT,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readyTimeoutMs,
        readyPollIntervalMs: 10,
      });

      const startedAt = Date.now();
      await expect(
        harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() }),
      ).rejects.toThrow(/ready|timed out/i);
      const elapsedMs = Date.now() - startedAt;

      // Generous upper bound (well under vitest's 5s default per-test timeout) -- the point is
      // "close to readyTimeoutMs", not waiting on the hung call, which would never resolve at all.
      expect(elapsedMs).toBeLessThan(2_000);
      expect(child.kill).toHaveBeenCalled();
    });

    /**
     * The distinction this incident showed was missing: a poll attempt that has to be aborted
     * because it hung is a much more interesting signal than an ordinary connection-refused
     * failure while the process is still booting -- a repeated abort-timeout in the logs would
     * have made this exact incident diagnosable without live `curl` debugging. Simulates one
     * hung attempt (aborted) followed by a normal healthy response, and asserts the abort is
     * logged distinctly rather than being silently swallowed by the same blanket catch as a
     * plain connection-refused.
     */
    it('logs distinctly when a poll attempt is aborted for hanging, then still succeeds once the server responds normally', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(healthyHandler(), agentAvailableHandler(), http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })));
      let healthCallCount = 0;
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (href.endsWith('/global/health')) {
          healthCallCount += 1;
          if (healthCallCount === 1) {
            // First attempt hangs until aborted -- never settles on its own.
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
            });
          }
        }
        return fetch(url, init); // delegate to the real (MSW-intercepted) fetch for everything else
      }) as typeof fetch;
      const logger = silentLogger();
      const harness = createOpencodeHarness({
        spawnProcess,
        pickPort: async () => PORT,
        fetchImpl,
        readyPollIntervalMs: 10,
      });

      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });

      expect(handle).toBeDefined();
      expect(healthCallCount).toBeGreaterThanOrEqual(2);
      // Distinct from the plain "keep polling" silence -- an abort-timeout is logged loudly.
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/abort|timed out|hung/i), expect.anything());
    }, 10_000);
  });

  describe('onRename (KAN-7)', () => {
    it('fires with the new title when opencode reports this session\'s title changed', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const onRename = vi.fn();
      handle.onRename(onRename);

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'KAN-4' } } });

      await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('KAN-4'));
      sse.close();
    });

    it('fires again on a second, later title change (AC2: work identity can change again)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const onRename = vi.fn();
      handle.onRename(onRename);

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'KAN-4' } } });
      await vi.waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'KAN-9' } } });
      await vi.waitFor(() => expect(onRename).toHaveBeenCalledTimes(2));

      expect(onRename).toHaveBeenNthCalledWith(1, 'KAN-4');
      expect(onRename).toHaveBeenNthCalledWith(2, 'KAN-9');
      sse.close();
    });

    it('ignores a title change reported for a different session sharing the same opencode server', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      let created = 0;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => {
          created += 1;
          return HttpResponse.json({ id: created === 1 ? 'ses_aaa' : 'ses_bbb', title: 'New session - x' });
        }),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-rename-'));
      const handleA = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      await harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const onRenameA = vi.fn();
      handleA.onRename(onRenameA);

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_bbb', info: { title: 'OTHER-1' } } });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(onRenameA).not.toHaveBeenCalled();
      sse.close();
      await rm(dir2, { recursive: true, force: true });
    });

    it('does not re-fire when a session.updated event repeats the same title (no real change)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const onRename = vi.fn();
      handle.onRename(onRename);

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'KAN-4' } } });
      await vi.waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));

      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'KAN-4' } } });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(onRename).toHaveBeenCalledTimes(1);
      sse.close();
    });

    it('ignores unrelated event types on the shared stream without throwing or misfiring', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const onRename = vi.fn();
      handle.onRename(onRename);

      sse.push({ type: 'message.part.updated', properties: { sessionID: 'ses_abc123' } });
      sse.push({ type: 'session.created', properties: { sessionID: 'ses_abc123', info: { title: 'New session - x' } } });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(onRename).not.toHaveBeenCalled();
      sse.close();
    });

    it('logs loudly and does not crash the daemon when the event stream cannot be opened at all', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        http.get(`${BASE_URL}/event`, () => new HttpResponse(null, { status: 500 })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const logger = silentLogger();
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });

      expect(() => handle.onRename(vi.fn())).not.toThrow();
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    });
  });

  describe('session.error surfacing (KAN-13)', () => {
    it('logs loudly, including the sessionID and full error payload, when opencode reports this session errored', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const logger = silentLogger();
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });
      // The event stream only opens lazily on the first `onRename` call (KAN-7) -- production
      // code (startCommand.ts) always registers one, so this mirrors the real trigger rather
      // than opening the stream some other way a real session never would.
      handle.onRename(vi.fn());

      const providerError = { name: 'ProviderAuthError', data: { providerID: 'litellm', message: 'model not found' } };
      sse.push({ type: 'session.error', properties: { sessionID: 'ses_abc123', error: providerError } });

      await vi.waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/session\.error/i), {
          sessionID: 'ses_abc123',
          error: providerError,
        }),
      );
      sse.close();
    });

    it('ignores a session.error event reported for a different session sharing the same opencode server', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      let created = 0;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => {
          created += 1;
          return HttpResponse.json({ id: created === 1 ? 'ses_aaa' : 'ses_bbb', title: 'New session - x' });
        }),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-error-'));
      const logger = silentLogger();
      const handleA = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });
      await harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      handleA.onRename(vi.fn());

      sse.push({ type: 'session.error', properties: { sessionID: 'ses_bbb', error: { name: 'UnknownError' } } });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(logger.error).not.toHaveBeenCalled();
      sse.close();
      await rm(dir2, { recursive: true, force: true });
    });

    it('does not throw and keeps reading the stream when a session.error frame is malformed', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const logger = silentLogger();
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });
      const onRename = vi.fn();
      handle.onRename(onRename);

      // Missing `properties.sessionID` entirely -- schema mismatch, must be dropped silently
      // rather than throwing and killing the stream-reading loop.
      sse.push({ type: 'session.error', properties: {} });
      sse.push({ type: 'session.updated', properties: { sessionID: 'ses_abc123', info: { title: 'still works' } } });

      await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('still works'));
      sse.close();
    });

    describe('onError callback (review kan13-2 F5)', () => {
      it('fires with the error payload when opencode reports this session errored, so a harness-agnostic caller can surface it', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        const sse = controllableEventStream();
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
          sse.handler,
        );
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
        const onError = vi.fn();
        // Registered alone, with no `onRename` call -- confirms `onError` opens the lazy
        // event stream (KAN-7) on its own rather than depending on `onRename` having been
        // called first, since a caller could register either callback in either order.
        handle.onError(onError);

        const providerError = { name: 'ProviderAuthError', data: { providerID: 'litellm', message: 'model not found' } };
        sse.push({ type: 'session.error', properties: { sessionID: 'ses_abc123', error: providerError } });

        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith({ error: providerError }));
        sse.close();
      });

      it('fires again on a second, later session.error event for the same session', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        const sse = controllableEventStream();
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
          sse.handler,
        );
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
        const onError = vi.fn();
        handle.onError(onError);

        sse.push({ type: 'session.error', properties: { sessionID: 'ses_abc123', error: { name: 'FirstError' } } });
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

        sse.push({ type: 'session.error', properties: { sessionID: 'ses_abc123', error: { name: 'SecondError' } } });
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));

        expect(onError).toHaveBeenNthCalledWith(1, { error: { name: 'FirstError' } });
        expect(onError).toHaveBeenNthCalledWith(2, { error: { name: 'SecondError' } });
        sse.close();
      });

      it('ignores a session.error event reported for a different session sharing the same opencode server', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        const sse = controllableEventStream();
        let created = 0;
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => {
            created += 1;
            return HttpResponse.json({ id: created === 1 ? 'ses_aaa' : 'ses_bbb', title: 'New session - x' });
          }),
          sse.handler,
        );
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-onerror-'));
        const handleA = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
        await harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
        const onErrorA = vi.fn();
        handleA.onError(onErrorA);

        sse.push({ type: 'session.error', properties: { sessionID: 'ses_bbb', error: { name: 'UnknownError' } } });
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(onErrorA).not.toHaveBeenCalled();
        sse.close();
        await rm(dir2, { recursive: true, force: true });
      });
    });
  });

  describe('provisionChannelId (KAN-10)', () => {
    /**
     * There is no opencode API for injecting a per-session environment
     * variable into the subprocess its bash tool spawns -- confirmed live
     * against a real local opencode 1.18.18 server: `GET /doc`'s schema for
     * `POST /session` and `POST /session/:id/prompt_async` has no `env`
     * field anywhere (only a `metadata` bag that's retrievable via the API,
     * not injected into tool-execution env), and the `Session` response
     * schema likewise has no `env` property. A live round-trip against that
     * same server also confirmed the bash tool's cwd is exactly the
     * session's own `directory` and that a file placed there beforehand is
     * readable by a relative path from that session's bash tool -- so this
     * writes a small, sourceable env file into the session's own distinct
     * folder (KAN-5: one folder per session, never shared) instead, which
     * needs no opencode cooperation at all.
     */
    it('writes a sourceable file into the session\'s own folder containing the given channel id under MATTERMOST_SESSION_CHANNEL_ID', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await handle.provisionChannelId('chan-abc-123');

      const written = await readFile(join(dir, SESSION_ENV_FILE_NAME), 'utf8');
      expect(written).toContain(`${MATTERMOST_SESSION_CHANNEL_ID_ENV_VAR}='chan-abc-123'`);
    });

    it('writes via a tmp-path-then-rename so no partial/temp file is left behind afterward (review kan10-1 F1: same atomic pattern as sessionNumberStore.ts/stateStore.ts)', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await handle.provisionChannelId('chan-abc-123');

      const entries = await readdir(dir);
      // Only the final marker file (and whatever `.gitignore` provisioning itself
      // added) should remain -- no `.tmp-<pid>-<uuid>` sibling left over from the
      // write, which is exactly what a `rename()`-into-place guarantees on success.
      expect(entries.filter((name) => name.startsWith(`${SESSION_ENV_FILE_NAME}.tmp-`))).toHaveLength(0);
      expect(entries).toContain(SESSION_ENV_FILE_NAME);
    });

    it('scopes the written file to this session\'s own folder, not another session\'s, when two sessions share the process', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      let created = 0;
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => {
          created += 1;
          return HttpResponse.json({ id: created === 1 ? 'ses_aaa' : 'ses_bbb' });
        }),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-provision-'));
      const handleA = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      const handleB = await harness.start({ folder: dir2, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await handleA.provisionChannelId('chan-for-a');
      await handleB.provisionChannelId('chan-for-b');

      const writtenA = await readFile(join(dir, SESSION_ENV_FILE_NAME), 'utf8');
      const writtenB = await readFile(join(dir2, SESSION_ENV_FILE_NAME), 'utf8');
      expect(writtenA).toContain('chan-for-a');
      expect(writtenA).not.toContain('chan-for-b');
      expect(writtenB).toContain('chan-for-b');
      expect(writtenB).not.toContain('chan-for-a');
      await rm(dir2, { recursive: true, force: true });
    });

    it('safely quotes a channel id containing a single quote rather than producing a broken/injectable file', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

      await handle.provisionChannelId("chan-'; rm -rf /");

      const written = await readFile(join(dir, SESSION_ENV_FILE_NAME), 'utf8');
      // A naive `export VAR='<value>'` with an unescaped embedded quote would break out of the
      // quoted string; this asserts the escaped form is present instead (KAN-10: "never fail
      // silently" also means never write a corrupt/injectable file for a hostile-looking value).
      expect(written).toContain(String.raw`chan-'\''; rm -rf /`);
    });

    it('rejects loudly (never silently swallows) when the folder is no longer writable -- e.g. removed out from under the session', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      server.use(
        healthyHandler(),
        agentAvailableHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });
      await rm(dir, { recursive: true, force: true });

      await expect(handle.provisionChannelId('chan-abc-123')).rejects.toThrow();
    });

    describe('.gitignore protection (review kan10-1 F3)', () => {
      it('best-effort adds an ignore rule for the marker file to the session folder\'s own .gitignore, since the folder is the operator\'s actual project directory, not a daemon-owned location', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        );
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

        await handle.provisionChannelId('chan-abc-123');

        const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
        expect(gitignore).toContain(`${SESSION_ENV_FILE_NAME}*`);
      });

      it('appends to an existing .gitignore rather than overwriting it, and does not duplicate the entry on a repeat call', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        );
        await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger: silentLogger() });

        await handle.provisionChannelId('chan-abc-123');
        await handle.provisionChannelId('chan-abc-123-renamed');

        const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
        expect(gitignore).toContain('node_modules/');
        const occurrences = gitignore.split(`${SESSION_ENV_FILE_NAME}*`).length - 1;
        expect(occurrences).toBe(1);
      });

      it('logs but does not throw when the .gitignore itself cannot be written, and still writes the real marker file (best-effort, not the loud-failure path)', async () => {
        const child = fakeChildProcess();
        const spawnProcess = vi.fn().mockReturnValue(child);
        server.use(
          healthyHandler(),
          agentAvailableHandler(),
          http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
        );
        // A directory at the `.gitignore` path makes both the read and the write
        // opencodeHarness.ts attempts against it fail with something other than
        // ENOENT (EISDIR) -- exercising the "some other error" branch, not just
        // "file doesn't exist yet".
        await mkdir(join(dir, '.gitignore'));
        const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
        const logger = silentLogger();
        const handle = await harness.start({ folder: dir, operatorUserId: OPERATOR_USER_ID, logger });

        await expect(handle.provisionChannelId('chan-abc-123')).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/gitignore/i), expect.anything());
        const written = await readFile(join(dir, SESSION_ENV_FILE_NAME), 'utf8');
        expect(written).toContain('chan-abc-123');
      });
    });
  });
});
