import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from './daemon.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createMattermostRestClient } from './mattermostRestClient.js';
import { createInMemorySessionStore } from './sessionStore.js';
import { createFileStateStore } from './stateStore.js';

const logger = createLogger('index');

function wsUrlFor(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/v4/websocket';
  return url.toString();
}

function defaultStateFilePath(): string {
  return join(homedir(), '.local', 'state', 'control-plane-daemon', 'state.json');
}

async function main(): Promise<void> {
  const env = loadEnv();
  const stateFilePath = env.STATE_FILE_PATH ?? defaultStateFilePath();

  logger.info('starting control-plane daemon', {
    mattermostUrl: env.MATTERMOST_URL,
    operatorEmail: env.OPERATOR_EMAIL,
    stateFilePath,
  });

  const restClient = createMattermostRestClient({ baseUrl: env.MATTERMOST_URL, token: env.MATTERMOST_MCP_TOKEN });
  const stateStore = createFileStateStore(stateFilePath);
  // In-memory only -- nothing populates this yet (KAN-5/KAN-6 land the
  // commands that create/end real sessions), so `list` sees an empty store
  // on every daemon start until those ship. See sessionStore.ts.
  const sessionStore = createInMemorySessionStore();

  const daemon = createDaemon({
    restClient,
    stateStore,
    sessionStore,
    logger: createLogger('daemon'),
    operatorEmail: env.OPERATOR_EMAIL,
    wsUrl: wsUrlFor(env.MATTERMOST_URL),
    token: env.MATTERMOST_MCP_TOKEN,
  });

  const shutdown = (signal: string): void => {
    logger.info('received shutdown signal, stopping cleanly', { signal });
    daemon.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await daemon.start();
  logger.info('control-plane daemon started');
}

// Any failure here is fatal and MUST be loud: a config error, a bad token,
// or a coding bug must crash the process with a visible error rather than
// leave a half-started daemon quietly not listening. systemd's
// Restart=always then retries (and repeated fast crashes are themselves
// visible in `systemctl --user status` / journald), instead of the failure
// mode this ticket exists to kill: something that "looks alive but isn't".
main().catch((err: unknown) => {
  logger.error('fatal error during startup', { err });
  process.exitCode = 1;
});

process.on('uncaughtException', (err) => {
  logger.error('uncaught exception -- exiting so systemd can restart the daemon', { err });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection -- exiting so systemd can restart the daemon', { reason });
  process.exit(1);
});
