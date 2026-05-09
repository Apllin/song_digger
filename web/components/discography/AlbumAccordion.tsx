"use client";

import { parseResponse } from "hono/client";
import { useState } from "react";
import { TrackRow } from "./TrackRow";

import { api } from "@/lib/hono/client";
import type { ArtistRelease } from "@/lib/python-api/generated/types/ArtistRelease";
import type { TracklistItem } from "@/lib/python-api/generated/types/TracklistItem";

interface AlbumAccordionProps {
  release: ArtistRelease;
  artistName: string;
}

export function AlbumAccordion({ release, artistName }: AlbumAccordionProps) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<TracklistItem[]>([]);
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
      const data = await parseResponse(
        api.discography.tracklist.$get({
          query: { releaseId: String(release.id), type: releaseType },
        }),
      );
      setTracks(data);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-[14px] overflow-hidden border"
      style={{
        background: "var(--td-card)",
        borderColor: "var(--td-hair)",
      }}
    >
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-4 p-3 transition-colors text-left hover:bg-white/[0.03]"
      >
        {/* Cover */}
        <div
          className="w-[56px] h-[56px] rounded-[10px] shrink-0 overflow-hidden"
          style={{ border: "1px solid var(--td-hair)" }}
        >
          {release.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={release.thumb} alt={release.title} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-td-fg-m"
              style={{
                background: "linear-gradient(135deg, rgba(185,163,232,0.10), rgba(180,120,80,0.06))",
              }}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium tracking-[-0.01em] text-td-fg truncate">{release.title}</p>
          <div className="flex gap-3 mt-1 font-mono-td text-[12px] text-td-fg-d flex-wrap">
            {release.year && <span>{release.year}</span>}
            {release.format && <span>{release.format}</span>}
            {release.label && <span style={{ color: "var(--td-fg-m)" }}>{release.label}</span>}
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--td-fg-m)" }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-2 py-2 flex flex-col gap-0.5 border-t" style={{ borderColor: "var(--td-hair)" }}>
          {loading && (
            <div className="flex items-center justify-center py-6">
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                style={{ color: "var(--td-accent)" }}
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          )}
          {!loading && tracks.length === 0 && loaded && (
            <p className="text-xs text-td-fg-m py-4 text-center">No tracks found</p>
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
