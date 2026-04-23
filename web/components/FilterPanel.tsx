"use client";

const CAMELOT_KEYS = [
  "1A","2A","3A","4A","5A","6A","7A","8A","9A","10A","11A","12A",
  "1B","2B","3B","4B","5B","6B","7B","8B","9B","10B","11B","12B",
];

const GENRES = [
  "techno",
  "dark-techno",
  "dub-techno",
  "industrial-techno",
  "ambient-techno",
  "minimal-techno",
];

export interface Filters {
  bpmMin: string;
  bpmMax: string;
  key: string;
  genre: string;
}

interface FilterPanelProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}

export const DEFAULT_FILTERS: Filters = {
  bpmMin: "",
  bpmMax: "",
  key: "",
  genre: "",
};

export function FilterPanel({ filters, onChange, onReset }: FilterPanelProps) {
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: value });

  const hasActive = Object.values(filters).some((v) => v !== "");

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* BPM Range */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-500 uppercase tracking-wide">BPM</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            placeholder="120"
            value={filters.bpmMin}
            onChange={(e) => set("bpmMin", e.target.value)}
            className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
          <span className="text-zinc-600 text-xs">–</span>
          <input
            type="number"
            placeholder="140"
            value={filters.bpmMax}
            onChange={(e) => set("bpmMax", e.target.value)}
            className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {/* Key (Camelot) */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Key</label>
        <select
          value={filters.key}
          onChange={(e) => set("key", e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        >
          <option value="">Any</option>
          {CAMELOT_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {/* Genre */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Genre</label>
        <select
          value={filters.genre}
          onChange={(e) => set("genre", e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
        >
          <option value="">Any techno</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* Reset */}
      {hasActive && (
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg transition-colors"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
