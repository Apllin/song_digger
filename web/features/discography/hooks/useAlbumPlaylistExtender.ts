"use client";

import { useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { discographyOpenAtom } from "@/features/discography/atoms";
import {
  releaseIdFromTrackId,
  toPlayerTrack,
  tracklistQueryKey,
  tracklistTypeOf,
} from "@/features/discography/playerTracks";
import { playerAtom, playlistExtenderAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";
import { api } from "@/lib/hono/client";

export interface ExtenderRelease {
  id: string;
  type: string | null;
  artist: string | null;
  thumb: string | null;
}

interface Args {
  fallbackArtist: string;
  totalPages: number;
  currentPage: number;
  setPage: (page: number) => void;
  getCachedReleases: (page: number) => ExtenderRelease[] | undefined;
  fetchReleasesPage: (page: number) => Promise<ExtenderRelease[]>;
}

interface PlayerPosition {
  page: number;
  idxInPage: number;
  release: ExtenderRelease;
}

// Registers a PlaylistExtender that chains album-by-album when the player
// finishes the last track of one release. Mirrors `useSearchFlow`'s pattern
// for search pagination — the cursor tracks the *player*'s last release, not
// the UI's currentPage, so navigating the UI ahead of playback never makes
// the player skip releases.
export function useAlbumPlaylistExtender({
  fallbackArtist,
  totalPages,
  currentPage,
  setPage,
  getCachedReleases,
  fetchReleasesPage,
}: Args): void {
  const qc = useQueryClient();
  const setExtender = useSetAtom(playlistExtenderAtom);
  const setOpenMap = useSetAtom(discographyOpenAtom);
  const { playlist: playerPlaylist, playingIndex: playerPlayingIndex } = useAtomValue(playerAtom);

  // Auto-expand the accordion of the release whose track is currently playing.
  // Without this, the extender silently advances to the next album and the
  // user has no visual cue which release they're now hearing.
  useEffect(() => {
    if (playerPlayingIndex === null) return;
    const active = playerPlaylist[playerPlayingIndex];
    if (!active) return;
    const rid = releaseIdFromTrackId(active.id);
    if (!rid) return;
    setOpenMap((prev) => (prev[rid] ? prev : { ...prev, [rid]: true }));
  }, [playerPlaylist, playerPlayingIndex, setOpenMap]);

  useEffect(() => {
    // Collect release IDs whose tracks currently live in the player's playlist.
    const playerReleaseIds = new Set<string>();
    for (const t of playerPlaylist) {
      const rid = releaseIdFromTrackId(t.id);
      if (rid) playerReleaseIds.add(rid);
    }

    // Walk paged release caches from the back to find the latest release the
    // player has stepped into. We can only check pages whose data is already
    // cached — the user has either visited them via pagination or the extender
    // has fetched them on a prior `loadMore`.
    let playerPosition: PlayerPosition | null = null;
    if (playerReleaseIds.size > 0 && totalPages > 0) {
      outer: for (let page = totalPages; page >= 1; page--) {
        const cached = getCachedReleases(page);
        if (!cached) continue;
        for (let i = cached.length - 1; i >= 0; i--) {
          const r = cached[i]!;
          if (playerReleaseIds.has(r.id)) {
            playerPosition = { page, idxInPage: i, release: r };
            break outer;
          }
        }
      }
    }

    if (!playerPosition) {
      setExtender(null);
      return;
    }

    const releasesOnPage = getCachedReleases(playerPosition.page) ?? [];
    const hasMoreOnPage = playerPosition.idxInPage < releasesOnPage.length - 1;
    const hasMoreOnLaterPage = playerPosition.page < totalPages;

    if (!hasMoreOnPage && !hasMoreOnLaterPage) {
      setExtender(null);
      return;
    }

    const fetchTracksFor = async (release: ExtenderRelease): Promise<PlayerTrack[]> => {
      const items = await qc.fetchQuery({
        queryKey: tracklistQueryKey(release),
        queryFn: () =>
          parseResponse(
            api.discography.tracklist.$get({
              query: { releaseId: String(release.id), type: tracklistTypeOf(release) },
            }),
          ),
        staleTime: Infinity,
      });
      const fallback = release.artist?.trim() || fallbackArtist;
      return items.map((item, i) => toPlayerTrack(item, i, release, fallback));
    };

    setExtender({
      hasMore: true,
      loadMore: async () => {
        if (hasMoreOnPage) {
          const next = releasesOnPage[playerPosition.idxInPage + 1]!;
          return fetchTracksFor(next);
        }
        const nextPage = playerPosition.page + 1;
        const nextReleases = await fetchReleasesPage(nextPage);
        const first = nextReleases[0];
        if (!first) return [];
        const tracks = await fetchTracksFor(first);
        // Pull the UI page along only when the player has caught up — yanking
        // a user who paginated ahead is more disorienting than helpful.
        if (nextPage > currentPage) setPage(nextPage);
        return tracks;
      },
    });

    return () => setExtender(null);
  }, [
    playerPlaylist,
    totalPages,
    currentPage,
    setPage,
    fallbackArtist,
    qc,
    setExtender,
    getCachedReleases,
    fetchReleasesPage,
  ]);
}
