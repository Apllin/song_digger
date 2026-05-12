import type { RefObject } from "react";
import { NavigableInput } from "./NavigableInput";
import { NavigableList } from "./NavigableList";

import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface ArtistSearchBarProps {
  containerRef: RefObject<HTMLDivElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onFocus: () => void;
  loading: boolean;
  searchDisabled: boolean;
  onSearch: () => void;
  dropdownOpen: boolean;
  itemCount: number;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onResetActiveIndex: () => void;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  showHistory: boolean;
  history: string[];
  onPickArtist: (name: string) => void;
  showSuggestions: boolean;
  suggestions: DiscogsArtist[];
  onSelectSuggestion: (artist: DiscogsArtist) => void;
}

export function ArtistSearchBar({
  containerRef,
  query,
  onQueryChange,
  onFocus,
  loading,
  searchDisabled,
  onSearch,
  dropdownOpen,
  itemCount,
  activeIndex,
  onActiveIndexChange,
  onResetActiveIndex,
  onClose,
  onSelectIndex,
  showHistory,
  history,
  onPickArtist,
  showSuggestions,
  suggestions,
  onSelectSuggestion,
}: ArtistSearchBarProps) {
  return (
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
          value={query}
          onChange={onQueryChange}
          onFocus={onFocus}
          dropdownOpen={dropdownOpen}
          itemCount={itemCount}
          activeIndex={activeIndex}
          onActiveIndexChange={onActiveIndexChange}
          onSelectIndex={onSelectIndex}
          onSubmit={onPickArtist}
          onClose={onClose}
          placeholder="Oscar Mulero"
          className="flex-1 bg-transparent text-[16px] sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none min-w-0"
          style={{ caretColor: "var(--td-accent)" }}
        />

        {loading && (
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
          onClick={onSearch}
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

      {showHistory && history.length > 0 && (
        <NavigableList
          items={history}
          activeIndex={activeIndex}
          onHover={onActiveIndexChange}
          onLeave={onResetActiveIndex}
          onSelect={(i) => onPickArtist(history[i]!)}
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

      {showSuggestions && suggestions.length > 0 && (
        <NavigableList
          items={suggestions}
          activeIndex={activeIndex}
          onHover={onActiveIndexChange}
          onLeave={onResetActiveIndex}
          onSelect={(i) => onSelectSuggestion(suggestions[i]!)}
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
  );
}
