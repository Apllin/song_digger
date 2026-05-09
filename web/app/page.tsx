"use client";

import { parseResponse } from "hono/client";
import { useAtom, useSetAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { getSession } from "next-auth/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { SearchBar } from "@/components/SearchBar";
import { TrackCard } from "@/components/TrackCard";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { favoritesAtom } from "@/lib/atoms/favorites";
import { type PlayerTrack, usePlayer } from "@/lib/atoms/player";
import { searchAtom } from "@/lib/atoms/search";
import { api } from "@/lib/hono/client";
import { withAnonGate } from "@/lib/with-anon-gate";

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
          const data = await parseResponse(api.search[":id"].$get({ param: { id: searchId } }));

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
    [stopPolling, setSearch],
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
        displayCount: 18,
      }));

      try {
        const data = await withAnonGate(parseResponse(api.search.$post({ json: { input: q.trim() } })), () => {
          setShowRegisterPrompt(true);
          setSearch((prev) => ({ ...prev, status: "idle", errorMsg: "" }));
        });
        if (!data) return;
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
    [search.status, stopPolling, setSearch, setShowRegisterPrompt, pollSearch],
  );

  const handleSearch = useCallback(() => startSearch(search.query), [search.query, startSearch]);

  const loadMoreTracks = useCallback(async () => {
    const q = search.query.trim();
    if (!q || search.status === "running") return;

    stopPolling();
    appendModeRef.current = true;
    currentSearchIdRef.current = "";
    setSearch((prev) => ({ ...prev, status: "running", errorMsg: "" }));

    try {
      const data = await withAnonGate(parseResponse(api.search.$post({ json: { input: q } })), () => {
        setShowRegisterPrompt(true);
        appendModeRef.current = false;
        setSearch((prev) => ({ ...prev, status: "done", errorMsg: "" }));
      });
      if (!data) return;
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
        if (isFav) next.delete(trackId);
        else next.add(trackId);
        return { ...prev, ids: next };
      });

      try {
        if (isFav) {
          await parseResponse(api.favorites.$delete({ query: { trackId } }));
        } else {
          await parseResponse(api.favorites.$post({ json: { trackId } }));
        }
      } catch (err) {
        console.error("[favorites] error:", err);
        setFav((prev) => {
          const next = new Set(prev.ids);
          if (isFav) next.add(trackId);
          else next.delete(trackId);
          return { ...prev, ids: next };
        });
      }
    },
    [fav.ids, setFav],
  );

  // Load favorites + dislikes on mount
  useEffect(() => {
    parseResponse(api.favorites.$get())
      .then((data) => {
        setFav((prev) => ({ ...prev, ids: new Set(data.map((t) => t.id)) }));
      })
      .catch(console.error);

    parseResponse(api.dislikes.$get())
      .then((rows) => {
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
        await parseResponse(api.dislikes.$post({ json: { artist: track.artist, title: track.title } }));
      } catch {
        setFav((prev) => {
          const next = new Set(prev.dislikedKeys);
          next.delete(composite);
          return { ...prev, dislikedKeys: next };
        });
      }
    },
    [player, setFav],
  );

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const { query, tracks, status, errorMsg, displayCount } = search;
  const isLoading = status === "running";

  const visibleTracks = tracks.filter(
    (t) => !fav.dislikedKeys.has(`${normalizeArtist(t.artist)}|${normalizeTitle(t.title)}`) && !fav.ids.has(t.id),
  );

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        {/* Hero: display headline — two-line, Handshake-style impact.
            Tight leading + negative tracking give the SansPlomb-feel
            while we render in the project's display family. */}
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(40px, 8.5vw, 108px)",
              lineHeight: 0.85,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            <span className="block">Find your next</span>
            <span className="block">favourite track</span>
          </h1>
        </div>

        {/* Search */}
        <SearchBar
          value={query}
          onChange={(v) => setSearch((prev) => ({ ...prev, query: v }))}
          onSubmit={handleSearch}
          loading={isLoading}
        />

        {/* States */}
        {isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-td-fg-d">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm">Searching across sources…</p>
          </div>
        )}

        {status === "error" && (
          <div
            className="rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(220,90,90,0.45)",
              background: "rgba(120,30,30,0.18)",
              color: "#f3b8b8",
            }}
          >
            {errorMsg}
          </div>
        )}

        {status === "done" && tracks.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-td-fg-m">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
              />
            </svg>
            <p className="text-sm">No tracks found. Try a different query or adjust filters.</p>
          </div>
        )}

        {/* Results */}
        {tracks.length > 0 &&
          (() => {
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
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-fg">
                  <span style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}>
                    {Math.min(displayCount, visibleTracks.length)} of {visibleTracks.length} · sorted by relevance
                  </span>
                  {isLoading && <span className="text-td-accent">searching…</span>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-6">
                  {shown.map((track, idx) => {
                    return (
                      <TrackCard
                        key={track.id ?? track.sourceUrl}
                        track={track}
                        playlist={playlist}
                        trackIndex={idx}
                        isFavorite={fav.ids.has(track.id)}
                        onFavoriteToggle={isAuthenticated ? toggleFavorite : undefined}
                        onDislike={isAuthenticated ? () => handleDislike(track) : undefined}
                      />
                    );
                  })}
                </div>

                {(() => {
                  const allShown = displayCount >= visibleTracks.length;
                  const findMoreActive = allShown && !isLoading;
                  return (
                    <div className="flex justify-center gap-3 pt-2 flex-wrap">
                      <button
                        onClick={() =>
                          setSearch((prev) => ({
                            ...prev,
                            displayCount: prev.displayCount + 18,
                          }))
                        }
                        disabled={allShown}
                        className="px-6 py-2.5 text-sm font-medium rounded-full border transition-transform duration-150 ease-out hover:scale-[1.04] disabled:hover:scale-100 disabled:cursor-not-allowed"
                        style={{
                          borderColor: "rgba(255, 255, 255, 0.30)",
                          background: "rgba(255,255,255,0.12)",
                          color: "var(--td-fg)",
                          backdropFilter: "blur(16px) saturate(140%)",
                          WebkitBackdropFilter: "blur(16px) saturate(140%)",
                          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
                          opacity: allShown ? 0.45 : 1,
                        }}
                      >
                        {allShown
                          ? `All ${visibleTracks.length} shown — list exhausted`
                          : `Show 18 more (${visibleTracks.length - displayCount} remaining)`}
                      </button>
                      <button
                        onClick={loadMoreTracks}
                        disabled={!findMoreActive}
                        className="px-6 py-2.5 text-sm font-semibold rounded-full transition-transform duration-150 ease-out hover:scale-[1.04] disabled:hover:scale-100 disabled:cursor-not-allowed"
                        style={{
                          background: "var(--td-fg)",
                          color: "var(--td-bg)",
                          boxShadow: findMoreActive ? "0 0 24px rgba(255, 255, 255, 0.20)" : "none",
                          opacity: findMoreActive ? 1 : 0.45,
                        }}
                      >
                        {isLoading ? "Searching…" : "Find more similar"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
      </div>
    </div>
  );
}
