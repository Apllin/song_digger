"use client";

import { useEffect, useRef, Suspense } from "react";
import { useAtom, useSetAtom } from "jotai";
import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import { useSearchHistory } from "@/lib/use-search-history";
import { useDebounce } from "@/lib/use-debounce";
import { labelsAtom, type Label, type LabelRelease } from "@/lib/atoms/labels";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { fetchWithAnonGate } from "@/lib/fetch-with-anon-gate";

const POPULAR_LABELS = [
  "Tresor", "Ostgut Ton", "трип", "Lotus Parable",
  "Hypnus Records", "Another Psyde Records", "SK_Eleven",
];

const PAGE_SIZE = 15;

async function fetchAllLabelReleases(
  labelId: number,
  signal?: AbortSignal
): Promise<LabelRelease[]> {
  const first = await fetch(
    `/api/discography/label/releases?labelId=${labelId}&page=1&perPage=100`,
    { signal }
  ).then((r) => r.json());

  const releases: LabelRelease[] = first.releases ?? [];
  const totalPages: number = first.pagination?.pages ?? 1;

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        fetch(
          `/api/discography/label/releases?labelId=${labelId}&page=${i + 2}&perPage=100`,
          { signal }
        ).then((r) => r.json())
      )
    );
    for (const p of rest) releases.push(...(p.releases ?? []));
  }

  const seen = new Set<number>();
  return releases.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

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

  function selectLabel(label: Label) {
    setS((prev) => ({
      ...prev,
      selectedLabel: label,
      query: label.name,
      showSuggestions: false,
      showHistory: false,
      activeIndex: -1,
      page: 1,
      releases: [],
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
      releases: [],
      suggestions: [],
      page: 1,
      showSuggestions: false,
      showHistory: false,
      loadingLabels: true,
    }));
    addToHistory(name);
    fetchWithAnonGate(
      `/api/discography/label/search?q=${encodeURIComponent(name)}`,
      { signal: ac.signal },
      onAnonLimit,
    )
      .then((r) => (r ? r.json() : null))
      .then((data: Label[] | null) => {
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
    fetchWithAnonGate(
      `/api/discography/label/search?q=${encodeURIComponent(debouncedQuery)}`,
      { signal: ac.signal },
      onAnonLimit,
    )
      .then((r) => (r ? r.json() : null))
      .then((data: Label[] | null) => {
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

  // Load releases when label selected
  useEffect(() => {
    if (!s.selectedLabel) return;
    const ac = new AbortController();
    setS((prev) => ({ ...prev, loadingReleases: true }));
    fetchAllLabelReleases(s.selectedLabel.id, ac.signal)
      .then((all) => {
        if (ac.signal.aborted) return;
        setS((prev) => ({ ...prev, releases: all }));
      })
      .catch(() => {
        if (!ac.signal.aborted) setS((prev) => ({ ...prev, releases: [] }));
      })
      .finally(() => {
        if (!ac.signal.aborted) setS((prev) => ({ ...prev, loadingReleases: false }));
      });
    return () => ac.abort();
  }, [s.selectedLabel, setS]);

  const totalPages = Math.ceil(s.releases.length / PAGE_SIZE);
  const pagedReleases = s.releases.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Labels</h1>
          <p className="text-sm text-zinc-500">Browse releases by record label via Discogs</p>
        </div>

        {/* Popular labels */}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Popular techno labels</p>
          <div className="flex flex-wrap gap-2">
            {POPULAR_LABELS.map((name) => (
              <button
                key={name}
                onClick={() => searchLabelByName(name)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  s.selectedLabel?.name === name
                    ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                    : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Label search input */}
        <div className="relative" ref={containerRef}>
          <div className="relative">
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
                const items = inHistory
                  ? history
                  : inSuggestions
                  ? s.suggestions.map((l) => l.name)
                  : [];
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
              placeholder="Search label (e.g. Tresor, Ostgut Ton…)"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 pr-10 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {s.loadingLabels && (
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
                    onMouseDown={(e) => { e.preventDefault(); searchLabelByName(h); }}
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
          {s.showSuggestions && s.suggestions.length > 0 && (
            <ul className="absolute z-50 top-full mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
              {s.suggestions.map((l, i) => (
                <li key={l.id}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); selectLabel(l); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                      i === s.activeIndex ? "bg-zinc-700 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {l.imageUrl && (
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
                <p className="font-semibold text-zinc-100">{s.selectedLabel.name}</p>
                {!s.loadingReleases && s.releases.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    {s.releases.length} release{s.releases.length !== 1 ? "s" : ""}
                  </p>
                )}
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

            {!s.loadingReleases && s.releases.length === 0 && (
              <p className="text-sm text-zinc-600 text-center py-10">No releases found</p>
            )}

            <div className="flex flex-col gap-2">
              {pagedReleases.map((r) => (
                <AlbumAccordion
                  key={r.id}
                  release={{
                    id: r.id,
                    title: r.title,
                    year: r.year,
                    type: r.type ?? "release",
                    format: r.format,
                    label: r.catno && r.catno !== "none" ? r.catno : undefined,
                    thumb: r.thumb,
                  }}
                  artistName={r.artist ?? "Various"}
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
