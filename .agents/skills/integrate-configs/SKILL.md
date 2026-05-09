---
name: integrate-configs
description: Integrate @vanya2h/eslint-config, @vanya2h/prettier-config, @vanya2h/typescript-config, and sort-package-json into the current project. Detects existing configs and asks before replacing them.
argument-hint: "[base|node|react|lib]"
allowed-tools: Read Glob Grep Bash
---

Integrate `@vanya2h/eslint-config`, `@vanya2h/prettier-config`, `@vanya2h/typescript-config`, and `sort-package-json` into the current project.

## Guiding principle

The user wants all three configs integrated with as little friction as possible. Default to doing the integration end-to-end without asking. Only stop to ask the user when:

- A choice is genuinely ambiguous (e.g. project type cannot be inferred).
- Proceeding would silently destroy non-trivial user customizations (e.g. an existing ESLint config with custom rules, or a `tsconfig.json` whose `compilerOptions` would conflict with the shared base).
- Something unexpected is found that is not covered by this skill.

When you do need to ask, batch related questions into one prompt rather than asking one-by-one. Never ask "yes/no" for things that are obviously correct (e.g. adding lint scripts, replacing an empty/default config, replacing a `"prettier"` package.json key with the shared one).

## Step 1 — Determine the project type

If the user passed an argument (`base`, `node`, `react`, `lib`), use it directly and skip detection.

Otherwise, detect the type per package:

1. **Find packages.** If `pnpm-workspace.yaml`, `lerna.json`, or a `workspaces` field in root `package.json` exists, treat as monorepo and discover each package's `package.json`. Otherwise, the single root is the only package.
2. **Infer type for each package** by reading its `package.json`:
   - `react` or `react-dom` in `dependencies`/`peerDependencies` → **react**
   - `bin` field present, or `express`/`fastify`/`koa`/`hono`/`next`/`@nestjs/core` in dependencies, or `"type": "module"` with a server-shaped entry → **node**
   - `main`/`module`/`exports` set, `private` is false or absent, and no React/server signals → **lib**
   - Otherwise → **base**
3. **Only ask the user** when signals are conflicting or absent (e.g. no dependencies at all, or both React and a server framework). Ask once per ambiguous package, listing what you found:

   > Couldn't confidently determine type for `{packageName}`. Found: `{signals}`. Pick one:
   >
   > 1. `base` — generic TypeScript package
   > 2. `node` — Node.js app or server
   > 3. `react` — React / browser app
   > 4. `lib` — TypeScript library (builds to ESNext/Bundler)
   > 5. `next` — Next.js app

   If multiple packages are ambiguous, batch them into a single prompt.

State the inferred type(s) before continuing so the user can correct you, but do not block on confirmation.

## Step 2 — Detect the package manager

Check lock files in the project root:

- `pnpm-lock.yaml` → `pnpm`
- `yarn.lock` → `yarn`
- `package-lock.json` → `npm`
- `bun.lockb` or `bun.lock` → `bun`

If none found, check `packageManager` field in root `package.json`. If still none, default to `npm` and mention it in the summary. Do not ask.

## Step 3 — Detect existing configs

For each target package, check for:

**ESLint:** `eslint.config.{js,mjs,cjs,ts}`, `.eslintrc{,.js,.cjs,.json,.yaml,.yml}`
**Prettier:** `prettier.config.{js,mjs,cjs}`, `.prettierrc{,.js,.cjs,.json,.yaml,.yml}`, or `"prettier"` key in `package.json`
**TypeScript:** `tsconfig.json`

For each found file, classify it as one of:

- **Already shared** — extends/imports `@vanya2h/*`. Skip; nothing to do.
- **Trivial / default** — empty, single-line, or only references a removable preset (e.g. `"prettier": "some-other-config"`, an `.eslintrc` with just `extends: ["eslint:recommended"]`). Replace silently; mention in the summary.
- **Customized** — contains user rules, plugins, overrides, or non-standard `compilerOptions`. **Ask before replacing.**

