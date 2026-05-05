"use client";

import { useEffect, useRef, Suspense } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import { useSearchHistory } from "@/lib/use-search-history";
import { useDebounce } from "@/lib/use-debounce";
import { discographyAtom, type Artist, type Release } from "@/lib/atoms/discography";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { fetchWithAnonGate } from "@/lib/fetch-with-anon-gate";

const PAGE_SIZE = 15;

async function fetchAllReleases(artistId: number): Promise<Release[]> {
  const PER_PAGE = 100;
  const first = await fetch(
    `/api/discography/releases?artistId=${artistId}&page=1&perPage=${PER_PAGE}`
  ).then((r) => r.json());

  const releases: Release[] = first.releases ?? [];
  const totalPages: number = first.pagination?.pages ?? 1;

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        fetch(
          `/api/discography/releases?artistId=${artistId}&page=${i + 2}&perPage=${PER_PAGE}`
        ).then((r) => r.json())
      )
    );
    for (const page of rest) {
      releases.push(...(page.releases ?? []));
    }
  }

  return releases;
}

export default function DiscographyPage() {
  return (
    <Suspense>
      <DiscographyContent />
    </Suspense>
  );
}

function DiscographyContent() {
  const searchParams = useSearchParams();
  const [s, setS] = useAtom(discographyAtom);
  const setShowRegisterPrompt = useSetAtom(showRegisterPromptAtom);
  const debouncedQuery = useDebounce(s.query, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const didAutoLoad = useRef(false);
  const { history, addToHistory } = useSearchHistory("discography-history");

  const onAnonLimit = () => setShowRegisterPrompt(true);

  function selectArtist(artist: Artist) {
    setS((prev) => ({
      ...prev,
      selectedArtist: artist,
      query: artist.name,
      showSuggestions: false,
      showHistory: false,
      activeIndex: -1,
      releases: [],
      page: 1,
    }));
  }

  function searchArtistByName(name: string) {
    setS((prev) => ({
      ...prev,
      query: name,
      selectedArtist: null,
      releases: [],
      page: 1,
      showHistory: false,
      showSuggestions: false,
      loadingArtists: true,
    }));
    addToHistory(name);
    fetchWithAnonGate(
      `/api/discography/search?q=${encodeURIComponent(name)}`,
      undefined,
      onAnonLimit,
    )
      .then((r) => (r ? r.json() : null))
      .then((data: Artist[] | null) => {
        if (!data) return;
        const exact = data.find((a) => a.name.toLowerCase() === name.toLowerCase());
        const pick = exact ?? data[0];
        if (pick) selectArtist(pick);
      })
      .catch(() => {})
      .finally(() => setS((prev) => ({ ...prev, loadingArtists: false })));
  }

  // Auto-load artist from ?artist= URL param
  useEffect(() => {
    if (didAutoLoad.current) return;
    const artistParam = searchParams.get("artist");
    if (!artistParam) return;
    didAutoLoad.current = true;

    setS((prev) => ({ ...prev, query: artistParam, loadingArtists: true }));
    fetchWithAnonGate(
      `/api/discography/search?q=${encodeURIComponent(artistParam)}`,
      undefined,
      onAnonLimit,
    )
      .then((r) => (r ? r.json() : null))
      .then((data: Artist[] | null) => {
        if (!data || data.length === 0) return;
        const exact = data.find(
          (a) => a.name.toLowerCase() === artistParam.toLowerCase()
        );
        selectArtist(exact ?? data[0]);
      })
      .catch(() => {})
      .finally(() => setS((prev) => ({ ...prev, loadingArtists: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Artist search autocomplete
  useEffect(() => {
    if (debouncedQuery.length < 2 || s.selectedArtist) {
      setS((prev) => ({ ...prev, artistSuggestions: [] }));
      return;
    }
    setS((prev) => ({ ...prev, loadingArtists: true }));
    fetchWithAnonGate(
      `/api/discography/search?q=${encodeURIComponent(debouncedQuery)}`,
      undefined,
      onAnonLimit,
    )
      .then((r) => (r ? r.json() : null))
      .then((data: Artist[] | null) => {
        if (!data) return;
        setS((prev) => ({ ...prev, artistSuggestions: data, showSuggestions: true }));
      })
      .catch(() => setS((prev) => ({ ...prev, artistSuggestions: [] })))
      .finally(() => setS((prev) => ({ ...prev, loadingArtists: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, s.selectedArtist, setS]);

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

  // Load all releases when artist is selected
  useEffect(() => {
    if (!s.selectedArtist) return;
    setS((prev) => ({ ...prev, loadingReleases: true }));
    fetchAllReleases(s.selectedArtist.id)
      .then((all) => setS((prev) => ({ ...prev, releases: all })))
      .catch(() => setS((prev) => ({ ...prev, releases: [] })))
      .finally(() => setS((prev) => ({ ...prev, loadingReleases: false })));
  }, [s.selectedArtist, setS]);

  const filteredReleases =
    s.roleFilter === "main" ? s.releases.filter((r) => r.role === "Main") : s.releases;
  const totalPages = Math.ceil(filteredReleases.length / PAGE_SIZE);
  const pagedReleases = filteredReleases.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Discography</h1>
          <p className="text-sm text-zinc-500">
            Search an artist to browse their full discography via Discogs
          </p>
        </div>

        {/* Artist search */}
        <div className="relative" ref={containerRef}>
          <div className="relative">
            <input
              type="text"
              value={s.query}
              onChange={(e) => {
                setS((prev) => ({
                  ...prev,
                  query: e.target.value,
                  selectedArtist: null,
                  showSuggestions: e.target.value.length > 0 ? prev.showSuggestions : false,
                  showHistory: e.target.value.length === 0 ? false : prev.showHistory,
                }));
              }}
              onFocus={() => {
                if (s.query.length < 2 && history.length > 0) {
                  setS((prev) => ({ ...prev, showHistory: true }));
                } else if (s.artistSuggestions.length > 0) {
                  setS((prev) => ({ ...prev, showSuggestions: true }));
                }
              }}
              onKeyDown={(e) => {
                const inHistory = s.showHistory && history.length > 0;
                const inSuggestions = s.showSuggestions && s.artistSuggestions.length > 0;
                const items = inHistory
                  ? history
                  : inSuggestions
                  ? s.artistSuggestions.map((a) => a.name)
                  : [];
                const dropdownOpen = inHistory || inSuggestions;

                if (!dropdownOpen) {
                  if (e.key === "Enter" && s.query.trim()) searchArtistByName(s.query.trim());
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setS((prev) => ({ ...prev, activeIndex: Math.min(prev.activeIndex + 1, items.length - 1) }));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setS((prev) => ({ ...prev, activeIndex: Math.max(prev.activeIndex - 1, -1) }));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (s.activeIndex >= 0) {
                    if (inHistory) searchArtistByName(items[s.activeIndex]);
                    else selectArtist(s.artistSuggestions[s.activeIndex]);
                  } else if (s.query.trim()) {
                    searchArtistByName(s.query.trim());
                  }
                } else if (e.key === "Escape") {
                  setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false }));
                }
              }}
              placeholder="Search artist (e.g. Ignez - Aventurine)"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 pr-10 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {s.loadingArtists && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="w-4 h-4 animate-spin text-zinc-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}
          </div>

          {/* History dropdown */}
          {s.showHistory && history.length > 0 && (
            <ul className="absolute z-50 top-full mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
              <li className="px-4 py-1.5">
                <span className="text-[10px] uppercase tracking-wide text-zinc-600">Recent searches</span>
              </li>
              {history.map((h, i) => (
                <li key={h}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); searchArtistByName(h); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                      i === s.activeIndex ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                    </svg>
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Autocomplete suggestions */}
          {s.showSuggestions && s.artistSuggestions.length > 0 && (
            <ul className="absolute z-50 top-full mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
              {s.artistSuggestions.map((a, i) => (
                <li key={a.id}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); selectArtist(a); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                      i === s.activeIndex ? "bg-zinc-700 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {a.imageUrl && (
                      <img src={a.imageUrl} alt={a.name} className="w-6 h-6 rounded-full object-cover" />
                    )}
                    {a.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Results */}
        {s.selectedArtist && (
          <div className="flex flex-col gap-4">
            {/* Artist header + filters */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold text-zinc-100">{s.selectedArtist.name}</p>
                {!s.loadingReleases && s.releases.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    {s.releases.length} release{s.releases.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <div className="flex gap-1">
                {(["main", "all"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setS((prev) => ({ ...prev, roleFilter: f, page: 1 }))}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      s.roleFilter === f
                        ? "bg-zinc-700 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {f === "main" ? "Main releases" : "All"}
                  </button>
                ))}
              </div>
            </div>

            {s.loadingReleases && (
              <div className="flex justify-center py-10">
                <svg className="w-6 h-6 animate-spin text-zinc-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}

            {!s.loadingReleases && filteredReleases.length === 0 && (
              <p className="text-sm text-zinc-600 text-center py-10">No releases found</p>
            )}

            <div className="flex flex-col gap-2">
              {pagedReleases.map((r) => (
                <AlbumAccordion
                  key={r.id}
                  release={r}
                  artistName={s.selectedArtist!.name}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setS((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={s.page === 1}
                  className="px-3 py-1.5 text-sm bg-zinc-800 rounded-lg disabled:opacity-40 hover:bg-zinc-700 transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-sm text-zinc-500">{s.page} / {totalPages}</span>
                <button
                  onClick={() => setS((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
                  disabled={s.page === totalPages}
                  className="px-3 py-1.5 text-sm bg-zinc-800 rounded-lg disabled:opacity-40 hover:bg-zinc-700 transition-colors"
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
