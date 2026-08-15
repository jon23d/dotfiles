---
name: observability
description: Observability standards and instrumentation conventions. Load this skill when reviewing code for observability gaps, or when implementing logging, metrics, tracing, or health checks. Covers the four observability signals and stack-specific conventions for each supported language.
---

# Observability Standards

Observability is the ability to understand what a system is doing in production from
its external outputs alone. This skill defines what "good" looks like across four
primary signals and governs how the `reviewer` evaluates code for observability.

---

## The Four Signals

Every production service should emit all four signals. The absence of any one of them
creates a category of failure that is invisible to operators.

| Signal      | What it answers                                                               |
| ----------- | ----------------------------------------------------------------------------- |
| **Logs**    | What happened and when, in enough detail to reconstruct a sequence of events  |
| **Metrics** | How often and how fast — rates, latencies, counts, and queue depths over time |
| **Traces**  | Where time is spent across service and async boundaries                       |
| **Health**  | Is the service currently able to serve its purpose?                           |

---

## Universal Principles

These apply regardless of language, framework, or telemetry library.

### Logs

**Be structured.** Log output must be machine-parseable. Every log line should be a
key-value map or JSON object, not a free-form string. Unstructured logs cannot be
reliably queried, filtered, or alerted on.

**Use levels correctly.**

| Level             | When to use                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `trace` / `debug` | Development noise — loops, intermediate values, verbose state. Must not appear in production at default log level. |
| `info`            | Meaningful lifecycle events: service started, job completed, user action taken. Should be low-volume.              |
| `warn`            | Something unexpected happened but the service recovered. Worth investigating if it recurs.                         |
| `error`           | A failure that requires attention. Service may continue, but the operation failed.                                 |
| `fatal`           | Service cannot continue. Immediately precedes exit.                                                                |

**Propagate correlation IDs.** Every log line in a request-scoped path must include a
correlation or trace ID. This is the single most important thing for debuggability:
without it, log lines from concurrent requests are impossible to untangle.

- Extract the ID from the incoming request (e.g. `X-Correlation-ID`, `traceparent` header)
- Generate one if none is present
- Thread it through to every log line and every outgoing call within that request scope

**Never log sensitive data.** The following must never appear in log output:
passwords, secrets, API keys, tokens, full PII (names, emails, phone numbers,
addresses in combination), payment card data, or full request bodies by default.
Log identifiers (user ID, order ID) — not values (email address, card number).

**Log errors with context.** A useful error log includes: the error message and stack,
the correlation ID, and the identifiers of the resources involved. It does not include
the full input payload by default.

### Metrics

**Measure what matters.** Not every function needs a metric. Prioritise:

1. **Request/task throughput** — how many operations per unit time
2. **Latency** — p50, p95, p99 for I/O-bound operations (HTTP, DB, cache, queue)
3. **Error rate** — errors as a distinct count or label, not absorbed into success
4. **Queue/batch depth** — for async systems, how much work is waiting

**Naming conventions** (stack-specific conventions below, but general rules):

- Use `snake_case`
- Prefix with the service name: `payments_charge_duration_ms`
- For counters, suffix with `_total`: `payments_charge_errors_total`
- For histograms/timers, suffix with the unit: `_duration_ms`, `_bytes`

**Avoid high-cardinality labels.** Labels like `user_id`, `request_id`, or `url_path`
with arbitrary values create metric cardinality explosions. Use bounded label values
(e.g. `status=success|error`, `method=GET|POST`).

### Distributed Tracing

**Instrument service boundaries.** At minimum, create or continue a trace span at
every point where work crosses a boundary: incoming HTTP request, outgoing HTTP call,
database query, message publish, message consume.

**Propagate context.** Extract trace context from incoming requests (W3C `traceparent`
header is the standard). Inject it into outgoing requests and async messages.

**Name spans usefully.** A span name should identify the operation type and resource:
`GET /users/:id`, `db.query users`, `queue.publish order.created`.

**Add attributes for debuggability.** Useful span attributes:

- `http.method`, `http.status_code`, `http.url` (sanitised)
- `db.system`, `db.operation`, `db.table`
- `messaging.system`, `messaging.destination`
- `error.type`, `error.message` when the span represents a failure

### Health Endpoints

**Every network service must have a health endpoint.** A service without one cannot
be monitored by infrastructure tooling (load balancers, Kubernetes, uptime checkers).

**Health checks must be meaningful.** A health endpoint that always returns `200 OK`
with no checks is worse than useless — it masks failures. Check:

- Database connectivity (can you run a lightweight query?)
- Cache reachability (can you reach the cache server?)
- Any external dependency that the service cannot function without

**Distinguish liveness from readiness if needed.** In environments that support it
(e.g. Kubernetes):

- **Liveness** (`/health/live`): is the process alive and not deadlocked?
- **Readiness** (`/health/ready`): is the service able to handle traffic right now?

A single `/health` endpoint is acceptable when liveness/readiness distinction is
not required by the deployment environment.

---

## Stack-Specific Conventions

### Node.js / TypeScript

