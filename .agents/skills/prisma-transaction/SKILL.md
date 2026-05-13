---
name: prisma-transaction
description: Use this skill when working with Prisma transactions in the web service — `prisma.$transaction(...)` calls, batch upserts of Track/SearchResult rows, or any database operation that wraps multiple writes. Includes timeout handling, batch sizing, and the gotchas this project has hit. Encodes the lesson that the default 5-second transaction timeout is insufficient when track count grows past ~50, and that batch transactions must be sized intentionally for the hot path through `aggregateTracks` → `saveTracks`.
---

# Prisma transactions

Prisma transactions in this project are concentrated in `web/app/api/search/route.ts` (`saveTracks`) and a few smaller spots. They've already caused one production-breaking bug — the default 5-second transaction timeout was insufficient when 4 source adapters returned ~100 tracks total. This skill captures the patterns to use and avoid.

## When to use this skill

- Adding or modifying any `prisma.$transaction(...)` call
- Changing batch sizes (`DB_CHUNK_SIZE` and similar constants)
- Adding upserts that run in parallel (`Promise.all` over chunks)
- Investigating "Transaction API error: A rollback cannot be executed on an expired transaction" or P2028 errors
- Adding a new model that gets bulk-written during a search

## When NOT to use this skill

- Single-row `prisma.<model>.upsert(...)` calls outside a transaction
- Schema changes (`prisma migrate`)
- Read-only queries

## The transaction timeout rule

`prisma.$transaction(operations, options?)` accepts a second argument with options. The default `timeout` is **5000 ms (5 seconds)**. This is too tight for any batch operation that grows linearly with search size.

```typescript
// WRONG — relies on default 5s timeout, breaks at scale
await prisma.$transaction(
  chunk.map((t) => prisma.track.upsert({ where: ..., create: ..., update: ... }))
);

// RIGHT — explicit timeout
await prisma.$transaction(
  chunk.map((t) => prisma.track.upsert({ where: ..., create: ..., update: ... })),
  { timeout: 30_000 }   // 30 seconds
);
```

For `saveTracks` and similar batch upserts, **30 seconds is the project's standard**. It's overkill in the happy path (typical batch completes in 1-3s) but tolerates Postgres slow-starts, lock contention, and adapter-driven track-count spikes.

Don't use timeouts shorter than 10 seconds for any transaction containing more than 1 write operation. Don't use longer than 60 seconds without a specific reason — at that point you're masking a real problem (a query that should be split, a missing index, etc.).

## Batch sizing

The pattern in `saveTracks` is:

1. Chunk tracks into groups of `DB_CHUNK_SIZE`
2. Run all chunks in `Promise.all` — chunks parallel, items within a chunk transactional

```typescript
const DB_CHUNK_SIZE = 50;  // current value

async function saveTracks(searchId: string, tracks: TrackMeta[]): Promise<void> {
  if (!tracks.length) return;
  const trackChunks = chunk(tracks, DB_CHUNK_SIZE);
  const chunkResults = await Promise.all(
    trackChunks.map((ch) =>
      prisma.$transaction(
        ch.map((t) => prisma.track.upsert({ ... })),
        { timeout: 30_000 }
      )
    )
  );
  // ...
}
```

Tradeoff:
- **Larger chunk size** → fewer transactions, more work per transaction, higher transaction-timeout risk
- **Smaller chunk size** → more parallel transactions, more connection pool pressure, lower per-transaction risk

Current `DB_CHUNK_SIZE = 50` is calibrated for ~100 tracks (Cosine 40 + YTM 30 + Bandcamp 7 + Yandex 20 ≈ 100, after dedup ≈ 80 unique). Two chunks of ~40 each, both finish well within 30s.

Don't change `DB_CHUNK_SIZE` unless you have a measurable reason. The eval harness should be re-run if you do (transaction timing affects search latency, which can affect Last.fm timeout windows, etc. — it's a system-level change).

## When upsert update clauses skip `null`

The project's convention for `update`:

```typescript
update: {
  // Use ?? undefined to skip null values — only update fields the
  // current fetch had real data for. Never overwrite with null.
  bpm: t.bpm ?? undefined,
  key: t.key ?? undefined,
  energy: t.energy ?? undefined,
  // ... etc
}
```

Rationale: a track might already be in the DB with BPM=128. The current fetch may not have BPM (e.g., YTM Radio doesn't return it). Setting BPM to null in the update would clobber good data.

`?? undefined` tells Prisma: "skip this field". Setting to `null` tells Prisma: "set this field to null in the DB".

In `create`, use the value directly (it might be null on a brand-new row, that's fine):

```typescript
create: {
  title: t.title,
  bpm: t.bpm,           // may be null on new row, OK
  key: t.key,
  // ...
}
```

This pattern is the source of subtle bugs if violated. Before changing anything in the upsert clauses, re-read this convention.

## Common pitfalls in this project

- **Forgetting `{ timeout: 30_000 }` on new `$transaction` calls.** This is the #1 source of Prisma errors here. Default 5s breaks at scale.
- **Conflating "batch transaction" with "batched executeRaw".** They're different APIs with different cost models. This project uses interactive transactions (`$transaction([prisma.x.upsert(...), ...])`) — the array form, not callback form.
- **Putting too much in one transaction.** A transaction holding 200+ writes will time out even at 30s. Split via `chunk()`. Current threshold per transaction: ~50 operations max.
- **Sequential awaits inside `Promise.all`.** Defeats the parallelism. If you write `await Promise.all(chunks.map(async (ch) => { await x; await y; }))`, the inner awaits serialize within each chunk. For independent operations, return all promises at once.
- **Calling `prisma.$transaction([])` with empty array.** Doesn't error, but wastes a round-trip. Always check `if (!arr.length) return;` first.

## Connection pool considerations

Default Prisma pool is small (~10 connections in dev). With `Promise.all` over many chunks, you can saturate it.

If `saveTracks` hits ~100 tracks → 2 chunks → 2 transactions in parallel → each transaction holds 1 connection while running 50 upserts. Comfortable.

If you increased to ~300 tracks → 6 chunks → 6 transactions → close to pool limit, especially if other API requests are concurrent (a real user searching while eval runs in another terminal).

For the immediate future this is not a problem. If you ever scale to many concurrent users, revisit the pool size in `DATABASE_URL` (`?connection_limit=20`).

## Debugging P2028

Symptoms:
```
Transaction API error: A rollback cannot be executed on an expired transaction.
The timeout for this transaction was 5000 ms, however N ms passed.
P2028
```

Causes (in order of likelihood):

1. **Default timeout, batch too large.** Fix: add `{ timeout: 30_000 }` to the `$transaction` call.
2. **Postgres connection acquisition slow.** Fix: check Postgres is healthy and not under load. Sometimes manifests after dev DB has been idle for hours.
3. **A query inside the transaction is slow** (missing index, accidental table scan). Fix: investigate which `upsert.where` clause is unindexed. In this project, `where: { sourceUrl: t.sourceUrl }` works because `Track.sourceUrl` is unique-indexed by Prisma. Don't change `where` clauses without checking the schema.
4. **Lock contention with another concurrent transaction.** Rare in dev. Fix: serialize the calls or use a smaller batch size.

## Migration touch-ups

If you add a model that gets bulk-written during a search, check:

- Is the model's primary lookup column unique-indexed? (Required for fast upsert.)
- Do you need to add the upsert to `saveTracks` or create a parallel function?
- Does the new transaction need `{ timeout: 30_000 }`?

Don't ship a new bulk-write path without re-running eval — slow database operations can push the whole search past the polling timeout in the eval runner (currently 120s).
