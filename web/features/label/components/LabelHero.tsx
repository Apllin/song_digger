import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";

interface LabelHeroProps {
  selectedLabel: DiscogsLabel;
  totalItems: number;
  loadingReleases: boolean;
}

export function LabelHero({ selectedLabel, totalItems, loadingReleases }: LabelHeroProps) {
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
          className="w-[64px] h-[64px] sm:w-[88px] sm:h-[88px] rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
          style={{
            background: "conic-gradient(from 30deg, #1a1620, #3a3140, #2a2530, #1a1620)",
            border: "1px solid var(--td-hair-2)",
            boxShadow: "0 0 30px var(--td-accent-soft)",
          }}
        >
          {selectedLabel.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedLabel.imageUrl}
              alt={selectedLabel.name}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "var(--td-bg)", border: "1px solid var(--td-hair-2)" }}
            >
              <div className="w-[7px] h-[7px] rounded-full" style={{ background: "var(--td-accent)" }} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-accent">Label</div>
          <h2 className="font-display text-[22px] sm:text-[32px] md:text-[40px] font-normal leading-[1.05] m-0 mt-1 break-words">
            {selectedLabel.name}
          </h2>
          {!loadingReleases && totalItems > 0 && (
            <span className="font-mono-td text-[12px] text-td-fg-d">
              {totalItems} release{totalItems !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
