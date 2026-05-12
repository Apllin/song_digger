"use client";

import { useCallback } from "react";

import { SearchBar } from "@/components/SearchBar";
import { ResultsGrid } from "@/features/search/components/ResultsGrid";
import { useSearchFlow } from "@/features/search/hooks/useSearchFlow";

interface SearchSectionProps {
  initialQuery: string;
}

export function SearchSection({ initialQuery }: SearchSectionProps) {
  const { search, setSearch, startSearch, isSearching, isFetchingPage, isError, data } = useSearchFlow(initialQuery);
  const { query, page } = search;
  const { tracks = [], pagination = null } = data ?? {};

  const handleSearch = useCallback(() => startSearch(query), [query, startSearch]);

  return (
    <>
      <SearchBar
        value={query}
        onChange={(v) => setSearch((prev) => ({ ...prev, query: v }))}
        onSubmit={handleSearch}
        loading={isSearching}
      />

      {isSearching && (
        <div className="flex flex-col items-center gap-3 py-20 text-td-fg-d">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm">Searching across sources…</p>
        </div>
      )}

      {isError && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: "rgba(220,90,90,0.45)",
            background: "rgba(120,30,30,0.18)",
            color: "#f3b8b8",
          }}
        >
          Search failed. Please try again.
        </div>
      )}

      {!isSearching && pagination != null && pagination.items === 0 && (
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

      {!isSearching && pagination != null && pagination.items > 0 && (
        <ResultsGrid
          tracks={tracks}
          page={page}
          totalPages={pagination.pages}
          totalItems={pagination.items}
          isLoading={isFetchingPage}
          onPrev={() => setSearch((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
          onNext={() => setSearch((prev) => ({ ...prev, page: Math.min(pagination.pages, prev.page + 1) }))}
        />
      )}
    </>
  );
}
