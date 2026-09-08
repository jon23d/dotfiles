---
name: monorepo-development
description: Use when developing in a monorepo with multiple packages — adding or modifying packages, managing cross-package dependencies, setting up shared configs, troubleshooting workspace resolution errors, managing package versions, or setting up build pipelines across packages.
---

# Monorepo Development

Every package is its own unit. The root only coordinates. Apply this principle to every decision.

## The non-negotiables

**Run commands through your workspace tool's package-scoping mechanism, from the repo root.** Never `cd` into a package directory to run installs or scripts — it bypasses workspace resolution and can create a nested dependency tree, broken workspace links, or phantom dependencies depending on the tool.

**Each package declares its own dependencies.** If a package uses a library, declare it in that package's own manifest — not just the root's. Relying on a dependency hoisted from elsewhere in the workspace is a phantom dependency and will break when the package is moved, published, or extracted.

## Build ordering — never rely on parallel or arbitrary execution

A recursive/all-packages script run can execute packages in parallel or arbitrary order. If one package depends on another's build output, a naive parallel build will fail non-deterministically.

Build ordering across dependent packages must be **explicit** — use a task runner that understands the dependency graph (built from your workspace's declared internal dependencies) and always builds a package's dependencies before the package itself. Never rely on execution order happening to work out.

## Environment variables — one root `.env`, no per-package `.env` files

All environment variables for every package live in a single root `.env`. Do not create `.env` files inside individual packages.

**Why one file:** per-package `.env` files cause drift (the same variable defined differently in two places), make onboarding harder (developers must populate N files instead of one), and create "works in isolation but not together" failures when variables are missing in a package that needs them.

**Each app still validates only its own variables.** A shared root `.env` doesn't mean every package reads every variable — each package's own env-validation schema declares exactly the subset it needs. The root file is just where the values live.

**Make sure your env-loading mechanism resolves relative to the repo root**, since commands should always run from there.

**Always commit `.env.example` at the root. Never commit `.env`.** When adding a variable to any package's schema, add the example entry to the root `.env.example` in the same commit.

```bash
# root .env.example — committed, documents every variable across all packages
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
NODE_ENV=development
JWT_SECRET=change-me-min-32-chars-xxxxxxxxxxx
PORT=3000
STRIPE_SECRET_KEY=sk_test_your_key_here
```

## Committing cross-package changes

When a change spans causally coupled packages — for example, a new export in `utils` and the consumer in `dashboard` using that export — commit them together. Splitting creates a non-buildable history state and breaks `git bisect`.

```
feat(utils): add formatCurrency helper, use in dashboard billing view
```

**Separate unrelated changes.** If you happen to be refactoring an internal function in `utils` and adding an unrelated feature to `dashboard` in the same session, these should be two commits. The rule is about causal coupling, not physical proximity.

## Checklist

- [ ] Package-scoped commands always run through the workspace tool, from root — never by `cd`-ing into a package
- [ ] Each package declares its own dependencies (no phantom dependency reliance)
- [ ] Build ordering handled by an explicit, dependency-graph-aware task runner
- [ ] Cross-package changes committed atomically
- [ ] All env vars defined in root `.env`; no per-package `.env` files
- [ ] Root `.env.example` updated whenever any package adds a variable

## Stack-specific guidance

Read `references/typescript.md` for TypeScript/Node-specific implementation detail before applying this skill to a TypeScript repo. A Go equivalent (`references/golang.md`) does not exist yet — if this skill applies to a Go repo, flag the gap rather than force-fitting the TypeScript reference.
