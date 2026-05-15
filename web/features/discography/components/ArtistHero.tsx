import { ReleaseTagLegend } from "./ReleaseTagLegend";

import type { ReleaseRoleFilter } from "@/features/discography/schemas";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface ArtistHeroProps {
  selectedArtist: DiscogsArtist;
  totalItems: number;
  loadingReleases: boolean;
  roleFilter: ReleaseRoleFilter;
  onRoleFilterChange: (filter: ReleaseRoleFilter) => void;
}

export function ArtistHero({
  selectedArtist,
  totalItems,
  loadingReleases,
  roleFilter,
  onRoleFilterChange,
}: ArtistHeroProps) {
  return (
    <div
      className="relative flex flex-row items-center gap-3 sm:gap-5 p-4 sm:p-5 rounded-[18px] border"
      style={{
        background: "rgba(0, 0, 0, 0.30)",
        borderColor: "rgba(255, 255, 255, 0.20)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(0,0,0,0.55)",
      }}
    >
      <div className="absolute inset-0 rounded-[18px] overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(40% 80% at 80% 50%, var(--td-accent-soft), transparent 60%)",
            opacity: 0.6,
          }}
        />
      </div>

      <div className="relative flex items-center gap-4 sm:gap-5 flex-1 min-w-0">
        <div
          className="w-[64px] h-[64px] sm:w-[88px] sm:h-[88px] rounded-full flex items-center justify-center shrink-0 relative overflow-hidden"
          style={{
            background: "conic-gradient(from 30deg, #1a1620, #3a3140, #2a2530, #1a1620)",
            border: "1px solid var(--td-hair-2)",
            boxShadow: "0 0 30px var(--td-accent-soft)",
          }}
        >
          {selectedArtist.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedArtist.imageUrl}
              alt={selectedArtist.name}
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
            {selectedArtist.name}
          </h2>
          {!loadingReleases && totalItems > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono-td text-[12px] text-td-fg-d">
                {totalItems} release{totalItems !== 1 ? "s" : ""}
              </span>
              <ReleaseTagLegend />
            </div>
          )}
        </div>
      </div>

      <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
        {(["Main", "all"] as const).map((f) => {
          const active = roleFilter === f;
          return (
            <button
              key={f}
              onClick={() => onRoleFilterChange(f)}
              className="px-3 py-1.5 text-[11px] rounded-full transition-colors whitespace-nowrap"
              style={{
                border: `1px solid ${active ? "var(--td-accent)" : "rgba(255, 255, 255, 0.22)"}`,
                color: active ? "var(--td-accent)" : "var(--td-fg-d)",
                background: active ? "var(--td-accent-soft)" : "rgba(0, 0, 0, 0.30)",
              }}
            >
              {f === "Main" ? "Main releases" : "All"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
