"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";
import { useInputList } from "@/lib/useInputList";

export type SearchableEntity = { id: number; name: string; imageUrl?: string | null };

interface UseEntitySearchOptions<T extends SearchableEntity> {
  historyKey: string;
  queryKeyPrefix: string;
  fetchFn: (q: string, signal: AbortSignal) => Promise<T[]>;
  defaultValue?: string;
  onSelect?: (item: T) => void;
}

export function useEntitySearch<T extends SearchableEntity>({
  historyKey,
  queryKeyPrefix,
  fetchFn,
  defaultValue,
  onSelect,
}: UseEntitySearchOptions<T>) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [picking, setPicking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 300);
  const { history, addToHistory } = useSearchHistory(historyKey);
  const { activeIndex, setActiveIndex, resetActiveIndex } = useInputList();

  const queryKey = useCallback((q: string) => [queryKeyPrefix, q] as const, [queryKeyPrefix]);

  const suggestionsQuery = useQuery({
    queryKey: queryKey(debouncedQuery),
    queryFn: ({ signal }) => fetchFn(debouncedQuery, signal),
    enabled: debouncedQuery.length >= 2 && !selectedItem,
    staleTime: 60_000,
  });
  const suggestions = useMemo<T[]>(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);

  useEffect(() => {
    if (!suggestionsQuery.data || suggestionsQuery.data.length === 0) return;
    setShowSuggestions(true);
  }, [suggestionsQuery.data]);

  const selectItem = useCallback(
    (item: T) => {
      resetActiveIndex();
      setSelectedItem(item);
      setQuery(item.name);
      setShowSuggestions(false);
      setShowHistory(false);
      onSelect?.(item);
    },
    [resetActiveIndex, onSelect],
  );

  // Cache-hit resolves synchronously. Cache-miss dedups with autocomplete via shared queryKey.
  const pickItem = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length < 2) return;

      addToHistory(trimmed);
      setShowHistory(false);
      setShowSuggestions(false);

      const cached = qc.getQueryData<T[]>(queryKey(trimmed));
      if (cached?.length) {
        const pick = pickFromList(cached, trimmed);
        if (pick) selectItem(pick);
        return;
      }

      setPicking(true);
      try {
        const data = await qc.fetchQuery({
          queryKey: queryKey(trimmed),
          queryFn: ({ signal }) => fetchFn(trimmed, signal),
          staleTime: 60_000,
        });
        if (data?.length) {
          const pick = pickFromList(data, trimmed);
          if (pick) selectItem(pick);
        }
      } catch {
        // network/api errors handled by callApi
      } finally {
        setPicking(false);
      }
    },
    [addToHistory, fetchFn, qc, selectItem, queryKey],
  );

  useEffect(() => {
    if (defaultValue) {
      pickItem(defaultValue);
    }
  }, [defaultValue, pickItem]);

  // Close suggestions on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const inHistory = showHistory && history.length > 0;
  const inSuggestions = showSuggestions && suggestions.length > 0;
  const dropdownOpen = inHistory || inSuggestions;
  const itemCount = inHistory ? history.length : suggestions.length;

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedItem(null);
    if (value.length === 0) {
      setShowSuggestions(false);
    } else {
      setShowHistory(false);
    }
  }, []);

  const handleInputFocus = useCallback(() => {
    if (query.length < 2 && history.length > 0) {
      setShowHistory(true);
    } else if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [query.length, history.length, suggestions.length]);

  const handleSelectIndex = useCallback(
    (index: number) => {
      if (inHistory) pickItem(history[index]!);
      else selectItem(suggestions[index]!);
    },
    [inHistory, history, suggestions, pickItem, selectItem],
  );

  const handleClose = useCallback(() => {
    resetActiveIndex();
    setShowSuggestions(false);
    setShowHistory(false);
  }, [resetActiveIndex]);

  const handleSearch = useCallback(() => {
    handleClose();
    if (query.trim()) pickItem(query.trim());
  }, [handleClose, pickItem, query]);

  const loadingItems = picking || suggestionsQuery.isFetching;
  const searchDisabled =
    !query.trim() ||
    picking ||
    (selectedItem != null && query.trim().toLowerCase() === selectedItem.name.toLowerCase());

  return {
    query,
    selectedItem,
    containerRef,
    suggestions,
    history,
    showHistory: inHistory,
    showSuggestions: inSuggestions,
    dropdownOpen,
    itemCount,
    activeIndex,
    loadingItems,
    searchDisabled,
    handleQueryChange,
    handleInputFocus,
    handleSearch,
    handleClose,
    handleSelectIndex,
    setActiveIndex,
    resetActiveIndex,
    pickItem,
    selectItem,
  };
}

export type EntitySearchResult<T extends SearchableEntity> = ReturnType<typeof useEntitySearch<T>>;

function pickFromList<T extends SearchableEntity>(list: T[], trimmed: string): T | undefined {
  const exact = list.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  return exact ?? list[0];
}
