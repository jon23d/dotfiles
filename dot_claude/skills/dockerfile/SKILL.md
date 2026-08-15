---
name: dockerfile
description: Use when writing, reviewing, or editing a Dockerfile or docker-compose file. Use when asked to "containerize", "dockerize", "add Docker support", or "write a Dockerfile" for any application or service.
---

# Dockerfile Best Practices

Every Dockerfile decision affects security, build speed, and image size. Apply these rules without exception.

**This project is Node.js / TypeScript.** Read `node.md` before writing any code.

## Base image — pin to a specific version tag

Never use `latest`. Pin to a specific version tag. Prefer minimal variants.

```dockerfile
# Bad
FROM node:latest

# Good
FROM node:22.3-slim
```

Use `-slim` or `-alpine` variants unless you have a specific reason not to. Alpine is smallest but can cause compatibility issues with native binaries — use `-slim` when unsure.

If the project has a `.tool-versions`, `package.json engines`, or equivalent, match the pinned version there.

## Layer ordering — stable layers first, volatile layers last

Docker caches layers. A changed layer invalidates all layers below it. Order from least-to-most frequently changing:

```dockerfile
# Bad — source code copied before deps; deps reinstall on every code change
COPY . .
RUN npm install

# Good — deps installed before source; cache survives code changes
COPY package.json package-lock.json ./
RUN npm install
COPY . .
```

Rule: copy only what's needed for the next step. Don't `COPY . .` until after all dependency installs.

## Multi-stage builds — never ship build tools

Use multi-stage builds to keep dev dependencies and build artifacts out of the production image.

```dockerfile
# Stage 1: build
FROM node:22.3-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production
FROM node:22.3-slim AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
```

The final stage should contain only what's needed to run the application.

## Secrets — never bake them into the image

Secrets in `ENV` or `ARG` instructions are visible in the image history.

```dockerfile
# Bad — secret visible in `docker history`
ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
RUN npm install

# Good — secret used only during build, not stored in layer
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) \
    npm install
```

For runtime secrets, use environment variables injected at runtime — never hardcoded in the Dockerfile.

## Non-root user — never run as root

```dockerfile
# Add at the end of your final stage, before CMD
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser
```

Some base images (e.g. `node:slim`) include a default non-root user — use it:

```dockerfile
USER node
```

## .dockerignore — always create one

Without `.dockerignore`, the entire build context is sent to the daemon, including secrets, dev files, and `.git`.

Minimum `.dockerignore`:

```
.git
.env
*.env
node_modules
__pycache__
.DS_Store
```

Add any build artifacts, test output, or local config that shouldn't be in the image.

## HEALTHCHECK — always define one

Orchestrators (Kubernetes, ECS, Docker Swarm) use `HEALTHCHECK` to detect unhealthy containers. Without it, a crashed app inside a running container looks healthy.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
```

Adjust the path and port to match your application's actual port. If the app doesn't have an HTTP health endpoint, add one.

## Image size — verify before shipping

After building, check the image size:

```bash
docker images <image-name>
docker history <image-name>  # shows which layers are largest
```

If the image is unexpectedly large:

- Confirm you're using a slim/alpine base
- Confirm multi-stage build is in use
- Check for leftover package manager caches — clear them in the same `RUN` step that installs:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
 && rm -rf /var/lib/apt/lists/*
```

## Checklist

- [ ] Base image pinned to specific version tag, slim/alpine variant used
- [ ] Node.js-specific rules applied (read `node.md`)
- [ ] Dependency files copied and installed before source code
- [ ] Multi-stage build used; final stage contains only runtime artifacts
- [ ] No secrets in `ENV`, `ARG`, or `RUN` commands
- [ ] Non-root user set in final stage
- [ ] `.dockerignore` created and includes `.git`, `.env`, build artifacts
- [ ] `HEALTHCHECK` defined with appropriate path and interval
- [ ] Image size verified with `docker images` after build
