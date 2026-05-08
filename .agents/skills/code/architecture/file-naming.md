# File and folder naming

All file and folder names under `web/` use **camelCase**, with one exception: React component files use **PascalCase**.

## The rule

| What                                                            | Convention      | Example                                                   |
| --------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| React component files (`.tsx` exporting a component)            | PascalCase      | `QueryProvider.tsx`, `LabelsPage.tsx`                     |
| Hook files                                                      | camelCase       | `useAllLabelReleases.ts`                                  |
| Utilities, atoms, schemas, types, server-action modules         | camelCase       | `fetchWithAnonGate.ts`, `labelAtom.ts`, `searchSchema.ts` |
| Folders                                                         | camelCase       | `features/label/`, `featureFlags/`                        |
| Test files                                                      | mirror source   | `useAllLabelReleases.test.ts`                             |

## What "React component file" means

A `.tsx` file whose export is a component rendered as JSX (`<QueryProvider>`, `<LabelsPage>`). If a `.tsx` file hosts only hooks or non-component utilities, it's camelCase — but prefer `.ts` for those.

Next App Router special files (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`) keep the framework-mandated lowercase names. The rule applies to user-named files only.

## Anti-patterns

- `use-all-label-releases.ts` — kebab-case
- `useallLabelReleases.ts` — lower-flat
- `fetch_with_anon_gate.ts` — snake_case
- `features/feature-flags/` — kebab-case folder
- `features/FeatureFlags/` — PascalCase folder

Correct:

- `useAllLabelReleases.ts`
- `fetchWithAnonGate.ts`
- `features/featureFlags/`

## Migration

Don't sweep. Existing files keep their current name until the next time you touch them; rename when you're already editing or moving the file. New files follow the rule from day one.
