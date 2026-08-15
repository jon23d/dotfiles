# Node.js

## Base image

Use the official `node` image, pinned to the version in `package.json` `engines` field or `.nvmrc` / `.tool-versions` if present. Prefer `-slim`.

```dockerfile
FROM node:22.3-slim AS base
```

Avoid Alpine for Node unless you've confirmed all native dependencies compile correctly — many npm packages with native bindings fail silently on musl libc.

## Package manager — use `ci` not `install`

```dockerfile
# Bad — install can silently upgrade packages
RUN npm install

# Good — ci installs exact versions from lockfile, fails if lockfile is out of sync
RUN npm ci --omit=dev
```

Use `--omit=dev` in the production stage to exclude devDependencies. In the build stage, omit this flag so build tools are available.

## Lockfile — always copy it

```dockerfile
# npm
COPY package.json package-lock.json ./

# yarn
COPY package.json yarn.lock ./

# pnpm
COPY package.json pnpm-lock.yaml ./
```

Never `COPY package.json ./` without the lockfile — cache will miss on lockfile changes and `npm ci` will fail.

## Multi-stage pattern for Node

```dockerfile
FROM node:22.3-slim AS base
WORKDIR /app

# Stage 1: install all deps and build
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production — only runtime deps and built output
FROM base AS production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

## CMD — use exec form, not shell form

```dockerfile
# Bad — shell form spawns a shell process; signals not forwarded to Node
CMD "node dist/index.js"

# Good — exec form; Node receives signals directly (graceful shutdown works)
CMD ["node", "dist/index.js"]
```

## NODE_ENV

Set in the production stage:

```dockerfile
ENV NODE_ENV=production
```

This disables dev-only behaviour in many frameworks and enables production optimisations.

## .dockerignore for Node

```
.git
.env
*.env
node_modules
npm-debug.log
dist
.next
coverage
.DS_Store
```

`node_modules` must be in `.dockerignore` — copying local modules into the build context defeats the purpose of `npm ci` and can introduce platform-incompatible binaries.

## Checklist

- [ ] Base image version matches `engines` / `.nvmrc` / `.tool-versions`
- [ ] `npm ci` used (not `npm install`)
- [ ] `--omit=dev` used in production stage only
- [ ] Lockfile copied alongside `package.json`
- [ ] `node_modules` in `.dockerignore`
- [ ] Multi-stage build: builder installs all deps, production reinstalls with `--omit=dev`
- [ ] `CMD` uses exec form
- [ ] `NODE_ENV=production` set in final stage
- [ ] Non-root user set
- [ ] `HEALTHCHECK` defined
