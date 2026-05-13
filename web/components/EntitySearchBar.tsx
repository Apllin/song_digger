import { NavigableInput } from "@/components/NavigableInput";
import { NavigableList } from "@/components/NavigableList";
import { Spinner } from "@/components/Spinner";
import type { EntitySearchResult, SearchableEntity } from "@/lib/useEntitySearch";

interface EntitySearchBarProps<T extends SearchableEntity> {
  search: EntitySearchResult<T>;
  placeholder: string;
  /** Class applied to suggestion thumbnails. Defaults to rounded-full (circle). */
  suggestionImageClassName?: string;
}

export function EntitySearchBar<T extends SearchableEntity>({
  search,
  placeholder,
  suggestionImageClassName = "rounded-full",
}: EntitySearchBarProps<T>) {
  const {
    containerRef,
    query,
    handleQueryChange,
    handleInputFocus,
    loadingItems,
    searchDisabled,
    handleSearch,
    dropdownOpen,
    itemCount,
    activeIndex,
    setActiveIndex,
    resetActiveIndex,
    handleClose,
    handleSelectIndex,
    showHistory,
    history,
    pickItem,
    showSuggestions,
    suggestions,
    selectItem,
  } = search;

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
          onChange={handleQueryChange}
          onFocus={handleInputFocus}
          dropdownOpen={dropdownOpen}
          itemCount={itemCount}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onSelectIndex={handleSelectIndex}
          onSubmit={pickItem}
          onClose={handleClose}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-body sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none min-w-0"
          style={{ caretColor: "var(--td-accent)" }}
        />

        {loadingItems && <Spinner className="w-5 h-5 shrink-0" />}

        <button
          onClick={handleSearch}
          disabled={searchDisabled}
          className="shrink-0 px-4 py-2.5 sm:px-8 sm:py-3.5 rounded-xl sm:rounded-2xl text-[13px] sm:text-body font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
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
          onHover={setActiveIndex}
          onLeave={resetActiveIndex}
          onSelect={(i) => pickItem(history[i]!)}
          keyExtractor={(h) => h}
          header="Recent searches"
          renderItem={(h) => (
            <>
              <ClockIcon />
              {h}
            </>
          )}
        />
      )}

      {showSuggestions && suggestions.length > 0 && (
        <NavigableList
          items={suggestions}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onLeave={resetActiveIndex}
          onSelect={(i) => selectItem(suggestions[i]!)}
          keyExtractor={(item) => String(item.id)}
          renderItem={(item) => (
            <>
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className={`w-6 h-6 ${suggestionImageClassName} object-cover`}
                />
              )}
              {item.name}
            </>
          )}
        />
      )}
    </div>
  );
}

function ClockIcon() {
  return (
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
  );
}
