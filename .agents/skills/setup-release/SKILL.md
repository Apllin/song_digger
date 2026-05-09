---
name: setup-release
description: Set up a Changesets-based release process for a JavaScript/TypeScript repository (monorepo or single-package). Installs @changesets/cli, writes .changeset/config.json, adds release scripts, and generates three GitHub Actions workflows: CI (PRs), RC releases (staging branch), and production releases (main branch).
allowed-tools: Read Glob Grep Bash Edit Write
---

Set up a Changesets-based release process for any JavaScript/TypeScript repository — monorepo or single-package — mirroring the `@vanya2h/common` release pipeline: RC releases from `staging`, production releases from `main`, version bumps synced back to `staging` and `develop`.

## Guiding principle

Default to doing the full setup end-to-end without asking. Only stop to ask when:

- A choice is genuinely ambiguous and cannot be inferred from the project.
- Proceeding would overwrite existing non-trivial configuration.

Batch any questions into a single prompt rather than asking one-by-one.

## Step 0 — Verify prerequisites

Check each requirement below **before doing any other work**. If any check fails, print a clear explanation of what is missing and why it is required, then **stop** — do not proceed to subsequent steps.

### 1. JavaScript / TypeScript project

A root `package.json` must exist. If it does not, stop:

> **Not supported:** No `package.json` found. This skill targets JavaScript/TypeScript projects only.

### 2. GitHub-hosted repository

Run `git remote get-url origin` (or `git remote -v`). The remote URL must contain `github.com`. If the command fails (no git repo or no remote) or the URL points elsewhere (GitLab, Bitbucket, Azure DevOps, etc.), stop:

> **Not supported:** The generated workflows are GitHub Actions and require a GitHub-hosted repository. Detected remote: `<url>`. Set up a GitHub remote or adapt the workflows manually for your CI provider.

### 3. At least one publishable package

**Monorepo** (has `pnpm-workspace.yaml`, `package.json#workspaces`, or `lerna.json`): check each workspace package's `package.json`. If every package has `"private": true`, stop.

**Single-package repo**: check the root `package.json` directly. If it has `"private": true`, stop.

Stop message:

> **Not supported:** All packages are marked `"private": true`. This release pipeline publishes packages to npm. If publishing is intentional (e.g. to a private registry), remove the `"private"` field from the packages that should be published and re-run.

---

If all checks pass, state which prerequisites were satisfied and continue to Step 1.

## Step 1 — Detect project info

Read the root `package.json` and project files to collect:

**Project type** — determines install flag and access detection in subsequent steps:
- **Monorepo**: `pnpm-workspace.yaml` exists, or root `package.json` has a `workspaces` field, or `lerna.json` exists.
- **Single-package**: none of the above.

**Package manager** — check for lock files in the project root:
- `pnpm-lock.yaml` → `pnpm`
- `yarn.lock` → `yarn`
- `package-lock.json` → `npm`
- `bun.lockb` or `bun.lock` → `bun`

If none found, check the `packageManager` field in `package.json`. If still none, default to `pnpm` and mention it.

**Corepack** — if `packageManager` field exists in root `package.json` (e.g. `"pnpm@10.32.1"`), corepack is in use. Add a "Enable Corepack" step (`corepack enable`) to workflows before the package manager setup step.

**Node version** — read `engines.node` from root `package.json`. Strip `>=` and take the major version (e.g. `>=25` → `25`). If absent, default to `22`.

**Install command**:
- pnpm: `pnpm install --frozen-lockfile`
- yarn: `yarn install --frozen-lockfile`
- npm: `npm ci`
- bun: `bun install --frozen-lockfile`

For the re-install step after versioning in the release workflow, omit `--frozen-lockfile` (versions change the lockfile).

**Package access**:
- Monorepo: if every workspace package has `"private": true`, use `"access": "restricted"`. Otherwise `"public"`.
- Single-package: if root `package.json` has `"private": true`, use `"access": "restricted"`. Otherwise `"public"`.

**Turbo** — if `turbo.json` exists at the root, the build command is whatever `"build"` script is in root `package.json` (e.g. `pnpm run build`). Same applies if no turbo — just use the root build script. Do not special-case turbo in the skill beyond detection.

