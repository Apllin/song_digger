"use client";

import { useState } from "react";
import { TrackRow } from "./TrackRow";

interface Track {
  position: string;
  title: string;
  duration: string;
  artists: string[];
}

interface Release {
  id: number;
  title: string;
  year?: number;
  type: string;
  format?: string;
  label?: string;
  thumb?: string;
}

interface AlbumAccordionProps {
  release: Release;
  artistName: string;
}

export function AlbumAccordion({ release, artistName }: AlbumAccordionProps) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (loaded) return;

    setLoading(true);
    try {
      const releaseType = release.type === "master" ? "master" : "release";
      const res = await fetch(
        `/api/discography/tracklist?releaseId=${release.id}&type=${releaseType}`
      );
      const data: Track[] = await res.json();
      setTracks(data);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-zinc-800/40 transition-colors text-left"
      >
        {/* Cover */}
        <div className="w-12 h-12 rounded-lg bg-zinc-800 shrink-0 overflow-hidden">
          {release.thumb ? (
            <img src={release.thumb} alt={release.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{release.title}</p>
          <div className="flex gap-2 mt-0.5 flex-wrap">
            {release.year && (
              <span className="text-xs text-zinc-500">{release.year}</span>
            )}
            {release.format && (
              <span className="text-xs text-zinc-600">{release.format}</span>
            )}
            {release.label && (
              <span className="text-xs text-zinc-600">{release.label}</span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-2 py-2 flex flex-col gap-0.5">
          {loading && (
            <div className="flex items-center justify-center py-6 text-zinc-600">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          )}
          {!loading && tracks.length === 0 && loaded && (
            <p className="text-xs text-zinc-600 py-4 text-center">No tracks found</p>
          )}
          {tracks.map((t, i) => (
            <TrackRow
              key={`${t.position}-${i}`}
              track={{ ...t, albumArtist: artistName, albumCover: release.thumb ?? null }}
              isPlaying={playingIndex === i}
              onPlayToggle={() => setPlayingIndex(playingIndex === i ? null : i)}
              onPrev={i > 0 ? () => setPlayingIndex(i - 1) : undefined}
              onNext={i < tracks.length - 1 ? () => setPlayingIndex(i + 1) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
