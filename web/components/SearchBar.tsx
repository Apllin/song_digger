"use client";

import { parseResponse } from "hono/client";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/hono/client";
import { useDebounce } from "@/lib/use-debounce";
import { useSearchHistory } from "@/lib/use-search-history";

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

/** Bold the part of `text` that matches `query` (case-insensitive). */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <span>{text}</span>;
  const lower = text.toLowerCase();
  const lowerQ = query.toLowerCase();
  const idx = lower.indexOf(lowerQ);
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <span className="text-td-fg font-semibold" style={{ color: "var(--td-accent)" }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </span>
  );
}

/** Detect whether a suggestion is "Artist - Track" or just an artist name. */
function isTrackSuggestion(s: string): boolean {
  return s.includes(" - ");
}

function SuggestionIcon({ isTrack }: { isTrack: boolean }) {
  if (isTrack) {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-zinc-600" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-zinc-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}

export function SearchBar({ value, onChange, onSubmit, loading }: SearchBarProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedValue = useDebounce(value, 280);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const justSubmittedRef = useRef(false);

  const { history, addToHistory } = useSearchHistory("search-history");

  // Determine what's visible in the dropdown
  const dropdownItems: { text: string; isHistory: boolean }[] = showHistory
    ? history.map((h) => ({ text: h, isHistory: true }))
    : suggestions.map((s) => ({ text: s, isHistory: false }));
  const dropdownVisible =
    !loading && ((showHistory && history.length > 0) || (showSuggestions && suggestions.length > 0));

  // Fetch suggestions — with AbortController to cancel stale requests
  useEffect(() => {
    if (debouncedValue.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    parseResponse(api.suggestions.$get({ query: { q: debouncedValue } }, { init: { signal: abortRef.current.signal } }))
      .then((data) => {
        if (justSubmittedRef.current) return;
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
        setShowHistory(false);
        setActiveIndex(-1);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setSuggestions([]);
      });

    return () => abortRef.current?.abort();
  }, [debouncedValue]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownVisible) {
      if (e.key === "Enter" && !loading) {
        justSubmittedRef.current = true;
        abortRef.current?.abort();
        addToHistory(value);
        onSubmit();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, dropdownItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Pick actively-navigated item, or auto-pick the first suggestion when
      // it contains the typed query (i.e. it's the bolded highlighted match).
      let pickIndex = activeIndex;
      if (pickIndex < 0 && !showHistory && dropdownItems.length > 0) {
        const trimmed = value.trim().toLowerCase();
        if (trimmed && dropdownItems[0]!.text.toLowerCase().includes(trimmed)) {
          pickIndex = 0;
        }
      }
      if (pickIndex >= 0) {
        const item = dropdownItems[pickIndex]!;
        justSubmittedRef.current = true;
        abortRef.current?.abort();
        setSuggestions([]);
        onChange(item.text);
        setShowSuggestions(false);
        setShowHistory(false);
        setActiveIndex(-1);
        addToHistory(item.text);
        if (!loading) {
          setTimeout(() => onSubmit(), 0);
        }
      } else {
        justSubmittedRef.current = true;
        abortRef.current?.abort();
        setSuggestions([]);
        setShowSuggestions(false);
        setShowHistory(false);
        addToHistory(value);
        if (!loading) onSubmit();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setShowHistory(false);
    }
  };

  const handleSubmitClick = () => {
    justSubmittedRef.current = true;
    setSuggestions([]);
    setShowSuggestions(false);
    setShowHistory(false);
    setActiveIndex(-1);
    abortRef.current?.abort();
    addToHistory(value);
    onSubmit();
  };

  return (
    <div className="w-full relative z-30">
      <div
        className="relative flex items-center gap-2.5 sm:gap-4 px-3 py-3 sm:px-5 sm:py-4 rounded-[14px] sm:rounded-[18px]"
        style={{
          background: "rgba(14, 16, 28, 0.78)",
          border: "2px solid rgba(255, 255, 255, 0.55)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.10), 0 20px 60px rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
        }}
        ref={containerRef}
      >
        <SearchGlyph />

        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              justSubmittedRef.current = false;
              onChange(e.target.value);
              if (e.target.value.length >= 2) {
                setShowHistory(false);
              } else if (e.target.value.length === 0) {
                setShowSuggestions(false);
              }
            }}
            onFocus={() => {
              if (value.length < 2 && history.length > 0) {
                setShowHistory(true);
              } else if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ignez - A Love Dream"
            className="w-full bg-transparent text-[16px] sm:text-[20px] tracking-tight text-td-fg placeholder:text-td-fg-m focus:outline-none disabled:opacity-60 min-w-0"
            style={{ caretColor: "var(--td-accent)" }}
            disabled={loading}
          />

          {value && !loading && (
            <button
              onClick={() => {
                onChange("");
                setSuggestions([]);
                setShowSuggestions(false);
                setShowHistory(history.length > 0);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-td-fg-m hover:text-td-fg transition-colors"
              aria-label="Clear"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={handleSubmitClick}
          disabled={loading || !value.trim()}
          className="shrink-0 px-4 py-2.5 sm:px-8 sm:py-3.5 rounded-xl sm:rounded-2xl text-[13px] sm:text-[16px] font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "var(--td-fg)",
            color: "var(--td-bg)",
            boxShadow: "0 0 24px rgba(255, 255, 255, 0.18)",
          }}
        >
          {loading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            "Explore"
          )}
        </button>

        {/* Dropdown: history or suggestions */}
        {dropdownVisible && (
          <ul
            className="absolute z-50 top-full mt-2 left-0 right-0 rounded-2xl overflow-hidden shadow-2xl border backdrop-blur"
            style={{
              background: "rgba(20,18,26,0.92)",
              borderColor: "var(--td-hair-2)",
            }}
          >
            {showHistory && history.length > 0 && (
              <li className="px-5 py-2 font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg-m">
                Recent searches
              </li>
            )}
            {dropdownItems.map((item, i) => (
              <li key={item.text + i}>
                <button
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(-1)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    justSubmittedRef.current = true;
                    abortRef.current?.abort();
                    setSuggestions([]);
                    onChange(item.text);
                    setShowSuggestions(false);
                    setShowHistory(false);
                    setActiveIndex(-1);
                    addToHistory(item.text);
                    setTimeout(() => onSubmit(), 0);
                  }}
                  className="w-full flex items-center gap-3 text-left px-5 py-3 text-sm transition-colors"
                  style={{
                    background: i === activeIndex ? "rgba(255, 255, 255, 0.10)" : "transparent",
                    color: i === activeIndex ? "var(--td-fg)" : "var(--td-fg-d)",
                  }}
                >
                  {item.isHistory ? <ClockIcon /> : <SuggestionIcon isTrack={isTrackSuggestion(item.text)} />}
                  <HighlightMatch text={item.text} query={value} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
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
  );
}