## Step 2 — Check for existing setup

Before writing anything:

- **`.changeset/config.json` exists** — classify as "already initialized" and skip Steps 3 and 4. Mention in summary.
- **`.github/workflows/ci.yml` exists** — skip writing CI workflow. Mention in summary.
- **`.github/workflows/release.yml` exists** — skip writing release workflow. Mention in summary.
- **`.github/workflows/rc-release.yml` exists** — skip writing RC release workflow. Mention in summary.
- **`changeset` script already in root `package.json`** — skip adding scripts. Mention in summary.

If any of these are non-trivial customizations that would be silently overwritten, ask the user before proceeding.

## Step 3 — Install `@changesets/cli`

Install as a dev dependency. Run without asking — show the command as it runs.

For **monorepos**, the workspace root flag is required so the package manager installs at the root rather than a nested package:
- pnpm: `pnpm add -D -w @changesets/cli`
- yarn: `yarn add -D -W @changesets/cli`
- npm: `npm install --save-dev @changesets/cli`
- bun: `bun add -d @changesets/cli`

For **single-package repos**, omit the workspace root flag:
- pnpm: `pnpm add -D @changesets/cli`
- yarn: `yarn add -D @changesets/cli`
- npm: `npm install --save-dev @changesets/cli`
- bun: `bun add -d @changesets/cli`

## Step 4 — Write `.changeset/config.json`

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.5/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": ["@changesets/cli/commit", { "skipCI": "version" }],
  "fixed": [],
  "linked": [],
  "access": "<detected access>",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

Replace `<detected access>` with `"public"` or `"restricted"` from Step 1.

## Step 5 — Add scripts to root `package.json`

Add the following scripts to root `package.json` without asking, unless they already exist:

```json
"changeset": "changeset",
"changeset:version": "changeset version",
"changeset:publish": "changeset publish"
```

If any of these scripts already exist with different values, leave them unchanged and note it in the summary.

## Step 6 — Write GitHub Actions workflows

Create the `.github/workflows/` directory if it does not exist.

The workflow templates are stored alongside this skill file. Before writing any workflow, read the corresponding template using the Read tool — the path is relative to this SKILL.md file:

- `templates/ci.yml` — CI on PRs
- `templates/rc-release.yml` — RC release on `staging` push
- `templates/release.yml` — production release on `main` push

Then adapt each template for the target project by applying the substitutions below. Write the result to `.github/workflows/<name>.yml`.

**Substitutions to apply in all three workflows:**

- `node-version: 25` → replace `25` with the detected node major version
- `cache: pnpm` → replace `pnpm` with detected package manager, or remove the line entirely for bun
- `corepack enable` step → keep if corepack is detected; remove the entire step block if not
- `pnpm install --frozen-lockfile` → replace with the detected frozen install command
- `pnpm install` (unfrozen, re-install after versioning) → replace with the detected package manager's install command without `--frozen-lockfile`
- `pnpm run build` / `pnpm run test` / `pnpm run lint` → replace `pnpm` with detected package manager; omit the entire step if the corresponding script is absent from root `package.json`
- `pnpm changeset publish` → replace `pnpm` with detected package manager

## Step 7 — Summary

Print a short summary covering:

- Package manager, node version, and corepack status detected
- Package access (`public` / `restricted`)
- What was installed, written, and skipped (with reasons)
- Files created: `.changeset/config.json`, `.github/workflows/ci.yml`, `.github/workflows/rc-release.yml`, `.github/workflows/release.yml`
- Scripts added to root `package.json`

End the summary with a **Required setup** section listing the manual steps the user must do in GitHub:

```
## Required setup

1. Create GitHub environments named `main` and `staging` (Settings → Environments).
2. Add secrets to each environment:
   - `PAT_TOKEN` — a GitHub Personal Access Token with `repo` scope (needed to push version bump commits and tags from within Actions).
   - `NPM_TOKEN` — an npm publish token for the packages being released.
3. Ensure branches `main`, `staging`, and `develop` exist in the repository.
4. Protect `main` and `staging` branches as needed (release workflows push directly to them).
```

If anything didn't fit this skill (unknown package manager, existing workflows with custom logic, missing scripts in `package.json`), call it out clearly at the end.
