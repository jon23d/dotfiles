---
name: ts-linting
description: Use when setting up ESLint and/or Prettier in a TypeScript project, adding linting to an existing TypeScript codebase, or configuring typescript-eslint, eslint-config-prettier, or related packages.
---

# TypeScript Linting Setup

## Overview

ESLint v9+ with flat config (`eslint.config.ts`) and Prettier as a separate formatter. TypeScript projects must use type-aware rules.

## Packages

Always install these exact packages:

```
npm install --save-dev \
  eslint \
  @eslint/js \
  typescript-eslint \
  prettier \
  eslint-config-prettier
```

- `typescript-eslint` — the modern unified package (replaces the old `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` split)
- `eslint-config-prettier` — disables ESLint formatting rules that conflict with Prettier
- Never install `eslint-plugin-prettier` — running Prettier as an ESLint rule is slow and conflates two tools; run them as separate scripts instead

## Config file: `eslint.config.ts`

Always use TypeScript for the config file — not `.js`, not `.mjs`. ESLint v9 supports `.ts` configs natively with `typescript-eslint`.

```ts
// eslint.config.ts
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Ignore build artifacts — replaces .eslintignore in flat config
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },

  js.configs.recommended,

  // Type-checked rules — requires project: true
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Must be last: disables ESLint style rules that conflict with Prettier
  prettier,
);
```

Key points:

- `recommendedTypeChecked` (not just `recommended`) — enables type-aware rules like `no-floating-promises`, `no-misused-promises`, `await-thenable`
- `project: true` in `parserOptions` is required for type-aware rules
- `{ ignores: [...] }` must be a standalone object at the top — not nested inside another config object
- `prettier` spread must be **last**

## Prettier config: `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Add `.prettierignore`:

```
dist/
node_modules/
coverage/
```

## package.json scripts

```json
"scripts": {
  "lint":           "eslint .",
  "lint:fix":       "eslint . --fix",
  "format":         "prettier --write .",
  "format:check":   "prettier --check ."
}
```

Do not use `--ext .ts,.tsx` — that flag is v8-only and not valid in ESLint v9 flat config.

## Common mistakes

- **Using `.eslintrc.json` / `.eslintrc.js`** — legacy format, removed in ESLint v9. Always use flat config.
- **Using `eslint.config.js` or `.mjs`** — use `.ts` in TypeScript projects for type-safe config.
- **Using `tseslint.configs.recommended` without type checking** — use `recommendedTypeChecked` instead; it catches real runtime bugs.
- **Using separate `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`** — the unified `typescript-eslint` package replaces both.
- **Installing `eslint-plugin-prettier`** — don't; use `eslint-config-prettier` only.
- **Forgetting `ignores`** — flat config has no `.eslintignore`; ignores go inside `eslint.config.ts`.
- **Forgetting `prettier` is last** — if `prettier` isn't the final config entry, style rules conflict.
