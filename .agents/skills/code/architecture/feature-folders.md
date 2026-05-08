# Feature folders

The `web/` app is organized by **feature area**, not by file type. A feature is a coherent slice of user-facing functionality — not necessarily one Prisma model. Some features map to one model (`Favorite`, `DislikedTrack`), some to many (Auth = `User` + `Account` + `Session` + `VerificationCode` + `PasswordResetToken` + `AnonymousRequest` + `LoginAttempt`), and some to none (Label, Discography, Suggestions — upstream-only data with no row in our schema).

## Where things go

| Code                                                                                                                     | Location                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Atoms, hooks, feature-specific components, types, server actions, zod schemas                                            | `web/features/<feature>/`                                                                           |
| Page route                                                                                                               | `web/app/<route>/page.tsx` — thin shim that imports from `features/<feature>/`                      |
| API route handler                                                                                                        | `web/app/api/<route>/route.ts` — thin shim that imports from `features/<feature>/server/`           |
| Truly cross-cutting infra (prisma client/singleton, python-client, aggregator, auth helpers, anon-gate, fetch wrappers)  | `web/lib/`                                                                                          |
| Shared UI chrome used by every page (`Nav`, `BottomPlayer`, providers, layout primitives)                                | `web/components/`                                                                                   |

## Why pages and API routes stay in `app/`

Next App Router requires pages at `app/<route>/page.tsx` and handlers at `app/api/.../route.ts`. That's a framework constraint, not a stylistic choice. The route file should be a thin shim — an import plus re-export of a `LabelsPage` component or `handleLabelSearch` function from the feature folder. Validation, business logic, and data-shaping belong in the feature folder; the route file owns only the binding to Next's filesystem router.

## Suggested feature internals

Organize within a feature by file type. Don't pre-create empty folders — add them when there's a second file of that kind.

```
features/label/
  atoms.ts              // jotai atoms (e.g. labelsAtom)
  types.ts              // Label, LabelRelease (when not Prisma-derived)
  schemas.ts            // zod schemas for inputs / outputs
  hooks/
    useAllLabelReleases.ts
  components/
    LabelsPage.tsx
    LabelSearchBar.tsx
    LabelReleaseGrid.tsx
  server/               // server actions and route-handler bodies
    searchLabels.ts
    fetchLabelReleases.ts
```

## Promote on the second use

If a piece of code is used by **one** feature, it lives in that feature's folder. If a **second** feature needs it, hoist it to `web/lib/` (infra) or `web/components/` (shared UI). Don't pre-emptively hoist — first-use code stays local, and a second consumer is the trigger to extract.

## Don't reorganize speculatively

Don't sweep the whole codebase into `features/` in one PR. Pilot one feature, verify the seams feel right, then move other features as you touch them. Existing files outside `features/` are not bugs to fix — they migrate naturally as work touches them.

## Naming

- Folder is **singular**: `features/label/`, not `features/labels/`. The feature is the concept, not the collection.
- All file and folder casing follows `file-naming.md` — camelCase for hooks/utilities/atoms/schemas/types and folders, PascalCase only for React component `.tsx` files.
