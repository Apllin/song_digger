import { SOURCE_LABELS } from "@/features/player/constants";
import type { TrackSource } from "@/features/player/types";

interface PlayerTrackInfoProps {
  title: string;
  artist: string;
  source: TrackSource | null;
  resolving: boolean;
}

export function PlayerTrackInfo({ title, artist, source, resolving }: PlayerTrackInfoProps) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-medium text-td-fg truncate">{title}</p>
      <p className="text-caption text-td-fg-m truncate">
        {artist}
        <span className="ml-2" style={{ color: "var(--td-fg-m)" }}>
          · {resolving ? "Finding playable source…" : (source !== null ? (SOURCE_LABELS[source] ?? source) : "No playback available")}
        </span>
      </p>
    </div>
  );
}
