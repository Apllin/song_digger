"use client";

import { parseResponse } from "hono/client";
import { useAtom, useSetAtom } from "jotai";
import { Suspense, useEffect, useRef } from "react";

import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import { useAllLabelReleases } from "@/features/label/hooks/useAllLabelReleases";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { labelsAtom } from "@/lib/atoms/labels";
import { api } from "@/lib/hono/client";
import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";
import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";
import { withAnonGate } from "@/lib/with-anon-gate";

const POPULAR_LABELS = [
  "Tresor",
  "Ostgut Ton",
  "трип",
  "Lotus Parable",
  "Hypnus Records",
  "Another Psyde Records",
  "SK_Eleven",
];

const PAGE_SIZE = 15;

export default function LabelsPage() {
  return (
    <Suspense>
      <LabelsContent />
    </Suspense>
  );
}

function LabelsContent() {
  const [s, setS] = useAtom(labelsAtom);
  const setShowRegisterPrompt = useSetAtom(showRegisterPromptAtom);
  const debouncedQuery = useDebounce(s.query, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const autocompleteAbortRef = useRef<AbortController | null>(null);
  const { history, addToHistory } = useSearchHistory("labels-history");

  const onAnonLimit = () => setShowRegisterPrompt(true);

  function selectLabel(label: DiscogsLabel) {
    setS((prev) => ({
      ...prev,
      selectedLabel: label,
      query: label.name,
      showSuggestions: false,
      showHistory: false,
      activeIndex: -1,
      page: 1,
    }));
  }

  function searchLabelByName(name: string) {
    searchAbortRef.current?.abort();
    autocompleteAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;

    setS((prev) => ({
      ...prev,
      query: name,
      selectedLabel: null,
      suggestions: [],
      page: 1,
      showSuggestions: false,
      showHistory: false,
      loadingLabels: true,
    }));
    addToHistory(name);
    withAnonGate(
      parseResponse(api.discography.label.search.$get({ query: { q: name } }, { init: { signal: ac.signal } })),
      onAnonLimit,
    )
      .then((data) => {
        if (ac.signal.aborted || !data) return;
        const exact = data.find((l) => l.name.toLowerCase() === name.toLowerCase());
        const pick = exact ?? data[0];
        if (pick) selectLabel(pick);
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setS((prev) => ({ ...prev, loadingLabels: false }));
      });
  }

  // Autocomplete while typing
  useEffect(() => {
    if (debouncedQuery !== s.query) return;
    if (debouncedQuery.length < 2 || s.selectedLabel) {
      setS((prev) => ({ ...prev, suggestions: [] }));
      return;
    }
    autocompleteAbortRef.current?.abort();
    const ac = new AbortController();
    autocompleteAbortRef.current = ac;
    setS((prev) => ({ ...prev, loadingLabels: true }));
    withAnonGate(
      parseResponse(
        api.discography.label.search.$get({ query: { q: debouncedQuery } }, { init: { signal: ac.signal } }),
      ),
      onAnonLimit,
    )
      .then((data) => {
        if (ac.signal.aborted || !data) return;
        setS((prev) => ({ ...prev, suggestions: data, showSuggestions: true }));
      })
      .catch(() => {
        if (!ac.signal.aborted) setS((prev) => ({ ...prev, suggestions: [] }));
      })
      .finally(() => {
        if (!ac.signal.aborted) setS((prev) => ({ ...prev, loadingLabels: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, s.selectedLabel, s.query, setS]);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false }));
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [setS]);

  const { releases, loadingReleases } = useAllLabelReleases(s.selectedLabel?.id);

  const totalPages = Math.ceil(releases.length / PAGE_SIZE);
  const pagedReleases = releases.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);

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
            Labels
          </h1>
          <p className="mt-4 text-[18px] sm:text-[20px] font-semibold text-td-fg">Browse releases by record label</p>
        </div>

        {/* Popular labels — glass chips, same language as nav */}
        <div className="flex flex-col gap-3">
          <p className="font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg">Popular techno labels</p>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {POPULAR_LABELS.map((name) => {
              const active = s.selectedLabel?.name === name;
              return (
                <button
                  key={name}
                  onClick={() => searchLabelByName(name)}
                  className="px-3 py-2 sm:px-4 sm:py-2.5 text-[12px] sm:text-[13px] font-medium rounded-lg border transition-colors whitespace-nowrap"
                  style={{
                    color: active ? "var(--td-fg)" : "var(--td-fg-d)",
                    background: "rgba(14, 16, 28, 0.78)",
                    borderColor: active ? "var(--td-accent)" : "rgba(255, 255, 255, 0.22)",
                    boxShadow: active
                      ? "0 0 0 1px var(--td-accent-soft), 0 6px 18px rgba(0,0,0,0.35)"
                      : "0 6px 18px rgba(0,0,0,0.3)",
                    backdropFilter: "blur(20px) saturate(140%)",
                    WebkitBackdropFilter: "blur(20px) saturate(140%)",
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Glass search bar — matches the home page */}
        <div className="w-full relative z-30" ref={containerRef}>
          <div
            className="relative flex items-center gap-2.5 sm:gap-4 px-3 py-3 sm:px-5 sm:py-4 rounded-[14px] sm:rounded-[18px] border"
            style={{
              background: "rgba(14, 16, 28, 0.78)",
              borderColor: "rgba(255, 255, 255, 0.38)",
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
                  selectedLabel: null,
                  showSuggestions: e.target.value.length > 0 ? prev.showSuggestions : false,
                  showHistory: e.target.value.length === 0 ? false : prev.showHistory,
                }));
              }}
              onFocus={() => {
                if (s.query.length < 2 && history.length > 0) {
                  setS((prev) => ({ ...prev, showHistory: true }));
                } else if (s.suggestions.length > 0) {
                  setS((prev) => ({ ...prev, showSuggestions: true }));
                }
              }}
              onKeyDown={(e) => {
                const inHistory = s.showHistory && history.length > 0;
                const inSuggestions = s.showSuggestions && s.suggestions.length > 0;
                const items = inHistory ? history : inSuggestions ? s.suggestions.map((l) => l.name) : [];
                const dropdownOpen = inHistory || inSuggestions;

                if (!dropdownOpen) {
                  if (e.key === "Enter" && s.query.trim()) searchLabelByName(s.query.trim());
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
                    if (inHistory) searchLabelByName(items[s.activeIndex]);
                    else selectLabel(s.suggestions[s.activeIndex]);
                  } else if (s.query.trim()) {
                    searchLabelByName(s.query.trim());
                  }
                } else if (e.key === "Escape") {
                  setS((prev) => ({ ...prev, showSuggestions: false, showHistory: false }));
                }
              }}
              placeholder="Tresor"
              className="flex-1 bg-transparent text-[16px] sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none min-w-0"
              style={{ caretColor: "var(--td-accent)" }}
            />

            {s.loadingLabels && (
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
                if (s.query.trim()) searchLabelByName(s.query.trim());
              }}
              disabled={!s.query.trim() || s.loadingLabels}
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
                      searchLabelByName(h);
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
          {s.showSuggestions && s.suggestions.length > 0 && (
            <ul
              className="absolute z-50 top-full mt-2 left-0 right-0 rounded-2xl overflow-hidden shadow-2xl border backdrop-blur"
              style={{
                background: "rgba(20,18,26,0.92)",
                borderColor: "rgba(255, 255, 255, 0.18)",
              }}
            >
              {s.suggestions.map((l, i) => (
                <li key={l.id}>
                  <button
                    onMouseEnter={() => setS((prev) => ({ ...prev, activeIndex: i }))}
                    onMouseLeave={() => setS((prev) => ({ ...prev, activeIndex: -1 }))}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectLabel(l);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left"
                    style={{
                      background: i === s.activeIndex ? "rgba(255, 255, 255, 0.10)" : "transparent",
                      color: i === s.activeIndex ? "var(--td-fg)" : "var(--td-fg-d)",
                    }}
                  >
                    {l.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.imageUrl} alt={l.name} className="w-6 h-6 rounded object-cover" />
                    )}
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Releases */}
        {s.selectedLabel && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display text-[20px] font-normal text-td-fg leading-tight">{s.selectedLabel.name}</p>
                {!loadingReleases && releases.length > 0 && (
                  <p className="font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-fg-d mt-0.5">
                    {releases.length} release{releases.length !== 1 ? "s" : ""}
                  </p>
                )}
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

            {!loadingReleases && releases.length === 0 && (
              <p className="text-sm text-td-fg-m text-center py-10">No releases found</p>
            )}

            <div className="flex flex-col gap-2">
              {pagedReleases.map((r) => (
                <AlbumAccordion
                  key={r.id}
                  release={{
                    id: r.id,
                    title: r.title,
                    year: r.year ?? undefined,
                    type: r.type ?? "release",
                    format: r.format ?? undefined,
                    label: r.catno && r.catno !== "none" ? r.catno : undefined,
                    thumb: r.thumb ?? undefined,
                  }}
                  artistName={r.artist ?? "Various"}
                />
              ))}
            </div>

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
