# 0002 — Source artist filter on by default

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
When a user searches "Oscar Mulero - Grid", do they want more Mulero tracks
in results, or do they want different artists in similar style? Both
interpretations are valid. Different sources behave differently:

- Cosine.club returns Mulero tracks alongside Reeko, Exium, etc — matches
  by audio embedding regardless of artist
- YouTube Music radio (RDAMVM playlist) heavily includes the same artist
- Bandcamp recommendations are mixed

Without filtering, results lean heavily toward the seed artist's own
discography, which is not what most users mean by "similar to this".

**Decision:**
Filter the seed artist's tracks from the result list by default. Use the
existing `_same_artist` token-based comparison.

**Consequences:**
- Positive: results focus on stylistic neighbours, the user's likely intent
- Positive: matches the implicit assumption in Spotify/Pandora-style
  similar-track features
- Negative: users wanting "more by this artist" need a different UI path
  (e.g. a separate "more from <artist>" button)
- Negative: false positives in token matching can drop legitimate
  similar-but-different artists with shared name tokens

**Alternatives considered:**
- No filter — rejected, dominates results with seed artist's own tracks
- Optional toggle in UI — accepted as future enhancement; default behaviour
  stays as-is
- Demote (penalty score) instead of filter — rejected because demotion still
  surfaces 5-7 same-artist tracks in top 20

**Revisit when:**
- User feedback indicates frequent confusion about why their searched artist
  is missing from results
- The "discography" page (which exists separately) becomes feature-complete
  enough that users have a clear alternative
