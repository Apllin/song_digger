"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAllArtistReleases } from "../hooks/useAllArtistReleases";
import { useInputList } from "../hooks/useInputList";
import { ArtistHero } from "./ArtistHero";
import { ArtistSearchBar } from "./ArtistSearchBar";
import { DiscographyHero } from "./DiscographyHero";
import { Pagination } from "./Pagination";
import { ReleaseTimeline } from "./ReleaseTimeline";

import { discographyAtom } from "@/lib/atoms/discography";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";
import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";

const PAGE_SIZE = 15;

export function DiscographyPage() {
  const defaultArtist = useSearchParams().get("artist") ?? undefined;
  const qc = useQueryClient();
  const [s, setS] = useAtom(discographyAtom);
  const debouncedQuery = useDebounce(s.query, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const { history, addToHistory } = useSearchHistory("discography-history");
  const { activeIndex, setActiveIndex, resetActiveIndex } = useInputList();

  const { releases, totalItems, totalPages, loadingReleases } = useAllArtistReleases({
    artistId: s.selectedArtist?.id,
    role: s.roleFilter === "main" ? "Main" : "all",
    page: s.page,
    perPage: PAGE_SIZE,
    sort: "year_desc",
  });

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

  const handleQueryChange = useCallback(
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

  const handleSearch = useCallback(() => {
    handleClose();
    if (s.query.trim()) pickArtist(s.query.trim());
  }, [handleClose, pickArtist, s.query]);

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
        <DiscographyHero />

        <ArtistSearchBar
          containerRef={containerRef}
          query={s.query}
          onQueryChange={handleQueryChange}
          onFocus={handleInputFocus}
          loading={loadingArtists}
          searchDisabled={searchDisabled}
          onSearch={handleSearch}
          dropdownOpen={dropdownOpen}
          itemCount={itemCount}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onResetActiveIndex={resetActiveIndex}
          onClose={handleClose}
          onSelectIndex={handleSelectIndex}
          showHistory={s.showHistory}
          history={history}
          onPickArtist={pickArtist}
          showSuggestions={s.showSuggestions}
          suggestions={artistSuggestions}
          onSelectSuggestion={selectArtist}
        />

        {s.selectedArtist && (
          <div className="flex flex-col gap-5">
            <ArtistHero
              selectedArtist={s.selectedArtist}
              totalItems={totalItems}
              loadingReleases={loadingReleases}
              roleFilter={s.roleFilter}
              onRoleFilterChange={(f) => setS((prev) => ({ ...prev, roleFilter: f, page: 1 }))}
            />

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

            {releases.length > 0 && <ReleaseTimeline releases={releases} artistName={s.selectedArtist.name} />}

            {totalPages > 1 && (
              <Pagination
                page={s.page}
                totalPages={totalPages}
                onPrev={() => setS((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                onNext={() => setS((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
              />
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