For customized configs, batch all of them into a single prompt that lists what would be replaced and what the customizations are, e.g.:

> Found customized configs. Replace them with shared configs?
>
> - `eslint.config.js` — has 3 custom rules and a plugin (`eslint-plugin-foo`)
> - `tsconfig.json` — sets `strict: false`, custom `paths`
>
> Reply with the items to keep (e.g. "keep tsconfig"), or "replace all", or "skip all".

For `tsconfig.json` specifically: even when replacing, **preserve** user-set `compilerOptions` (other than ones the shared base sets), `include`, `exclude`, `references`, and `paths`. Only rewrite the `extends` field and add the `$schema` line.

## Step 4 — Install packages

Based on which configs will be written, install needed packages per target package (or at workspace root for monorepos using a single shared config). Run installs without asking — show the command line as it runs.

| Config            | Packages                                   |
| ----------------- | ------------------------------------------ |
| ESLint            | `@vanya2h/eslint-config eslint typescript` |
| Prettier          | `@vanya2h/prettier-config prettier`        |
| TypeScript        | `@vanya2h/typescript-config typescript`    |
| sort-package-json | `sort-package-json`                        |

Always install `sort-package-json` regardless of which other configs are selected.

Use the package manager detected in Step 2:

- `pnpm add -D …` (add `-w` or `--filter <pkg>` as appropriate for monorepos)
- `yarn add -D …`
- `npm install --save-dev …`
- `bun add -d …`

If `typescript` is requested by multiple configs, install once.

## Step 5 — Write config files

### ESLint

Delete any old ESLint config files that were approved for replacement (or were classified as trivial). Create `eslint.config.mjs`:

**base:**

```js
import { config } from "@vanya2h/eslint-config/base";

export default [...config];
```

**node:**

```js
import { config } from "@vanya2h/eslint-config/node";

export default [...config];
```

**react:**

```js
import { config } from "@vanya2h/eslint-config/react";

export default [...config];
```

**next:**

```js
import { config } from "@vanya2h/eslint-config/next";

export default [...config];
```

For `lib`, use `base`.

### Prettier

Delete any old Prettier config files that were approved for replacement (or trivial). Remove `"prettier"` key from `package.json` if present and not already `@vanya2h/prettier-config`. Then set:

```json
"prettier": "@vanya2h/prettier-config"
```

### TypeScript

If `tsconfig.json` does not exist, create it from the template below. If it exists, only update the `"extends"` field (and add `$schema` if missing). Preserve all other fields.

