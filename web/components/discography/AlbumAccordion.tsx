"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { TrackRow } from "./TrackRow";

import { discographyOpenAtom } from "@/features/discography/atoms";
import { usePlayer } from "@/features/player/hooks/usePlayer";
import type { PlayerTrack } from "@/features/player/types";
import { api } from "@/lib/hono/client";
import type { ArtistRelease } from "@/lib/python-api/generated/types/ArtistRelease";
import type { TracklistItem } from "@/lib/python-api/generated/types/TracklistItem";

interface AlbumAccordionProps {
  release: ArtistRelease;
  artistName: string;
}

function toPlayerTrack(t: TracklistItem, i: number, artistName: string, coverUrl?: string | null): PlayerTrack {
  return {
    id: `discography-${i}-${t.title}`,
    title: t.title,
    artist: t.artists.length > 0 ? t.artists.join(", ") : artistName,
    source: "discography",
    sourceUrl: "",
    coverUrl: coverUrl ?? null,
  };
}

export function AlbumAccordion({ release, artistName }: AlbumAccordionProps) {
  const [openMap, setOpenMap] = useAtom(discographyOpenAtom);
  const open = openMap[release.id] ?? false;

  const releaseType = release.type === "master" ? "master" : "release";
  const {
    data: tracks = [],
    isFetching,
    isFetched,
  } = useQuery({
    queryKey: ["tracklist", release.id, releaseType],
    queryFn: () =>
      parseResponse(
        api.discography.tracklist.$get({
          query: { releaseId: String(release.id), type: releaseType },
        }),
      ),
    enabled: open,
    staleTime: Infinity,
  });

  const { track: currentTrack, play } = usePlayer();

  function handleToggle() {
    setOpenMap((prev) => ({ ...prev, [release.id]: !open }));
  }

  const playerTracks = tracks.map((t, i) => toPlayerTrack(t, i, artistName, release.thumb));

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
        className="w-full flex items-center gap-4 p-3 transition-colors text-left hover:bg-white/3"
      >
        {/* Cover */}
        <div
          className="w-14 h-14 rounded-[10px] shrink-0 overflow-hidden"
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
          {isFetching && (
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
          {!isFetching && isFetched && tracks.length === 0 && (
            <p className="text-xs text-td-fg-m py-4 text-center">No tracks found</p>
          )}
          {playerTracks.map((pt, i) => (
            <TrackRow
              key={`${tracks[i]!.position}-${i}`}
              track={{ ...tracks[i]!, albumArtist: artistName, albumCover: release.thumb ?? null }}
              isPlaying={currentTrack?.title === pt.title && currentTrack?.artist === pt.artist}
              onPlay={() => play(pt, playerTracks, i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
