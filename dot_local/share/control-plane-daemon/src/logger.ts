/**
 * Structured JSON-line logger.
 *
 * Every log call emits exactly one line of JSON to stdout (info/debug) or
 * stderr (warn/error) -- never a bare string, never swallowed. systemd's
 * journald captures both streams, so `journalctl --user -u
 * control-plane-daemon` shows every failure mode instead of the daemon
 * quietly going dark (the whole point of KAN-2).
 */

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function serializeContext(context: LogContext | undefined): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value instanceof Error ? { message: value.message, stack: value.stack } : value;
  }
  return out;
}

function writeLine(
  sink: (line: string) => void,
  level: 'debug' | 'info' | 'warn' | 'error',
  component: string,
  message: string,
  context: LogContext | undefined,
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...serializeContext(context),
  };
  sink(JSON.stringify(payload));
}

export function createLogger(component: string): Logger {
  return {
    debug: (message, context) => writeLine((l) => console.log(l), 'debug', component, message, context),
    info: (message, context) => writeLine((l) => console.log(l), 'info', component, message, context),
    warn: (message, context) => writeLine((l) => console.error(l), 'warn', component, message, context),
    error: (message, context) => writeLine((l) => console.error(l), 'error', component, message, context),
  };
}
