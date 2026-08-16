import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_DAEMON_ENV_VAR, createOpencodeHarness } from './opencodeHarness.js';
import type { SpawnedProcessLike } from './opencodeHarness.js';
import type { Logger } from './logger.js';

const PORT = 47999;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const server = setupServer();

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A minimal fake child process -- mirrors socketClient.test.ts's WebSocketLike fakes: an
 * EventEmitter standing in for the real node:child_process handle, with test-only helpers
 * to simulate the events opencodeHarness.ts actually listens for. */
function fakeChildProcess(): SpawnedProcessLike & { emitExit(code: number | null): void; emitStderr(chunk: string): void } {
  const emitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const proc = {
    stderr: stderrEmitter,
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

    await expect(harness.start({ folder: join(dir, 'does-not-exist'), logger: silentLogger() })).rejects.toThrow(
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

    await expect(harness.start({ folder: filePath, logger: silentLogger() })).rejects.toThrow(/not a directory/i);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('spawns `opencode serve`, waits for it to become healthy, and creates a session scoped to the requested directory', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    let createdWithDirectory: string | undefined;
    server.use(
      healthyHandler(),
      http.post(`${BASE_URL}/session`, ({ request }) => {
        createdWithDirectory = new URL(request.url).searchParams.get('directory') ?? undefined;
        return HttpResponse.json({ id: 'ses_abc123' });
      }),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    const handle = await harness.start({ folder: dir, logger: silentLogger() });

    expect(handle).toBeDefined();
    expect(spawnProcess).toHaveBeenCalledWith(
      'opencode',
      expect.arrayContaining(['serve', '--port', String(PORT), '--hostname', '127.0.0.1']),
      expect.objectContaining({}),
    );
    expect(createdWithDirectory).toBe(dir);
  });

  it('spawns `opencode serve` with a distinguishing env var so an in-session agent can tell it is running under the daemon (kan7-2 F4)', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });

    await harness.start({ folder: dir, logger: silentLogger() });

    expect(spawnProcess).toHaveBeenCalledWith(
      'opencode',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ [CONTROL_PLANE_DAEMON_ENV_VAR]: '1' }) }),
    );
  });

  it('reuses the already-running shared server for a second session instead of spawning again', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-2-'));

    await harness.start({ folder: dir, logger: silentLogger() });
    await harness.start({ folder: dir2, logger: silentLogger() });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    await rm(dir2, { recursive: true, force: true });
  });

  it('spawns the shared server exactly once even when two `start()` calls race concurrently with no await between them (review kan5-1 F1)', async () => {
    const spawnProcess = vi.fn().mockImplementation(() => fakeChildProcess());
    server.use(
      healthyHandler(),
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
    const p1 = harness.start({ folder: dir, logger: silentLogger() });
    const p2 = harness.start({ folder: dir2, logger: silentLogger() });
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
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, async ({ request }) => {
        capturedBody = await request.json();
        capturedDirectory = new URL(request.url).searchParams.get('directory');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, logger: silentLogger() });

    await handle.sendPrompt('hello there');

    expect(capturedBody).toEqual({ parts: [{ type: 'text', text: 'hello there' }] });
    expect(capturedDirectory).toBe(dir);
  });

  it('sendPrompt rejects with a clear error when opencode responds non-2xx', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    server.use(
      healthyHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.post(`${BASE_URL}/session/ses_abc123/prompt_async`, () =>
        HttpResponse.json({ name: 'NotFoundError', data: { message: 'Session not found' } }, { status: 404 }),
      ),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, logger: silentLogger() });

    await expect(handle.sendPrompt('hello')).rejects.toThrow(/404/);
  });

  it('stop() deletes only this session via the opencode API and never throws even if that fails', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    let deletedId: string | undefined;
    server.use(
      healthyHandler(),
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
      http.delete(`${BASE_URL}/session/:id`, ({ params }) => {
        deletedId = params.id as string;
        return HttpResponse.json(true);
      }),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, logger: silentLogger() });

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
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, logger: silentLogger() });
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
      http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123' })),
    );
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
    const handle = await harness.start({ folder: dir, logger: silentLogger() });

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

    await expect(harness.start({ folder: dir, logger: silentLogger() })).rejects.toThrow(/address already in use/);
  });

  it('rejects with a clear timeout error if the server never becomes healthy in time', async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    // No `/global/health` handler registered -- every poll fails with a network error, and the
    // fake child process never emits 'exit', so this exercises the timeout path specifically.
    const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT, readyTimeoutMs: 100, readyPollIntervalMs: 10 });

    await expect(harness.start({ folder: dir, logger: silentLogger() })).rejects.toThrow(/ready|timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  describe('onRename (KAN-7)', () => {
    it('fires with the new title when opencode reports this session\'s title changed', async () => {
      const child = fakeChildProcess();
      const spawnProcess = vi.fn().mockReturnValue(child);
      const sse = controllableEventStream();
      server.use(
        healthyHandler(),
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, logger: silentLogger() });
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
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, logger: silentLogger() });
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
        http.post(`${BASE_URL}/session`, () => {
          created += 1;
          return HttpResponse.json({ id: created === 1 ? 'ses_aaa' : 'ses_bbb', title: 'New session - x' });
        }),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const dir2 = await mkdtemp(join(tmpdir(), 'control-plane-daemon-opencode-test-rename-'));
      const handleA = await harness.start({ folder: dir, logger: silentLogger() });
      await harness.start({ folder: dir2, logger: silentLogger() });
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
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, logger: silentLogger() });
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
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        sse.handler,
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const handle = await harness.start({ folder: dir, logger: silentLogger() });
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
        http.post(`${BASE_URL}/session`, () => HttpResponse.json({ id: 'ses_abc123', title: 'New session - x' })),
        http.get(`${BASE_URL}/event`, () => new HttpResponse(null, { status: 500 })),
      );
      const harness = createOpencodeHarness({ spawnProcess, pickPort: async () => PORT });
      const logger = silentLogger();
      const handle = await harness.start({ folder: dir, logger });

      expect(() => handle.onRename(vi.fn())).not.toThrow();
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    });
  });
});