**Telemetry stack: OpenTelemetry.** All metrics, traces, and log correlation use the
OpenTelemetry SDK. This keeps instrumentation vendor-neutral — the exporter can be
swapped without changing application code.

#### Required packages

```
@opentelemetry/api                        # stable API used in application code
@opentelemetry/sdk-node                   # Node.js SDK used in bootstrap only
@opentelemetry/auto-instrumentations-node # auto-instruments Express, HTTP, pg, redis, etc.
@opentelemetry/exporter-otlp-http         # pushes traces (and optionally metrics) via OTLP
@opentelemetry/exporter-prometheus        # exposes /metrics scrape endpoint for Prometheus
pino                                      # structured JSON logger
```

#### Bootstrap

The SDK **must** be initialised before any other imports. Place setup in a dedicated
`src/tracing.ts` and load it via `--import ./src/tracing.js` (ESM) or
`--require ./src/tracing.js` (CJS) in the process start command. Never `import` it
from application code.

```typescript
// src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// Only export traces if a collector endpoint is configured.
// Without this guard, the OTLP exporter will emit noisy connection errors in
// local dev environments that don't have a collector running.
const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? new OTLPTraceExporter() : undefined;

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'unknown-service',
    [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? 'dev',
  }),
  traceExporter,
  metricReader: new PrometheusExporter({ port: 9464 }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)));
```

Developers who want local traces can add a Jaeger (or compatible) container to
`docker-compose.yml` and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
in their `.env`. Without it, the SDK still runs — auto-instrumentation, context
propagation, and log correlation all work; traces are simply not exported.

#### Logging — pino with trace correlation

Use `pino` for structured JSON logging. Inject the active OTel trace and span IDs
via a `mixin` so every log line is automatically correlated to its trace.

```typescript
// src/logger.ts
import pino from 'pino';
import { trace } from '@opentelemetry/api';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  mixin() {
    const span = trace.getActiveSpan();
    if (!span?.isRecording()) return {};
    const { traceId, spanId } = span.spanContext();
    return { traceId, spanId };
  },
});
```

Create a child logger at the request boundary to attach request-scoped fields:

```typescript
// Express middleware
app.use((req, res, next) => {
  req.log = logger.child({
    requestId: req.headers['x-request-id'] ?? crypto.randomUUID(),
    method: req.method,
    path: req.path,
  });
  next();
});

// Usage in handlers
req.log.info({ userId: user.id }, 'User authenticated');
req.log.error({ err, userId: user.id }, 'Login failed');
```

Never use `console.log` in production paths — it produces unstructured output and
cannot be controlled by log level.

#### Metrics

Define instruments at module scope. Use OTel semantic convention naming
(`http.server.request.duration`); the Prometheus exporter converts dots to underscores
automatically.

```typescript
// src/metrics.ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('my-service');

export const httpRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'HTTP server request duration',
  unit: 'ms',
});

export const httpRequestTotal = meter.createCounter('http.server.request.total', {
  description: 'Total HTTP server requests',
});
```

Record at the point of observation, with bounded label values only:

```typescript
httpRequestDuration.record(Date.now() - startTime, {
  'http.request.method': req.method,
  'http.response.status_code': String(res.statusCode),
  'http.route': req.route?.path ?? 'unknown',
});
```

#### Tracing — manual spans

Auto-instrumentation covers HTTP, Express, pg, redis, and most common libraries.
Add manual spans at meaningful **business operation boundaries** that auto-instrumentation
does not cover.

Use `startActiveSpan` (not `startSpan`) — it sets the new span as active in async
context, so any auto-instrumented child calls are automatically nested under it.

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');

async function processOrder(orderId: string) {
  return tracer.startActiveSpan('order.process', async (span) => {
    span.setAttribute('order.id', orderId);
    try {
      const result = await doWork(orderId);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end(); // always end the span, even on error
    }
  });
}
```

Context propagation across async boundaries uses `AsyncLocalStorage` and is handled
automatically by the SDK. No manual context threading is required in standard
async/await code.

#### Health endpoints

```typescript
app.get('/health', async (req, res) => {
  const checks = await Promise.allSettled([
    db.raw('SELECT 1'), // database connectivity
    cache.ping(), // cache reachability
  ]);
  const healthy = checks.every((c) => c.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: {
      database: checks[0].status,
      cache: checks[1].status,
    },
  });
});
```

---

## What the Observability Reviewer Checks

Load this skill before reviewing. The reviewer evaluates against the universal
principles above, not against any specific library. A verdict of `"fail"` means
critical or major issues exist that leave operators blind in production.

Severity reference:

| Severity     | Examples                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **critical** | Caught exception with no log, no metric, no rethrow; sensitive data in a log statement; network service with no health endpoint; background worker with zero error signal         |
| **major**    | Unstructured logging in request path; no correlation ID on any log line in request-scoped code; no latency measurement on I/O operations; health endpoint that always returns 200 |
| **minor**    | Log line missing a useful context field; wrong log level; high-cardinality metric label; span missing a useful attribute                                                          |
