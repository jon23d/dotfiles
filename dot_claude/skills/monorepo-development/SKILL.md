---
name: monorepo-development
description: Use when developing in a pnpm monorepo, adding or modifying packages, managing cross-package dependencies, setting up shared configs (tsconfig, eslint, prettier), troubleshooting workspace resolution errors, managing package versions with Changesets, or setting up build pipelines across packages.
---

# Monorepo Development (pnpm Workspaces)

Every package is its own unit. The root only coordinates. Apply this principle to every decision.

## The non-negotiables

**Always run commands from the monorepo root.** Running `pnpm install` inside a package directory creates a nested `node_modules`, breaks workspace symlinks, and introduces phantom dependencies. No exceptions.

```bash
# Wrong — run from packages/api
cd packages/api && pnpm install

# Right — always from root with filter
pnpm add lodash --filter api
pnpm add -D typescript --filter ui
```

**Each package declares its own dependencies.** If `apps/dashboard` uses `lodash`, declare it in `apps/dashboard/package.json` — not just the root. Relying on hoisted packages is a phantom dependency and will break when the package is moved, published, or extracted.

**Use `workspace:*` for all internal packages.** Never pin an exact version for a package you own. Do not use `workspace:^` — it introduces version ambiguity at publish time that serves no purpose in a closed monorepo.

```json
// apps/dashboard/package.json
{
  "dependencies": {
    "@myorg/ui": "workspace:*",
    "@myorg/utils": "workspace:*"
  }
}
```

**Use `peerDependencies` for shared singletons in library packages.** If `packages/ui` is a React component library, React must be declared as a `peerDependency` — not a direct `dependency`. Declaring it as a direct dependency risks bundling two copies of React, which breaks hooks. Consumers (apps) declare it as a direct `dependency`; libraries declare it as a peer.

```json
// packages/ui/package.json — wrong, risks duplicate React
{ "dependencies": { "react": "^18.0.0" } }

// packages/ui/package.json — correct
{ "peerDependencies": { "react": "^18.0.0" }, "devDependencies": { "react": "^18.0.0" } }
```

## Package entry points — always point to built output

Never set `"main"` or `"exports"` to a `.ts` source file:

