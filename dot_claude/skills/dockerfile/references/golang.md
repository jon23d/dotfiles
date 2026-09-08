# Dockerfile — Go

The universal rules in the main skill (base-image pinning, layer ordering,
multi-stage builds, no secrets in `ENV`/`ARG`/`RUN`, non-root user,
`.dockerignore`, `HEALTHCHECK`, image-size checklist) apply as-is.

## Multi-stage build

Go's static-binary compilation makes this simpler than most languages: the
build stage needs the full Go toolchain, but the final runtime image needs
nothing but the compiled binary (and CA certs, if the service makes outbound
TLS calls).

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build
WORKDIR /src

# Dependency layer cached separately from source, per the universal
# "dependency files before source code" rule.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/widgetsvc ./cmd/widgetsvc

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=build /out/widgetsvc /widgetsvc

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/widgetsvc"]
```

Notes:
- `CGO_ENABLED=0` produces a fully static binary with no libc dependency —
  this is what makes a `distroless/static` or `scratch` final image possible
  at all. If a dependency genuinely requires cgo, use `distroless/base`
  (has glibc) instead of `distroless/static`.
- `distroless/static-debian12:nonroot` has no shell, no package manager, and
  already runs as a non-root user — smaller attack surface than
  `alpine`/`scratch` plus a manually-added user, and satisfies the universal
  "non-root user" rule by construction rather than requiring a `USER`
  directive to remember (a plain `scratch` base has no `nonroot` user
  built in, so `distroless` is the better default over bare `scratch`).
- Migrations run separately (via `just migrate-up` in CI/CD or a deploy
  step against `goose`), not baked into the service image — the runtime
  image has no migration tooling in it at all.

## Bind address inside a container

The `:PORT` binding rule from `golang-project-layout` still applies
unchanged inside a container — a container's network namespace makes
"all interfaces" mean "the container's interface," and `EXPOSE` +
port-mapping (`-p host:container`, or compose's `ports:`) is what actually
controls host reachability. No container-specific binding logic is needed
beyond what's already established for local dev.
