"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { TrackRow } from "./TrackRow";

import { useUserId } from "@/features/auth/hooks/useUserId";
import { discographyOpenAtom } from "@/features/discography/atoms";
import {
  toPlayerTrack as toDiscographyPlayerTrack,
  tracklistQueryKey,
  tracklistTypeOf,
} from "@/features/discography/playerTracks";
import type { DiscographyRelease } from "@/features/discography/types";
import { useFavoriteSourceUrls, useToggleFavoriteBySource } from "@/features/favorite/hooks/useFavorites";
import { usePlayer } from "@/features/player/hooks/usePlayer";
import { api } from "@/lib/hono/client";

const DISCOGRAPHY_FAVORITE_SOURCE = "discogs";

function discographySourceUrl(releaseId: number | string, position: string, title: string): string {
  return `discogs:release/${releaseId}/${encodeURIComponent(position || "_")}/${encodeURIComponent(title)}`;
}

interface AlbumAccordionProps {
  release: DiscographyRelease;
  artistName: string;
}

// Discogs gives us `role` (Main / Remix / Producer / Appearance / TrackAppearance)
// and a free-form `format` string ("5xFile, FLAC, EP, 24-", "11xFile, WAV, Album",
// "12\"", …). Appearance and TrackAppearance both mean "the artist's content sits
// on someone else's release" — collapsed into "Featured". For Main / null role we
// pick the first format keyword; if nothing matches (e.g. bare "12\"" vinyl tag),
// fall back to "Release" so every card has a tag.
function releaseTag(release: { role?: string | null; format?: string | null }): string {
  const role = release.role;
  if (role && role !== "Main") {
    if (role === "Appearance" || role === "TrackAppearance") return "Featured";
    return role;
  }
  const fmt = release.format ?? "";
  if (/\bEP\b/i.test(fmt)) return "EP";
  if (/\bAlbum\b/i.test(fmt)) return "Album";
  if (/\bMixed\b/i.test(fmt)) return "Mix";
  if (/\bSingle\b/i.test(fmt)) return "Single";
  if (/\bCompilation\b/i.test(fmt)) return "Compilation";
  return "Release";
}

export function AlbumAccordion({ release, artistName }: AlbumAccordionProps) {
  const [openMap, setOpenMap] = useAtom(discographyOpenAtom);
  const open = openMap[release.id] ?? false;

  const {
    data: tracks = [],
    isFetching,
    isFetched,
  } = useQuery({
    queryKey: tracklistQueryKey(release),
    queryFn: () =>
      parseResponse(
        api.discography.tracklist.$get({
          query: { releaseId: String(release.id), type: tracklistTypeOf(release) },
        }),
      ),
    enabled: open,
    staleTime: Infinity,
  });

  const { track: currentTrack, play } = usePlayer();

  const userId = useUserId();
  const favoriteUrls = useFavoriteSourceUrls(userId);
  const { mutate: toggleFavorite } = useToggleFavoriteBySource(userId);

  function handleToggle() {
    setOpenMap((prev) => ({ ...prev, [release.id]: !open }));
  }

  // Discogs only attaches per-track `artists` when the performer differs from
  // the release's headline artist, so an empty list means "the release artist".
  // For Remix/Appearance releases that headline artist is *not* the artist the
  // user searched for — fall back to the release artist, not `artistName`.
  const fallbackArtist = release.artist?.trim() || artistName;
  const playerTracks = tracks.map((t, i) => toDiscographyPlayerTrack(t, i, release, fallbackArtist));
  const tag = releaseTag(release);

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
          <div className="flex items-center gap-3 mt-1 font-mono-td text-[12px] text-td-fg-d flex-wrap">
            {release.year && <span>{release.year}</span>}
            <span
              className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] rounded-md border"
              style={{
                borderColor: "var(--td-hair-2)",
                background: "var(--td-accent-soft)",
                color: "var(--td-accent)",
              }}
            >
              {tag}
            </span>
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
          {playerTracks.map((pt, i) => {
            const t = tracks[i]!;
            const sourceUrl = discographySourceUrl(release.id, t.position, t.title);
            const isFav = favoriteUrls.has(sourceUrl);
            return (
              <TrackRow
                key={`${t.position}-${i}`}
                track={{ ...t, albumArtist: fallbackArtist, albumCover: release.thumb ?? null }}
                isPlaying={currentTrack?.title === pt.title && currentTrack?.artist === pt.artist}
                onPlay={() => play(pt, playerTracks, i)}
                isFavorite={isFav}
                onFavoriteToggle={
                  userId
                    ? () =>
                        toggleFavorite({
                          source: DISCOGRAPHY_FAVORITE_SOURCE,
                          sourceUrl,
                          title: t.title,
                          artist: pt.artist,
                          coverUrl: release.thumb ?? null,
                          isFav,
                        })
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
