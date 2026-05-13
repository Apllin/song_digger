import { AlbumAccordion } from "@/components/discography/AlbumAccordion";
import type { LabelRelease } from "@/lib/python-api/generated/types/LabelRelease";

interface LabelReleaseGridProps {
  releases: LabelRelease[];
}

export function LabelReleaseGrid({ releases }: LabelReleaseGridProps) {
  return (
    <div className="flex flex-col gap-2">
      {releases.map((r) => (
        <AlbumAccordion
          key={r.id}
          release={{
            id: String(r.id),
            title: r.title,
            artist: r.artist ?? null,
            year: r.year ?? null,
            type: r.type ?? null,
            role: null,
            format: r.format ?? null,
            label: r.catno && r.catno !== "none" ? r.catno : null,
            thumb: r.thumb ?? null,
            resourceUrl: null,
          }}
          artistName={r.artist ?? "Various"}
        />
      ))}
    </div>
  );
}
