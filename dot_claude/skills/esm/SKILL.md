---
name: esm
description: Use when writing JavaScript or TypeScript modules, creating Node.js projects, adding imports or exports, setting up package.json, tsconfig, or resolving file paths — ensure modern ESM is used instead of CommonJS.
---

# ESM: Modern JavaScript Modules

## Overview

Always use ECMAScript Modules (ESM). Never use CommonJS (`require`, `module.exports`, `__dirname`, `__filename`). This applies to all new files and to any existing file you edit — migrate it to ESM in the same pass.

## Rules — no exceptions

**Imports and exports:**

- Use `import` / `export` — never `require()` or `module.exports`
- Always include the `.js` extension on local imports (even when the source is `.ts`)
- Use named exports by default; use default exports only when the module has a single obvious export

**package.json:**

- Always include `"type": "module"` in every `package.json`
- Never omit it, even for small scripts or one-off utilities

**Path resolution (`__dirname` / `__filename`):**

- These globals do not exist in ESM. Use this pattern instead:
  ```js
  import { fileURLToPath } from 'node:url';
  import { dirname } from 'node:path';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  ```
- Prefer `import.meta.url` directly when only a URL is needed (e.g. `new URL('../data.json', import.meta.url)`)

**Node.js built-ins:**

- Use the `node:` protocol prefix: `import fs from 'node:fs'`, `import path from 'node:path'`

**Dynamic imports:**

- Use `await import('./module.js')` when lazy-loading is needed — not `require()`

## TypeScript

Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`. This is the only correct configuration for ESM TypeScript targeting Node.js.

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "dist"
  }
}
```

- Write `.js` extensions in import paths even in `.ts` files — TypeScript resolves the source but Node.js loads the compiled output
- `import type` for type-only imports to avoid runtime overhead

```ts
// Correct in a .ts file
import { formatDate } from './utils.js';
import type { Config } from './config.js';
```

## Migrating existing CJS files

When you edit any file that uses CommonJS, convert the whole file to ESM in the same edit:

- Replace all `require()` with `import`
- Replace all `module.exports = ...` / `exports.x = ...` with `export`
- Replace `__dirname` / `__filename` with the `fileURLToPath` pattern
- Add or confirm `"type": "module"` in `package.json`

## Common mistakes

- **Missing `"type": "module"`** → Node.js defaults to CJS, breaking all `import` statements. Fix: add `"type": "module"` to `package.json`.
- **Missing `.js` extension on local imports** → ESM does not auto-resolve extensions. `import './utils'` fails; `import './utils.js'` works.
- **Using `__dirname` directly** → Not defined in ESM. Use the `fileURLToPath` pattern above.
- **`require()` for JSON files** → Use `JSON.parse(await fs.readFile(new URL('./data.json', import.meta.url), 'utf8'))` or the import assertion syntax if supported.
- **Mixing CJS and ESM in the same project** → Pick ESM. CJS dependencies can still be imported via `import` — CJS interop works one-way (ESM can import CJS; CJS cannot `require` ESM).
- **`"module": "CommonJS"` in tsconfig** → Incompatible with ESM output. Use `"NodeNext"`.

## Quick reference

```js
// package.json
{ "type": "module" }

// Named export
export function formatDate(date) { ... }
export const config = { ... };

// Default export
export default class Server { ... }

// Import local module (extension required)
import { formatDate, slugify } from './utils.js';

// Import node built-in
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// __dirname equivalent
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// JSON file
const data = JSON.parse(
  await readFile(new URL('./data.json', import.meta.url), 'utf8')
);

// Dynamic import
const { default: mod } = await import('./plugin.js');
```
