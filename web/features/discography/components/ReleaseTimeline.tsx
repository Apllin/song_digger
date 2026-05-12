import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import type { DiscographyRelease } from "@/features/discography/types";

interface ReleaseTimelineProps {
  releases: DiscographyRelease[];
  artistName: string;
}

export function ReleaseTimeline({ releases, artistName }: ReleaseTimelineProps) {
  return (
    <div className="relative">
      <div
        className="absolute top-6 bottom-6 w-px pointer-events-none"
        style={{ left: "52px", background: "var(--td-hair-2)" }}
      />
      <div className="flex flex-col gap-2">
        {releases.map((r, i) => {
          const prevYear = i > 0 ? releases[i - 1]!.year : undefined;
          const showYear = i === 0 || prevYear !== r.year;
          return (
            <div key={r.id} className="flex items-start relative gap-6">
              <div
                className="w-[36px] shrink-0 pt-[34px] text-right font-mono-td text-[11px] uppercase tracking-[0.14em]"
                style={{ color: "var(--td-accent)" }}
              >
                {showYear && (r.year ?? "—")}
              </div>
              <div
                className="absolute rounded-full"
                style={{
                  top: showYear ? "35px" : "37px",
                  left: showYear ? "47px" : "49px",
                  width: showYear ? "10px" : "6px",
                  height: showYear ? "10px" : "6px",
                  background: showYear ? "var(--td-accent)" : "var(--td-hair-2)",
                  boxShadow: showYear ? "0 0 12px var(--td-accent-soft)" : "none",
                  zIndex: 1,
                }}
              />
              <div className="flex-1 min-w-0">
                <AlbumAccordion release={r} artistName={artistName} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
