# Server-side pagination pattern

This document describes the pattern used for paginated, filtered, and sorted lists that require fetching from the Python service and caching in Postgres. Artist releases (`/api/discography/releases`) is the canonical example.

## Pattern overview

1. **TTL check** — look up a metadata row (`ArtistReleasesMeta`) that tracks when the full list was last fetched.
2. **Fetch and store** — on cache miss (or stale), call the Python service, delete the old rows, and insert new rows in a single `$transaction`. Update the metadata row via `upsert`.
3. **Query** — run `count` + `findMany` against the stored rows with Prisma's native `where`, `orderBy { nulls: "last" }`, `skip`, and `take`.
4. **Return** — send a typed `{ releases, pagination }` payload back to the client.

## Database tables

### `ArtistReleasesMeta`

One row per artist. Tracks only fetch timing — no release data. Using a separate table means fetch metadata can grow (fetch duration, page count, etc.) without touching the release rows.

```prisma
model ArtistReleasesMeta {
  artistId  String   @id
  fetchedAt DateTime @default(now()) @updatedAt
}
```

`@updatedAt` resets automatically when the row is touched; `update: {}` inside the transaction is sufficient to reset the TTL clock.

### `ArtistRelease`

One row per Discogs release per artist. All filter and sort fields are stored as first-class columns so Prisma can use them directly — no JSON parsing on the read path.

```prisma
model ArtistRelease {
  id          String  @id @default(cuid())
  artistId    String
  releaseId   String  // original Discogs int ID stored as string
  title       String
  year        Int?
  type        String?
  role        String?
  ...
  @@unique([artistId, releaseId])
  @@index([artistId, role, year(sort: Desc)])
}
```

## Shared schema

`web/features/discography/schemas.ts` is plain TypeScript (no `"use client"` / `"use server"`) and exports the Zod schema and its inferred type. Both the Hono route (`zValidator`) and the client hook import from here — one definition, no drift.

```typescript
export const releasesQuerySchema = z.object({
  artistId: z.string(),
  role: z.enum(["Main", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  sort: z.enum(["year_desc", "year_asc"]).default("year_desc"),
});
export type ReleasesQuery = z.infer<typeof releasesQuerySchema>;
```

The hook uses `Omit<ReleasesQuery, "artistId"> & { artistId: number | undefined }` because the component receives the Discogs numeric ID, which gets passed as `String(artistId)` at the call site.

## Hono handler (`artistReleases.ts`)

```typescript
// 1. TTL check
const meta = await prisma.artistReleasesMeta.findUnique({ where: { artistId } });
if (!meta || Date.now() - meta.fetchedAt.getTime() >= TTL_30D_MS) {
  const { releases } = await getArtistReleases(Number(artistId), {}, { baseURL: ... });
  await prisma.$transaction([
    prisma.artistRelease.deleteMany({ where: { artistId } }),
    prisma.artistRelease.createMany({ data: releases.map((r) => ({ ... })) }),
    prisma.artistReleasesMeta.upsert({ where: { artistId }, create: { artistId }, update: {} }),
  ]);
}

// 2. Paginate
const where = { artistId, ...(role === "all" ? {} : { role }) };
const orderBy = { year: { sort: "desc", nulls: "last" as const } };
const [total, rows] = await Promise.all([
  prisma.artistRelease.count({ where }),
  prisma.artistRelease.findMany({ where, orderBy, skip: (page - 1) * perPage, take: perPage }),
]);
```

The `$transaction` array form (not interactive callback) is used because all three operations are independent writes — no read-then-write within the transaction.

## Applying this pattern to a new entity

1. Add a `<Entity>Meta` table with `@id` and `@updatedAt fetchedAt`, and an `<Entity>` table with columns matching the filter/sort fields.
2. Create `features/<entity>/schemas.ts` with a Zod schema covering pagination params.
3. Write a Hono handler that follows the TTL-check → fetch → `$transaction` → `count + findMany` flow above.
4. Export a shared `<Entity>` interface (e.g., `DiscographyRelease`) for component props — don't leak Prisma's generated type to the UI layer, since its shape (e.g., `id` as `number` vs `string`) may differ.
