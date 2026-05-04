"use client";

const GENRES = [
  "techno",
  "dark-techno",
  "dub-techno",
  "industrial-techno",
  "ambient-techno",
  "minimal-techno",
];

export interface Filters {
  genre: string;
}

interface FilterPanelProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}

export const DEFAULT_FILTERS: Filters = {
  genre: "",
};

export function FilterPanel({ filters, onChange, onReset }: FilterPanelProps) {
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: value });

  const hasActive = Object.values(filters).some((v) => v !== "");

  return (
    <div className="flex flex-wrap gap-3 items-end">
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
