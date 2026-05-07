"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { getSession } from "next-auth/react";
import { SearchBar } from "@/components/SearchBar";
import { TrackCard } from "@/components/TrackCard";
import { usePlayer, type PlayerTrack } from "@/lib/atoms/player";
import { searchAtom } from "@/lib/atoms/search";
import { favoritesAtom } from "@/lib/atoms/favorites";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

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
  const setShowRegisterPrompt = useSetAtom(showRegisterPromptAtom);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const currentSearchIdRef = useRef<string>("");
  const appendModeRef = useRef<boolean>(false);

  // One-shot fetch of session state — gates favorite/dislike controls.
  // SessionProvider isn't wired site-wide; getSession does its own /api
  // call which is fine for a single read.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        if (!cancelled) setIsAuthenticated(!!s?.user);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

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

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: q.trim() }),
        });
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          if (body?.error === "ANONYMOUS_LIMIT_REACHED") {
            setShowRegisterPrompt(true);
            setSearch((prev) => ({ ...prev, status: "idle", errorMsg: "" }));
            return;
          }
        }
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
    [search.status, stopPolling, setSearch, setShowRegisterPrompt, pollSearch]
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

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "ANONYMOUS_LIMIT_REACHED") {
          setShowRegisterPrompt(true);
          appendModeRef.current = false;
          setSearch((prev) => ({ ...prev, status: "done", errorMsg: "" }));
          return;
        }
      }
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
  }, [search.query, search.status, stopPolling, setSearch, setShowRegisterPrompt, pollSearch]);

  // Auto-search when opened via "Find similar" link (?q=...)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setSearch((prev) => ({ ...prev, query: q }));
      startSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      .then((r) =>
        r.ok ? (r.json() as Promise<{ artistKey: string; titleKey: string }[]>) : null,
      )
      .then((rows) => {
        if (!rows) return;
        setFav((prev) => ({
          ...prev,
          dislikedKeys: new Set(rows.map((d) => `${d.artistKey}|${d.titleKey}`)),
        }));
      })
      .catch(console.error);
  }, [setFav]);

  const handleDislike = useCallback(
    async (track: { id: string; sourceUrl: string; title: string; artist: string }) => {
      const composite = `${normalizeArtist(track.artist)}|${normalizeTitle(track.title)}`;
      setFav((prev) => ({
        ...prev,
        dislikedKeys: new Set([...prev.dislikedKeys, composite]),
      }));
      // Compare by id — sourceUrl may have been swapped to a resolved
      // YTM/Bandcamp URL by BottomPlayer for non-YTM/non-bandcamp originals.
      if (player.track?.id === track.id) {
        player.close();
      }
      try {
        await fetch("/api/dislikes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artist: track.artist,
            title: track.title,
          }),
        });
      } catch {
        setFav((prev) => {
          const next = new Set(prev.dislikedKeys);
          next.delete(composite);
          return { ...prev, dislikedKeys: next };
        });
      }
    },
    [player, setFav]
  );

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const { query, tracks, status, errorMsg, displayCount } = search;
  const isLoading = status === "running";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-10 pb-28 flex flex-col gap-8">
        {/* Header */}
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50">
          Find your next favourite track
        </h2>

        {/* Search */}
        <SearchBar
          value={query}
          onChange={(v) => setSearch((prev) => ({ ...prev, query: v }))}
          onSubmit={handleSearch}
          loading={isLoading}
        />

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
            (t) =>
              !fav.dislikedKeys.has(`${normalizeArtist(t.artist)}|${normalizeTitle(t.title)}`) &&
              !fav.ids.has(t.id)
          );
          const shown = visibleTracks.slice(0, displayCount);

          // Every visible track goes into the playlist — non-YTM/non-bandcamp
          // entries are resolved on demand by BottomPlayer via /api/embed.
          const playlist: PlayerTrack[] = shown.map((t) => ({
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
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-7">
                {shown.map((track, idx) => {
                  return (
                    <TrackCard
                      key={track.id ?? track.sourceUrl}
                      track={track}
                      playlist={playlist}
                      trackIndex={idx}
                      isFavorite={fav.ids.has(track.id)}
                      onFavoriteToggle={
                        isAuthenticated ? toggleFavorite : undefined
                      }
                      onDislike={
                        isAuthenticated
                          ? () => handleDislike(track)
                          : undefined
                      }
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
