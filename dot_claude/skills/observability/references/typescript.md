# Observability — TypeScript

## Node.js / TypeScript

**Telemetry stack: OpenTelemetry.** All metrics, traces, and log correlation use the
OpenTelemetry SDK. This keeps instrumentation vendor-neutral — the exporter can be
swapped without changing application code.

### Required packages

```
@opentelemetry/api                        # stable API used in application code
@opentelemetry/sdk-node                   # Node.js SDK used in bootstrap only
@opentelemetry/auto-instrumentations-node # auto-instruments Express, HTTP, pg, redis, etc.
@opentelemetry/exporter-otlp-http         # pushes traces (and optionally metrics) via OTLP
@opentelemetry/exporter-prometheus        # exposes /metrics scrape endpoint for Prometheus
pino                                      # structured JSON logger
```

### Bootstrap

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

### Logging — pino with trace correlation

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

### Metrics

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

### Tracing — manual spans

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

### Health endpoints

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
