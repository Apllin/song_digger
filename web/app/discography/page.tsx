"use client";

import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import { discographyAtom } from "@/lib/atoms/discography";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { ArtistRelease } from "@/lib/python-api/generated/types/ArtistRelease";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";
import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";

const PAGE_SIZE = 15;

async function fetchAllReleases(artistId: number): Promise<ArtistRelease[]> {
  const PER_PAGE = 100;
  const first = await parseResponse(
    api.discography.releases.$get({
      query: { artistId: String(artistId), page: "1", perPage: String(PER_PAGE) },
    }),
  );

  const releases: ArtistRelease[] = [...first.releases];
  const totalPages = first.pagination.pages;

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        parseResponse(
          api.discography.releases.$get({
            query: { artistId: String(artistId), page: String(i + 2), perPage: String(PER_PAGE) },
          }),
        ),
      ),
    );
    for (const page of rest) {
      releases.push(...page.releases);
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
  const debouncedQuery = useDebounce(s.query, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const didAutoLoad = useRef(false);
  const { history, addToHistory } = useSearchHistory("discography-history");

  function selectArtist(artist: DiscogsArtist) {
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
    fetchApi(api.discography.search.$get({ query: { q: name } }))
      .then((data) => {
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
    fetchApi(api.discography.search.$get({ query: { q: artistParam } }))
      .then((data) => {
        if (!data || data.length === 0) return;
        const exact = data.find((a) => a.name.toLowerCase() === artistParam.toLowerCase());
        selectArtist(exact ?? data[0]!);
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
    fetchApi(api.discography.search.$get({ query: { q: debouncedQuery } }))
      .then((data) => {
        if (!data) return;
        setS((prev) => ({ ...prev, artistSuggestions: data, showSuggestions: true }));
      })
      .catch(() => setS((prev) => ({ ...prev, artistSuggestions: [] })))
      .finally(() => setS((prev) => ({ ...prev, loadingArtists: false })));
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

  const filteredReleases = (s.roleFilter === "main" ? s.releases.filter((r) => r.role === "Main") : s.releases)
    .slice()
    .sort((a, b) => {
      if (a.year == null && b.year == null) return 0;
      if (a.year == null) return 1;
      if (b.year == null) return -1;
      return b.year - a.year;
    });
  const totalPages = Math.ceil(filteredReleases.length / PAGE_SIZE);
  const pagedReleases = filteredReleases.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);

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
                const items = inHistory ? history : inSuggestions ? s.artistSuggestions.map((a) => a.name) : [];
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
                  setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false }));
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
              placeholder="Oscar Mulero"
              className="flex-1 bg-transparent text-[16px] sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none min-w-0"
              style={{ caretColor: "var(--td-accent)" }}
            />

            {s.loadingArtists && (
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
                setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false, activeIndex: -1 }));
                if (s.query.trim()) searchArtistByName(s.query.trim());
              }}
              disabled={!s.query.trim() || s.loadingArtists}
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

          {/* History dropdown */}
          {s.showHistory && history.length > 0 && (
            <ul
              className="absolute z-50 top-full mt-2 left-0 right-0 rounded-2xl overflow-hidden shadow-2xl border backdrop-blur"
              style={{
                background: "rgba(20,18,26,0.92)",
                borderColor: "rgba(255, 255, 255, 0.18)",
              }}
            >
              <li className="px-5 py-2 font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg-m">
                Recent searches
              </li>
              {history.map((h, i) => (
                <li key={h}>
                  <button
                    onMouseEnter={() => setS((prev) => ({ ...prev, activeIndex: i }))}
                    onMouseLeave={() => setS((prev) => ({ ...prev, activeIndex: -1 }))}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      searchArtistByName(h);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left"
                    style={{
                      background: i === s.activeIndex ? "rgba(255, 255, 255, 0.10)" : "transparent",
                      color: i === s.activeIndex ? "var(--td-fg)" : "var(--td-fg-d)",
                    }}
                  >
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
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Autocomplete suggestions */}
          {s.showSuggestions && s.artistSuggestions.length > 0 && (
            <ul
              className="absolute z-50 top-full mt-2 left-0 right-0 rounded-2xl overflow-hidden shadow-2xl border backdrop-blur"
              style={{
                background: "rgba(20,18,26,0.92)",
                borderColor: "rgba(255, 255, 255, 0.18)",
              }}
            >
              {s.artistSuggestions.map((a, i) => (
                <li key={a.id}>
                  <button
                    onMouseEnter={() => setS((prev) => ({ ...prev, activeIndex: i }))}
                    onMouseLeave={() => setS((prev) => ({ ...prev, activeIndex: -1 }))}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectArtist(a);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left"
                    style={{
                      background: i === s.activeIndex ? "rgba(255, 255, 255, 0.10)" : "transparent",
                      color: i === s.activeIndex ? "var(--td-fg)" : "var(--td-fg-d)",
                    }}
                  >
                    {a.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
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
          <div className="flex flex-col gap-5">
            {/* Glassy artist hero — single row on all sizes; chip block stacks
                vertically on mobile so the filter pills sit alongside the avatar. */}
            <div
              className="relative flex flex-row items-center gap-3 sm:gap-5 p-4 sm:p-5 rounded-[18px] border overflow-hidden"
              style={{
                background: "rgba(0, 0, 0, 0.30)",
                borderColor: "rgba(255, 255, 255, 0.20)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(0,0,0,0.55)",
              }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "radial-gradient(40% 80% at 80% 50%, var(--td-accent-soft), transparent 60%)",
                  opacity: 0.6,
                }}
              />

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
                  {!s.loadingReleases && s.releases.length > 0 && (
                    <div className="font-mono-td text-[12px] text-td-fg-d mt-1">
                      {s.releases.length} release{s.releases.length !== 1 ? "s" : ""}
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

            {s.loadingReleases && (
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

            {!s.loadingReleases && filteredReleases.length === 0 && (
              <p className="text-sm text-td-fg-m text-center py-10">No releases found</p>
            )}

            {pagedReleases.length > 0 && (
              <div className="relative">
                <div
                  className="absolute top-6 bottom-6 w-px pointer-events-none"
                  style={{ left: "52px", background: "var(--td-hair-2)" }}
                />
                <div className="flex flex-col gap-2">
                  {pagedReleases.map((r, i) => {
                    const prevYear = i > 0 ? pagedReleases[i - 1].year : undefined;
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
