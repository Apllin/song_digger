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
import { onPlaylistEndAtom, playerAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";
import { api } from "@/lib/hono/client";

export type ExtenderRelease = {
  id: string;
  type: string | null;
  artist: string | null;
  thumb: string | null;
};

export type UseAlbumPlaylistExtenderArgs = {
  fallbackArtist: string;
  totalPages: number;
  currentPage: number;
  setPage: (page: number) => void;
  getCachedReleases: (page: number) => ExtenderRelease[] | undefined;
  fetchReleasesPage: (page: number) => Promise<ExtenderRelease[]>;
};

// Registers an onPlaylistEnd handler that chains album-by-album when the
// player finishes the last track of one release. The reverse-walk to locate
// the player's current release runs only when the handler fires (once per
// album end), not on every render.
export function useAlbumPlaylistExtender({
  fallbackArtist,
  totalPages,
  currentPage,
  setPage,
  getCachedReleases,
  fetchReleasesPage,
}: UseAlbumPlaylistExtenderArgs): void {
  const qc = useQueryClient();
  const setEndHandler = useSetAtom(onPlaylistEndAtom);
  const setOpenMap = useSetAtom(discographyOpenAtom);
  const { playlist: playerPlaylist, playingIndex: playerPlayingIndex } = useAtomValue(playerAtom);

  // Auto-expand the accordion of the release whose track is currently playing.
  useEffect(() => {
    if (playerPlayingIndex === null) return;
    const active = playerPlaylist[playerPlayingIndex];
    if (!active) return;
    const rid = releaseIdFromTrackId(active.id);
    if (!rid) return;
    setOpenMap((prev) => (prev[rid] ? prev : { ...prev, [rid]: true }));
  }, [playerPlaylist, playerPlayingIndex, setOpenMap]);

  // Detect whether the player is currently playing any discography track.
  const hasPlayerTracks = playerPlaylist.some((t) => releaseIdFromTrackId(t.id) !== null);

  useEffect(() => {
    if (!hasPlayerTracks || totalPages === 0) {
      setEndHandler(null);
      return;
    }

    const fetchTracksFor = async (release: ExtenderRelease): Promise<PlayerTrack[]> => {
      const items = await qc.fetchQuery({
        queryKey: tracklistQueryKey(release),
        queryFn: () =>
          parseResponse(
            api.discography.tracklist.$get({
              query: { releaseId: release.id, type: tracklistTypeOf(release) },
            }),
          ),
        staleTime: Infinity,
      });
      const fallback = release.artist?.trim() || fallbackArtist;
      return items.map((item, i) => toPlayerTrack(item, i, release, fallback));
    };

    setEndHandler({
      onEnd: (appendAndAdvance) => {
        // Reverse-walk runs here — once per album end — not on every render.
        const playerReleaseIds = new Set(
          playerPlaylist.map((t) => releaseIdFromTrackId(t.id)).filter((x): x is string => x !== null),
        );

        let pos: { page: number; idxInPage: number } | null = null;
        outer: for (let page = totalPages; page >= 1; page--) {
          const cached = getCachedReleases(page);
          if (!cached) continue;
          for (let i = cached.length - 1; i >= 0; i--) {
            if (playerReleaseIds.has(cached[i]!.id)) {
              pos = { page, idxInPage: i };
              break outer;
            }
          }
        }
        if (!pos) return;

        const releasesOnPage = getCachedReleases(pos.page) ?? [];

        void (async () => {
          let nextRelease: ExtenderRelease;
          let nextPage = pos.page;

          if (pos.idxInPage < releasesOnPage.length - 1) {
            nextRelease = releasesOnPage[pos.idxInPage + 1]!;
          } else if (pos.page < totalPages) {
            nextPage = pos.page + 1;
            const nextPageReleases = await fetchReleasesPage(nextPage);
            const first = nextPageReleases[0];
            if (!first) return;
            nextRelease = first;
            if (nextPage > currentPage) setPage(nextPage);
          } else {
            setEndHandler(null);
            return;
          }

          const tracks = await fetchTracksFor(nextRelease);
          appendAndAdvance(tracks);
        })();
      },
    });

    return () => setEndHandler(null);
  }, [
    hasPlayerTracks,
    totalPages,
    currentPage,
    setPage,
    fallbackArtist,
    qc,
    setEndHandler,
    getCachedReleases,
    fetchReleasesPage,
    playerPlaylist,
  ]);
}