**base:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@vanya2h/typescript-config/base"
}
```

**node:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@vanya2h/typescript-config/node",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**react:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@vanya2h/typescript-config/react",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**lib:**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@vanya2h/typescript-config/lib",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

If an existing `tsconfig.json` has `compilerOptions` that would conflict with the shared base in a way you can't auto-resolve (e.g. `strict: false`, mismatched `module`/`target`, custom `jsx` for a non-React project), surface those specific lines to the user and ask whether to keep them or let the shared config win.

## Step 6 — Add scripts

### sort-pkg script

Always add `sort-pkg` to `package.json` without asking, mirroring the root pattern exactly.

For a **single-package project**:

```json
"sort-pkg": "sort-package-json package.json"
```

For a **monorepo** (has `pnpm-workspace.yaml`, `lerna.json`, or a `workspaces` field with `packages/*`):

```json
"sort-pkg": "sort-package-json \"package.json\" \"packages/*/package.json\""
```

If `sort-pkg` already exists, leave it unchanged and note it in the summary.

### lint scripts

If `package.json` has no `"lint"` script, add the following without asking.

**Single-package project:**

```json
"lint": "sort-package-json --check package.json && eslint ./",
"lint:fix": "sort-package-json package.json && eslint ./ --fix"
```

**Turborepo monorepo** (`turbo.json` present at root) — root `package.json` delegates to turbo, which runs each package's own scripts:

```json
"lint": "sort-package-json --check \"package.json\" \"packages/*/package.json\" && turbo lint",
"lint:fix": "sort-package-json \"package.json\" \"packages/*/package.json\" && turbo lint:fix"
```

Each individual package's `package.json` gets the per-package scripts directly (not via turbo):

```json
"lint": "eslint ./",
"lint:fix": "eslint ./ --fix"
```

Also add `lint:fix` to `turbo.json` if it is not already listed under `tasks`:

```json
"lint:fix": {
  "dependsOn": ["^lint:fix"]
}
```

**Non-turbo monorepo** — use the package manager's workspace `run` command to delegate to each package:

- pnpm: `"lint:fix": "sort-package-json \"package.json\" \"packages/*/package.json\" && pnpm -r run lint:fix"`
- yarn: `"lint:fix": "sort-package-json \"package.json\" \"packages/*/package.json\" && yarn workspaces run lint:fix"`
- npm: `"lint:fix": "sort-package-json \"package.json\" \"packages/*/package.json\" && npm run lint:fix --workspaces"`

Each individual package still gets its own `lint` / `lint:fix` eslint scripts as above.

If a `"lint"` script already exists and looks unrelated to ESLint (e.g. runs a different linter), leave it and mention it in the summary so the user can decide.

### check-types script

If `package.json` has no `"check-types"` script, add the following without asking.

**Single-package project:**

```json
"check-types": "tsc -b --noEmit"
```

**Turborepo monorepo** (`turbo.json` present at root) — root `package.json` delegates to turbo:

```json
"check-types": "turbo check-types"
```

Each individual package's `package.json` gets the per-package script directly (not via turbo):

```json
"check-types": "tsc -b --noEmit"
```

Also add `check-types` to `turbo.json` if it is not already listed under `tasks`:

```json
"check-types": {
  "dependsOn": ["^check-types"]
}
```

**Non-turbo monorepo** — use the package manager's workspace `run` command to delegate to each package:

- pnpm: `"check-types": "pnpm -r run check-types"`
- yarn: `"check-types": "yarn workspaces run check-types"`
- npm: `"check-types": "npm run check-types --workspaces"`

Each individual package still gets its own `check-types` script as above.

If a `"check-types"` script already exists, leave it unchanged and note it in the summary.

## Step 7 — Update README.md

If a `README.md` exists in the target package (or workspace root for monorepos), find the section that documents scripts or commands — typically a heading like `## Scripts`, `## Commands`, `## Development`, or similar. Add entries for each script that was added in Step 6 and is not already documented:

| Script        | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `sort-pkg`    | Sort `package.json` field order using `sort-package-json`.          |
| `lint`        | Check `package.json` field order and lint source files with ESLint. |
| `lint:fix`    | Fix `package.json` field order and auto-fix ESLint issues.          |
| `check-types` | Type-check the project with `tsc`.                                  |

If no scripts/commands section exists, append one at the end of the file:

```markdown
## Scripts

| Script        | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `sort-pkg`    | Sort `package.json` field order using `sort-package-json`.          |
| `lint`        | Check `package.json` field order and lint source files with ESLint. |
| `lint:fix`    | Fix `package.json` field order and auto-fix ESLint issues.          |
| `check-types` | Type-check the project with `tsc`.                                  |
```

If no `README.md` exists, skip this step entirely — do not create one.

## Step 8 — Summary

Print a short summary listing, per package:

- Detected/selected type
- Configs installed and written
- Configs skipped, with the reason (already shared, kept on user request, conflict left for the user)
- Files deleted
- Anything that needs the user's manual follow-up

If you encountered anything that didn't fit this skill (unusual file layout, unknown config flavor, monorepo tooling not covered above), call it out clearly at the end rather than silently doing nothing.
