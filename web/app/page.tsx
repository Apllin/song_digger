"use client";

import { useCallback, useEffect, useRef, Suspense } from "react";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { SearchBar } from "@/components/SearchBar";
import { FilterPanel, DEFAULT_FILTERS } from "@/components/FilterPanel";
import { TrackCard } from "@/components/TrackCard";
import { usePlayer, type PlayerTrack } from "@/lib/atoms/player";
import { searchAtom } from "@/lib/atoms/search";
import { favoritesAtom } from "@/lib/atoms/favorites";

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 90_000;

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const player = usePlayer();
  const [search, setSearch] = useAtom(searchAtom);
  const [fav, setFav] = useAtom(favoritesAtom);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const currentSearchIdRef = useRef<string>("");
  const appendModeRef = useRef<boolean>(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollSearch = useCallback(
    (searchId: string) => {
      currentSearchIdRef.current = searchId;
      pollStartRef.current = Date.now();

      pollRef.current = setInterval(async () => {
        if (currentSearchIdRef.current !== searchId) return;

        if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
          stopPolling();
          setSearch((prev) => ({
            ...prev,
            status: "error",
            errorMsg: "Search timed out. Please try again.",
          }));
          return;
        }

        try {
          const res = await fetch(`/api/search/${searchId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          if (currentSearchIdRef.current !== searchId) return;

          setSearch((prev) => {
            let nextTracks = prev.tracks;
            if (data.tracks?.length) {
              if (appendModeRef.current) {
                const seen = new Set(prev.tracks.map((t) => t.sourceUrl));
                const fresh = data.tracks.filter((t: { sourceUrl: string }) => !seen.has(t.sourceUrl));
                nextTracks = [...prev.tracks, ...fresh];
              } else {
                nextTracks = data.tracks;
              }
            }
            return {
              ...prev,
              tracks: nextTracks,
              ...(data.status === "done" || data.status === "error"
                ? {
                    status: data.status === "done" ? "done" : "error",
                    errorMsg: data.status === "error" ? "Search failed. Please try again." : prev.errorMsg,
                  }
                : {}),
            };
          });

          if (data.status === "done" || data.status === "error") {
            stopPolling();
          }
        } catch (err) {
          console.error("[poll] error:", err);
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, setSearch]
  );

  const startSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || search.status === "running") return;

      stopPolling();
      appendModeRef.current = false;
      currentSearchIdRef.current = "";
      setSearch((prev) => ({
        ...prev,
        tracks: [],
        errorMsg: "",
        status: "running",
        displayCount: 20,
      }));

      const payload: Record<string, unknown> = { input: q.trim() };
      const f = search.filters;
      const activeFilters: Record<string, unknown> = {};
      if (f.genre) activeFilters.genre = f.genre;
      if (Object.keys(activeFilters).length) payload.filters = activeFilters;

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        pollSearch(data.id);
      } catch (err) {
        console.error("[search] error:", err);
        setSearch((prev) => ({
          ...prev,
          status: "error",
          errorMsg: "Failed to start search. Is the server running?",
        }));
      }
    },
    [search.status, search.filters, stopPolling, setSearch, pollSearch]
  );

  const handleSearch = useCallback(
    () => startSearch(search.query),
    [search.query, startSearch]
  );

  const loadMoreTracks = useCallback(async () => {
    const q = search.query.trim();
    if (!q || search.status === "running") return;

    stopPolling();
    appendModeRef.current = true;
    currentSearchIdRef.current = "";
    setSearch((prev) => ({ ...prev, status: "running", errorMsg: "" }));

    const payload: Record<string, unknown> = { input: q };
    const f = search.filters;
    const activeFilters: Record<string, unknown> = {};
    if (f.genre) activeFilters.genre = f.genre;
    if (Object.keys(activeFilters).length) payload.filters = activeFilters;

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      pollSearch(data.id);
    } catch (err) {
      console.error("[loadMore] error:", err);
      appendModeRef.current = false;
      setSearch((prev) => ({
        ...prev,
        status: "error",
        errorMsg: "Failed to load more tracks.",
      }));
    }
  }, [search.query, search.filters, search.status, stopPolling, setSearch, pollSearch]);

  // Auto-search when opened via "Find similar" link (?q=...)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setSearch((prev) => ({ ...prev, query: q }));
      startSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRandom = useCallback(async () => {
    try {
      const res = await fetch("/api/random");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const track = await res.json();
      const q = `${track.artist} - ${track.title}`;
      setSearch((prev) => ({ ...prev, query: q }));
      startSearch(q);
    } catch {
      setSearch((prev) => ({
        ...prev,
        status: "error",
        errorMsg: "Could not fetch a random track.",
      }));
    }
  }, [startSearch, setSearch]);

  const toggleFavorite = useCallback(
    async (trackId: string) => {
      const isFav = fav.ids.has(trackId);
      setFav((prev) => {
        const next = new Set(prev.ids);
        isFav ? next.delete(trackId) : next.add(trackId);
        return { ...prev, ids: next };
      });

      try {
        if (isFav) {
          await fetch(`/api/favorites?trackId=${trackId}`, { method: "DELETE" });
        } else {
          await fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId }),
          });
        }
      } catch (err) {
        console.error("[favorites] error:", err);
        setFav((prev) => {
          const next = new Set(prev.ids);
          isFav ? next.add(trackId) : next.delete(trackId);
          return { ...prev, ids: next };
        });
      }
    },
    [fav.ids, setFav]
  );

  // Load favorites + dislikes on mount
  useEffect(() => {
    fetch("/api/favorites")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string }[]>) : null))
      .then((data) => {
        if (!data) return;
        setFav((prev) => ({ ...prev, ids: new Set(data.map((t) => t.id)) }));
      })
      .catch(console.error);

    fetch("/api/dislikes")
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : null))
      .then((urls) => {
        if (!urls) return;
        setFav((prev) => ({ ...prev, dislikedUrls: new Set(urls) }));
      })
      .catch(console.error);
  }, [setFav]);

  const handleDislike = useCallback(
    async (track: { sourceUrl: string; title: string; artist: string }) => {
      setFav((prev) => ({
        ...prev,
        dislikedUrls: new Set([...prev.dislikedUrls, track.sourceUrl]),
      }));
      if (player.track?.sourceUrl === track.sourceUrl) {
        player.close();
      }
      try {
        await fetch("/api/dislikes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: track.sourceUrl,
            title: track.title,
            artist: track.artist,
          }),
        });
      } catch {
        setFav((prev) => {
          const next = new Set(prev.dislikedUrls);
          next.delete(track.sourceUrl);
          return { ...prev, dislikedUrls: next };
        });
      }
    },
    [player, setFav]
  );

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const { query, filters, tracks, status, errorMsg, displayCount } = search;
  const isLoading = status === "running";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-10 pb-28 flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Song Digger</h1>
          <p className="text-sm text-zinc-500">
            Find similar techno tracks across YouTube Music, Bandcamp, and Cosine.club
          </p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col gap-4">
          <SearchBar
            value={query}
            onChange={(v) => setSearch((prev) => ({ ...prev, query: v }))}
            onSubmit={handleSearch}
            onRandom={handleRandom}
            loading={isLoading}
          />

          <FilterPanel
            filters={filters}
            onChange={(f) => setSearch((prev) => ({ ...prev, filters: f }))}
            onReset={() => setSearch((prev) => ({ ...prev, filters: DEFAULT_FILTERS }))}
          />
        </div>

        {/* States */}
        {isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-zinc-500">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm">Searching across sources…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {status === "done" && tracks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-zinc-600">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
            </svg>
            <p className="text-sm">No tracks found. Try a different query or adjust filters.</p>
          </div>
        )}

        {/* Results */}
        {tracks.length > 0 && (() => {
          const visibleTracks = tracks.filter(
            (t) => !fav.dislikedUrls.has(t.sourceUrl) && !fav.ids.has(t.id)
          );
          const shown = visibleTracks.slice(0, displayCount);

          const playlist: PlayerTrack[] = shown
            .filter((t) => !!t.embedUrl)
            .map((t) => ({
              id: t.id,
              title: t.title,
              artist: t.artist,
              source: t.source,
              sourceUrl: t.sourceUrl,
              coverUrl: t.coverUrl,
              embedUrl: t.embedUrl,
            }));

          return (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  {Math.min(displayCount, visibleTracks.length)} / {visibleTracks.length} track{visibleTracks.length !== 1 ? "s" : ""}
                  {isLoading && " · searching…"}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {shown.map((track) => {
                  const playlistIndex = playlist.findIndex((p) => p.sourceUrl === track.sourceUrl);
                  return (
                    <TrackCard
                      key={track.id ?? track.sourceUrl}
                      track={track}
                      playlist={playlist}
                      trackIndex={playlistIndex}
                      isFavorite={fav.ids.has(track.id)}
                      onFavoriteToggle={toggleFavorite}
                      onDislike={() => handleDislike(track)}
                    />
                  );
                })}
              </div>

              <div className="flex justify-center gap-3 pt-2 flex-wrap">
                {displayCount < visibleTracks.length && (
                  <button
                    onClick={() => setSearch((prev) => ({ ...prev, displayCount: prev.displayCount + 20 }))}
                    className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-sm rounded-xl transition-colors"
                  >
                    Show 20 more ({visibleTracks.length - displayCount} remaining)
                  </button>
                )}
                {status === "done" && (
                  <button
                    onClick={loadMoreTracks}
                    className="px-6 py-2.5 bg-indigo-900/60 hover:bg-indigo-800/70 text-indigo-300 hover:text-indigo-100 text-sm rounded-xl transition-colors"
                  >
                    Find more similar
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
