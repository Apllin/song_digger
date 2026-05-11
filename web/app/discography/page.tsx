"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import { NavigableInput } from "@/features/discography/components/NavigableInput";
import { NavigableList } from "@/features/discography/components/NavigableList";
import { ReleaseTagLegend } from "@/features/discography/components/ReleaseTagLegend";
import { useAllArtistReleases } from "@/features/discography/hooks/useAllArtistReleases";
import { useInputList } from "@/features/discography/hooks/useInputList";
import { discographyAtom } from "@/lib/atoms/discography";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";
import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";

export default function DiscographyPage() {
  return (
    <Suspense>
      <DiscographyLoader />
    </Suspense>
  );
}

function DiscographyLoader() {
  const defaultArtist = useSearchParams().get("artist") ?? undefined;
  return <DiscographyContent defaultArtist={defaultArtist} />;
}

function DiscographyContent({ defaultArtist }: { defaultArtist?: string }) {
  const qc = useQueryClient();
  const [s, setS] = useAtom(discographyAtom);
  const debouncedQuery = useDebounce(s.query, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const { history, addToHistory } = useSearchHistory("discography-history");
  const { activeIndex, setActiveIndex, resetActiveIndex } = useInputList();

  const PAGE_SIZE = 15;
  const { releases: allReleases, loadingReleases } = useAllArtistReleases(s.selectedArtist?.id, s.roleFilter);
  const totalItems = allReleases.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const releases = allReleases.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);

  const suggestionsQueryKey = useCallback((q: string) => {
    return ["artist-suggestions", q] as const;
  }, []);

  const fetchSuggestions = useCallback((q: string, signal: AbortSignal) => {
    return fetchApi(api.discography.search.$get({ query: { q } }, { init: { signal } }));
  }, []);

  const suggestionsQuery = useQuery({
    queryKey: suggestionsQueryKey(debouncedQuery),
    queryFn: ({ signal }) => fetchSuggestions(debouncedQuery, signal),
    enabled: debouncedQuery.length >= 2 && !s.selectedArtist,
    staleTime: 60_000,
  });
  const artistSuggestions = useMemo<DiscogsArtist[]>(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);

  useEffect(() => {
    if (!suggestionsQuery.data || suggestionsQuery.data.length === 0) return;
    setS((prev) => ({ ...prev, showSuggestions: true }));
  }, [suggestionsQuery.data, setS]);

  const selectArtist = useCallback(
    (artist: DiscogsArtist) => {
      resetActiveIndex();
      setS((prev) => ({
        ...prev,
        selectedArtist: artist,
        query: artist.name,
        showSuggestions: false,
        showHistory: false,
        page: 1,
      }));
    },
    [resetActiveIndex, setS],
  );

  // Routes "user committed to this query" (Search button, Enter without arrow,
  // history click, ?artist= URL) through the same query cache as the
  // autocomplete. Cache-hit goes synchronously — no spinner, no
  // selectedArtist=null flash. Cache-miss / in-flight: `fetchQuery`
  // dedups with the autocomplete via the shared queryKey.
  const pickArtist = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length < 2) return;

      addToHistory(trimmed);
      setS((prev) => ({
        ...prev,
        showHistory: false,
        showSuggestions: false,
      }));

      const cached = qc.getQueryData<DiscogsArtist[]>(suggestionsQueryKey(trimmed));
      if (cached?.length) {
        const pick = pickFromList(cached, trimmed);
        if (pick) selectArtist(pick);
        return;
      }

      setPicking(true);
      try {
        const data = await qc.fetchQuery({
          queryKey: suggestionsQueryKey(trimmed),
          queryFn: ({ signal }) => fetchSuggestions(trimmed, signal),
          staleTime: 60_000,
        });
        if (data?.length) {
          const pick = pickFromList(data, trimmed);
          if (pick) selectArtist(pick);
        }
      } catch {
        // network/api errors handled by callApi
      } finally {
        setPicking(false);
      }
    },
    [addToHistory, fetchSuggestions, qc, selectArtist, setS, suggestionsQueryKey],
  );

  useEffect(() => {
    if (defaultArtist) pickArtist(defaultArtist);
  }, [defaultArtist, pickArtist]);

  // Close suggestions on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setS((prev) => ({ ...prev, showSuggestions: false }));
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [setS]);

  const inHistory = s.showHistory && history.length > 0;
  const inSuggestions = s.showSuggestions && artistSuggestions.length > 0;
  const dropdownOpen = inHistory || inSuggestions;
  const itemCount = inHistory ? history.length : artistSuggestions.length;

  const handleInputChange = useCallback(
    (value: string) => {
      setS((prev) => ({
        ...prev,
        query: value,
        selectedArtist: null,
        showSuggestions: value.length > 0 ? prev.showSuggestions : false,
        showHistory: value.length === 0 ? false : prev.showHistory,
      }));
    },
    [setS],
  );

  const handleInputFocus = useCallback(() => {
    if (s.query.length < 2 && history.length > 0) {
      setS((prev) => ({ ...prev, showHistory: true }));
    } else if (artistSuggestions.length > 0) {
      setS((prev) => ({ ...prev, showSuggestions: true }));
    }
  }, [s.query.length, history.length, artistSuggestions.length, setS]);

  const handleSelectIndex = useCallback(
    (index: number) => {
      if (inHistory) pickArtist(history[index]!);
      else selectArtist(artistSuggestions[index]!);
    },
    [inHistory, history, artistSuggestions, pickArtist, selectArtist],
  );

  const handleClose = useCallback(() => {
    resetActiveIndex();
    setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false }));
  }, [resetActiveIndex, setS]);

  const loadingArtists = picking || suggestionsQuery.isFetching;
  // Search is "already done" when the input still matches the currently
  // selected artist's name — clicking it would just re-pick the same row.
  // It re-enables the moment the user types something different.
  const searchDisabled =
    !s.query.trim() ||
    picking ||
    (s.selectedArtist != null && s.query.trim().toLowerCase() === s.selectedArtist.name.toLowerCase());

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        {/* Hero: title + subtitle — same display family as the home
            page, scaled down so the inner page reads as secondary. */}
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(34px, 6.5vw, 84px)",
              lineHeight: 0.9,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            Discography
          </h1>
          <p className="mt-4 text-[18px] sm:text-[20px] font-semibold text-td-fg">
            Search an artist and explore their full discography
          </p>
        </div>

        {/* Glass search bar — same visual language as the home page */}
        <div className="w-full relative z-30" ref={containerRef}>
          <div
            className="relative flex items-center gap-2.5 sm:gap-4 px-3 py-3 sm:px-5 sm:py-4 rounded-[14px] sm:rounded-[18px]"
            style={{
              background: "rgba(14, 16, 28, 0.78)",
              border: "2px solid rgba(255, 255, 255, 0.55)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.10), 0 20px 60px rgba(0,0,0,0.55)",
              backdropFilter: "blur(20px) saturate(140%)",
              WebkitBackdropFilter: "blur(20px) saturate(140%)",
            }}
          >
            <svg
              className="w-5 h-5 shrink-0"
              style={{ color: "var(--td-accent)" }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>

            <NavigableInput
              value={s.query}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              dropdownOpen={dropdownOpen}
              itemCount={itemCount}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onSelectIndex={handleSelectIndex}
              onSubmit={pickArtist}
              onClose={handleClose}
              placeholder="Oscar Mulero"
              className="flex-1 bg-transparent text-[16px] sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none min-w-0"
              style={{ caretColor: "var(--td-accent)" }}
            />

            {loadingArtists && (
              <svg
                className="w-5 h-5 animate-spin shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                style={{ color: "var(--td-accent)" }}
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}

            <button
              onClick={() => {
                handleClose();
                if (s.query.trim()) pickArtist(s.query.trim());
              }}
              disabled={searchDisabled}
              className="shrink-0 px-4 py-2.5 sm:px-8 sm:py-3.5 rounded-xl sm:rounded-2xl text-[13px] sm:text-[16px] font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--td-fg)",
                color: "var(--td-bg)",
                boxShadow: "0 0 24px rgba(255, 255, 255, 0.18)",
              }}
            >
              Search
            </button>
          </div>

          {s.showHistory && history.length > 0 && (
            <NavigableList
              items={history}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onLeave={resetActiveIndex}
              onSelect={(i) => pickArtist(history[i]!)}
              keyExtractor={(h) => h}
              header="Recent searches"
              renderItem={(h) => (
                <>
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    style={{ color: "var(--td-fg-m)" }}
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                  </svg>
                  {h}
                </>
              )}
            />
          )}

          {s.showSuggestions && artistSuggestions.length > 0 && (
            <NavigableList
              items={artistSuggestions}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onLeave={resetActiveIndex}
              onSelect={(i) => selectArtist(artistSuggestions[i]!)}
              keyExtractor={(a) => String(a.id)}
              renderItem={(a) => (
                <>
                  {a.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt={a.name} className="w-6 h-6 rounded-full object-cover" />
                  )}
                  {a.name}
                </>
              )}
            />
          )}
        </div>

        {/* Results */}
        {s.selectedArtist && (
          <div className="flex flex-col gap-5">
            {/* Glassy artist hero — single row on all sizes; chip block stacks
                vertically on mobile so the filter pills sit alongside the avatar.
                `overflow-hidden` is scoped to the gradient layer so floating
                children (legend popover) aren't clipped by the hero's rounded box. */}
            <div
              className="relative flex flex-row items-center gap-3 sm:gap-5 p-4 sm:p-5 rounded-[18px] border"
              style={{
                background: "rgba(0, 0, 0, 0.30)",
                borderColor: "rgba(255, 255, 255, 0.20)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(0,0,0,0.55)",
              }}
            >
              <div className="absolute inset-0 rounded-[18px] overflow-hidden pointer-events-none">
                <div
                  className="absolute inset-0"
                  style={{
                    background: "radial-gradient(40% 80% at 80% 50%, var(--td-accent-soft), transparent 60%)",
                    opacity: 0.6,
                  }}
                />
              </div>

              {/* Avatar + name — always inline so the avatar sits next to the
                  artist name even when the chip row drops below on mobile. */}
              <div className="relative flex items-center gap-4 sm:gap-5 flex-1 min-w-0">
                <div
                  className="w-[64px] h-[64px] sm:w-[88px] sm:h-[88px] rounded-full flex items-center justify-center shrink-0 relative overflow-hidden"
                  style={{
                    background: "conic-gradient(from 30deg, #1a1620, #3a3140, #2a2530, #1a1620)",
                    border: "1px solid var(--td-hair-2)",
                    boxShadow: "0 0 30px var(--td-accent-soft)",
                  }}
                >
                  {s.selectedArtist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.selectedArtist.imageUrl}
                      alt={s.selectedArtist.name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{
                        background: "var(--td-bg)",
                        border: "1px solid var(--td-hair-2)",
                      }}
                    >
                      <div className="w-[7px] h-[7px] rounded-full" style={{ background: "var(--td-accent)" }} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-accent">Artist</div>
                  <h2 className="font-display text-[22px] sm:text-[32px] md:text-[40px] font-normal leading-[1.05] m-0 mt-1 break-words">
                    {s.selectedArtist.name}
                  </h2>
                  {!loadingReleases && totalItems > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono-td text-[12px] text-td-fg-d">
                        {totalItems} release{totalItems !== 1 ? "s" : ""}
                      </span>
                      <ReleaseTagLegend />
                    </div>
                  )}
                </div>
              </div>

              {/* Filter chips — vertical stack on mobile (right side, even
                  widths), single row on sm+. */}
              <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                {(["main", "all"] as const).map((f) => {
                  const active = s.roleFilter === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setS((prev) => ({ ...prev, roleFilter: f, page: 1 }))}
                      className="px-3 py-1.5 text-[11px] rounded-full transition-colors whitespace-nowrap"
                      style={{
                        border: `1px solid ${active ? "var(--td-accent)" : "rgba(255, 255, 255, 0.22)"}`,
                        color: active ? "var(--td-accent)" : "var(--td-fg-d)",
                        background: active ? "var(--td-accent-soft)" : "rgba(0, 0, 0, 0.30)",
                      }}
                    >
                      {f === "main" ? "Main releases" : "All"}
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingReleases && (
              <div className="flex justify-center py-10">
                <svg
                  className="w-6 h-6 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                  style={{ color: "var(--td-accent)" }}
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}

            {!loadingReleases && totalItems === 0 && (
              <p className="text-sm text-td-fg-m text-center py-10">No releases found</p>
            )}

            {releases.length > 0 && (
              <div className="relative">
                <div
                  className="absolute top-6 bottom-6 w-px pointer-events-none"
                  style={{ left: "52px", background: "var(--td-hair-2)" }}
                />
                <div className="flex flex-col gap-2">
                  {releases.map((r, i) => {
                    const prevYear = i > 0 ? releases[i - 1]!.year : undefined;
                    const showYear = i === 0 || prevYear !== r.year;
                    return (
                      <div key={r.id} className="flex items-start relative gap-6">
                        <div
                          className="w-[36px] shrink-0 pt-[34px] text-right font-mono-td text-[11px] uppercase tracking-[0.14em]"
                          style={{ color: "var(--td-accent)" }}
                        >
                          {showYear && (r.year ?? "—")}
                        </div>
                        <div
                          className="absolute rounded-full"
                          style={{
                            top: showYear ? "35px" : "37px",
                            left: showYear ? "47px" : "49px",
                            width: showYear ? "10px" : "6px",
                            height: showYear ? "10px" : "6px",
                            background: showYear ? "var(--td-accent)" : "var(--td-hair-2)",
                            boxShadow: showYear ? "0 0 12px var(--td-accent-soft)" : "none",
                            zIndex: 1,
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <AlbumAccordion release={r} artistName={s.selectedArtist!.name} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setS((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={s.page === 1}
                  className="px-5 py-2 text-sm font-medium rounded-full border transition-transform duration-150 ease-out hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100"
                  style={{
                    borderColor: "rgba(255, 255, 255, 0.30)",
                    background: "rgba(255,255,255,0.12)",
                    color: "var(--td-fg)",
                    backdropFilter: "blur(16px) saturate(140%)",
                    WebkitBackdropFilter: "blur(16px) saturate(140%)",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
                  }}
                >
                  ← Prev
                </button>
                <span className="text-sm font-mono-td text-td-fg">
                  {s.page} / {totalPages}
                </span>
                <button
                  onClick={() => setS((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
                  disabled={s.page === totalPages}
                  className="px-5 py-2 text-sm font-medium rounded-full border transition-transform duration-150 ease-out hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100"
                  style={{
                    borderColor: "rgba(255, 255, 255, 0.30)",
                    background: "rgba(255,255,255,0.12)",
                    color: "var(--td-fg)",
                    backdropFilter: "blur(16px) saturate(140%)",
                    WebkitBackdropFilter: "blur(16px) saturate(140%)",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function pickFromList(list: DiscogsArtist[], trimmed: string): DiscogsArtist | undefined {
  const exact = list.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  return exact ?? list[0];
}