```json
// Wrong
{ "main": "src/index.ts" }

// Right
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

When a consumer gets "can't find module" or missing TypeScript types from an internal package, check this first.

**Exception:** TypeScript project references with `composite: true` allow source-to-source resolution without a build step — but this requires explicit `references` entries in every consuming `tsconfig.json`.

## Build ordering — never rely on parallel execution

`pnpm run --recursive` can run packages in parallel or arbitrary order. If `apps/dashboard` depends on `packages/ui`, a parallel build will fail non-deterministically.

Fix this with Turborepo:

```bash
pnpm add -Dw turbo
```

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

`"^build"` means "run `build` in all declared dependencies first." Replace `pnpm run --recursive build` with `turbo build`. Turborepo reads `workspace:*` dependencies to infer the graph automatically.

## Running scripts in a specific package

Always use `--filter` from the root:

```bash
pnpm run test --filter api
pnpm run build --filter ui
pnpm run lint --filter ...dashboard  # dashboard + all its deps
```

Never `cd` into a package to run scripts — it bypasses workspace resolution.

## Shared config management

Keep shared configs as proper workspace packages, not floating root files.

**TypeScript — `packages/tsconfig`:**

```
packages/tsconfig/
├── package.json       # { "name": "@myorg/tsconfig" }
├── base.json
├── nextjs.json
└── node.json
```

Each package extends from it:

```json
// apps/dashboard/tsconfig.json
{
  "extends": "@myorg/tsconfig/nextjs.json",
  "include": ["src"]
}
```

Add it as a dev dependency: `pnpm add -D @myorg/tsconfig --filter dashboard`.

**ESLint — `packages/eslint-config`:**

```js
// packages/eslint-config/index.js
module.exports = { extends: ['eslint:recommended'], rules: {} };
```

```json
// packages/eslint-config/package.json
{ "name": "@myorg/eslint-config", "main": "index.js" }
```

Each package's `.eslintrc.js`:

```js
module.exports = { extends: ['@myorg/eslint-config'] };
```

**Path aliases — use them in every app.** Relative imports like `../../../components/Button` are hard to read and break silently when files move. Define path aliases in each app's `tsconfig.json` and import from them consistently:

```json
// apps/dashboard/tsconfig.json
{
  "extends": "@myorg/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

Then import cleanly from anywhere in the app:

```ts
import { Button } from '@/components/Button';
import { userFactory } from '@/test_utils/factories/user';
import { useUser } from '@/hooks/useUser';
```

TypeScript respects aliases via `tsconfig.json`, but bundlers need an extra plugin to do the same — add it alongside the alias definition:

- Vite: `vite-tsconfig-paths` plugin
- Webpack: `tsconfig-paths-webpack-plugin`

The plugin and the `tsconfig.json` paths must be kept in sync — if you add a new alias to one, add it to the other.

## Environment variables — one root `.env`, no per-package `.env` files

All environment variables for every package live in a single root `.env`. Do not create `.env` files inside individual packages.

```bash
# root .env — single source of truth for the entire repo
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
NODE_ENV=development
JWT_SECRET=change-me-min-32-chars-xxxxxxxxxxx
PORT=3000
STRIPE_SECRET_KEY=sk_test_...
```

**Why one file:** per-package `.env` files cause drift (the same variable defined differently in two places), make onboarding harder (developers must populate N files instead of one), and create "works in isolation but not together" failures when variables are missing in a package that needs them.

**Each app still validates only its own variables.** A shared root `.env` doesn't mean every package reads every variable — per-package `env.ts` schemas (see zod-env skill) each declare exactly the subset they need. The root file is just where the values live.

**`dotenv` resolves relative to `process.cwd()`**, which is the monorepo root when commands run from there (as they always should). No path overrides needed.

**Always commit `.env.example` at the root. Never commit `.env`.** When adding a variable to any package's schema, add the example entry to the root `.env.example` in the same commit.

```bash
# root .env.example — committed, documents every variable across all packages
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
NODE_ENV=development
JWT_SECRET=change-me-min-32-chars-xxxxxxxxxxx
PORT=3000
STRIPE_SECRET_KEY=sk_test_your_key_here
```

## Versioning with Changesets

Use [Changesets](https://github.com/changesets/changesets) for version management. Do not bump versions manually.

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

**Workflow for a change:**

```bash
pnpm changeset          # describe what changed and semver bump (patch/minor/major)
pnpm changeset version  # bumps package.json versions + writes CHANGELOG.md entries
pnpm changeset publish  # publishes to npm (skip if private)
```

For private monorepos, use `"private": true` in each package's `package.json` to prevent accidental publishes. Changesets still handles version bumping and changelogs correctly.

If internal packages reference each other with `workspace:*`, you only need to run `changeset version` — it updates consuming packages automatically.

## Committing cross-package changes

When a change spans causally coupled packages — for example, a new export in `utils` and the consumer in `dashboard` using that export — commit them together. Splitting creates a non-buildable history state and breaks `git bisect`.

```
feat(utils): add formatCurrency helper, use in dashboard billing view
```

**Separate unrelated changes.** If you happen to be refactoring an internal function in `utils` and adding an unrelated feature to `dashboard` in the same session, these should be two commits. The rule is about causal coupling, not physical proximity.

## Troubleshooting

**`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`**

- The `name` in the package's `package.json` doesn't match. Check for typos and missing `@scope/` prefix.
- `pnpm-workspace.yaml` doesn't include the package's directory glob.

**TypeScript can't find types from an internal package**

- `"types"` points to a `.ts` source file — fix to `dist/index.d.ts`.
- The package hasn't been built — run its build first, or set up Turborepo.
- Missing `composite: true` and `references` if using TypeScript project references.

**Workspace symlinks broken**

- Someone ran `pnpm install` inside a package directory.
- Fix: `rm -rf packages/<name>/node_modules`, then `pnpm install` from root.

**Path alias not resolving in bundler**

- TypeScript is happy but Vite/Webpack fails — add the bundler plugin (see above).
- Bundler plugin installed but alias still fails — confirm the alias is defined in `tsconfig.json` paths and that `baseUrl` is set; the plugin reads from `tsconfig.json`, not from the bundler config directly.

## Checklist

- [ ] `pnpm install` and `pnpm add` always run from root with `--filter`
- [ ] Each package declares its own dependencies (no phantom dependency reliance)
- [ ] Internal dependencies use `workspace:*`
- [ ] Package `"main"` and `"types"` point to `dist/`, not `src/`
- [ ] Build ordering handled by Turborepo with `"^build"` in `turbo.json`
- [ ] Scripts run from root with `--filter`
- [ ] Shared configs live in dedicated packages (`@myorg/tsconfig`, `@myorg/eslint-config`)
- [ ] Path aliases defined in each app's `tsconfig.json` (`@/*` → `src/*` at minimum)
- [ ] Bundler alias plugin installed and configured (`vite-tsconfig-paths` or `tsconfig-paths-webpack-plugin`)
- [ ] Version changes managed with Changesets, not manual edits
- [ ] Cross-package changes committed atomically
- [ ] All env vars defined in root `.env`; no per-package `.env` files
- [ ] Root `.env.example` updated whenever any package adds a variable
