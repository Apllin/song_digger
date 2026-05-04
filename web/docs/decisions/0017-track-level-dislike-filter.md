# 0017 — Track-level dislike filter via identity match

**Date:** 2026-05-04
**Status:** Accepted

**Context:**
The existing dislike implementation had two problems. First, the
post-RRF artist-level penalty in `web/lib/aggregator.ts`
(`DISLIKED_ARTIST_PENALTY = 0.012`) was effectively dead code: the UI
never sent the `feedback` field in the `/api/search` payload, and the
server never read it from `DislikedTrack` to inject. Disliking a track
demoted nothing in subsequent searches.

Second, the user's mental model is "this specific track, never again,"
not "this artist's whole catalog." The artist-level penalty conflicted
with that. A user could like Mulero's "Spirits" but reject "Horses" —
under artist-level dislike, the rejection would also drag "Spirits"
down the rankings.

The schema also keyed dislikes by `sourceUrl`, which is a per-source
identifier. The same recording from YTM, Bandcamp, and Cosine would
need three separate dislike rows to be filtered everywhere, and one
rejection from one source wouldn't block the same recording surfacing
from another source's pool.

**Decision:**
Drop the existing `DislikedTrack` table and recreate it keyed on
normalized `(artistKey, titleKey)` identity. Apply the dislike filter
server-side in `/api/search` before RRF fusion runs, against
`pythonResult.source_lists` flatly: a disliked identity is removed
from every source's contribution to the candidate pool.

Specifically:

- `DislikedTrack` schema replaced. `sourceUrl` column dropped; new
  unique constraint on `(artistKey, titleKey)`. Migration
  `20260504133832_redesign_disliked_track` is a DROP+CREATE — the
  user explicitly accepted the loss of all 202 historical rows
  (re-disliking is a few days of normal usage).
- `/api/dislikes` POST/DELETE accept `(artist, title)` instead of
  `sourceUrl`; the route normalizes via the aggregator's
  `normalizeArtist` / `normalizeTitle` helpers and stores both the
  normalized keys and the human-readable display fields. GET returns
  rows shaped `{ artistKey, titleKey, artist, title }`.
- `/api/search` `runSearch` loads `DislikedTrack` once per request,
  builds a `Set<"artistKey|titleKey">`, and filters each
  `pythonResult.source_lists[i].tracks` array before passing into
  `aggregateTracks`. The filter runs before hydration so cache lookups
  don't waste round-trips on tracks that are about to be dropped.
- `aggregateTracks` no longer takes a `feedback` parameter. The
  `TrackFeedback` interface and `DISLIKED_ARTIST_PENALTY` constant
  are deleted from `web/lib/aggregator.ts`. The post-RRF nudge
  block now only contains the `EMBED_BONUS` tiebreaker.
- The `/api/search` Zod request schema drops the `feedback` field.
- Jotai `favoritesAtom` replaces `dislikedUrls: Set<string>` with
  `dislikedKeys: Set<string>` (composite `"artistKey|titleKey"`).
  `web/app/page.tsx` mounts dislikes from `/api/dislikes` GET into
  this set; `handleDislike` sends `(artist, title)` and optimistically
  inserts the composite key into the local set so the UI hides the
  track immediately. The post-filter on rendered results also matches
  on the composite key.
- `aggregator.test.ts` loses the three `feedback`-related tests; the
  other tests (RRF, embed bonus, artist diversification, BPM filter
  removal) keep their coverage.

**Consequences:**
- Positive: dislike now actually does something. The next search after
  a dislike no longer surfaces the rejected track from any source.
- Positive: track-level granularity preserves the rest of an artist's
  catalog. "Horses" can be hidden without burying "Spirits."
- Positive: identity-keyed schema means a dislike applied to one
  source filters the same recording from every other source that
  reports it under the same normalized identity. No per-source dupe
  rows.
- Positive: `aggregator.ts` shrinks. The dead-code post-RRF nudge
  branch goes away; the RRF score is now only nudged by `EMBED_BONUS`,
  which is a real tie-breaker for inline-playable tracks.
- Negative: 202 historical dislike rows lost. User accepted this — the
  rows were keyed by `sourceUrl`, which doesn't translate cleanly to
  the new identity schema without per-row artist/title fetches.
- Negative: the dislike filter now adds one Postgres round-trip per
  `/api/search` call. Mitigated by the dislike table being small
  (~hundreds of rows expected long-term) and the lookup being
  index-backed on `(artistKey, titleKey)`.

**Alternatives considered:**
- Keep the `sourceUrl` schema and write the filter against URLs.
  Rejected — same recording from different sources stays unfiltered
  on every other source. The user would need to dislike the same
  track up to six times.
- Keep the artist-level penalty and just wire the UI to send
  `feedback` properly. Rejected — wrong mental model. The user's ask
  is "never show this track again," not "lower this artist's score."
- Schema-preserving migration via per-source URL expansion at write
  time (resolve each `sourceUrl` to `(artist, title)`, normalize,
  upsert into the new schema). Rejected — substantially more work
  with no upside given that the user accepted the data loss. The
  202 historical rows were a small fraction of project lifetime
  usage; they get rebuilt within days.
- Server-side RRF-time penalty (subtract from rrfScore on identity
  match) instead of pre-fusion filter. Rejected — disliked tracks
  would still occupy candidate slots and still show in the
  diversification window. A hard filter is cleaner; the score nudge
  was the original mistake and we're not repeating it for tracks.
