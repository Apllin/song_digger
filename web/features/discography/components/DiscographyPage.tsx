"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { type ExtenderRelease, useAlbumPlaylistExtender } from "../hooks/useAlbumPlaylistExtender";
import { useAllArtistReleases } from "../hooks/useAllArtistReleases";
import { ArtistHero } from "./ArtistHero";
import { DiscographyHero } from "./DiscographyHero";
import { ReleaseTimeline } from "./ReleaseTimeline";

import { EntitySearchBar } from "@/components/EntitySearchBar";
import { Pagination } from "@/components/Pagination";
import { Spinner } from "@/components/Spinner";
import { releasesQueryOptions } from "@/features/discography/releasesQuery";
import { ArtistIdSchema } from "@/features/discography/schemas";
import { discographyAtom } from "@/lib/atoms/discography";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";
import { useEntitySearch } from "@/lib/useEntitySearch";

const PAGE_SIZE = 15;

export function DiscographyPage() {
  const defaultArtist = useSearchParams().get("artist") ?? undefined;
  const [s, setS] = useAtom(discographyAtom);
  const qc = useQueryClient();

  // Inline fetchFn/onSelect would get fresh identities every render, making
  // useEntitySearch's pickItem unstable and re-firing its defaultValue effect
  // on every history setState → infinite "Maximum update depth exceeded".
  const fetchSuggestions = useCallback(
    (q: string, signal: AbortSignal) => fetchApi(api.discography.search.$get({ query: { q } }, { init: { signal } })),
    [],
  );
  const handleArtistSelect = useCallback(() => setS((prev) => ({ ...prev, page: 1 })), [setS]);
  const setQuery = useCallback((q: string) => setS((prev) => ({ ...prev, query: q })), [setS]);
  const setSelectedItem = useCallback(
    (item: DiscogsArtist | null) => {
      const artistId = item ? ArtistIdSchema.parse(String(item.id)) : null;
      setS((prev) => ({ ...prev, selectedArtistId: artistId }));
      if (artistId) qc.setQueryData(["artist", artistId], item);
    },
    [setS, qc],
  );

  const { data: fetchedArtist } = useQuery<DiscogsArtist>({
    queryKey: ["artist", s.selectedArtistId],
    queryFn: ({ signal }) =>
      fetchApi(api.discography.artists[":id"].$get({ param: { id: s.selectedArtistId! } }, { init: { signal } })),
    enabled: s.selectedArtistId != null,
    staleTime: Infinity,
  });

  const selectedItem: DiscogsArtist | null =
    fetchedArtist ?? (s.selectedArtistId ? { id: Number(s.selectedArtistId), name: s.query, imageUrl: null } : null);

  const search = useEntitySearch<DiscogsArtist>({
    historyKey: "discography-history",
    queryKeyPrefix: "artist-suggestions",
    fetchFn: fetchSuggestions,
    defaultValue: defaultArtist,
    onSelect: handleArtistSelect,
    externalState: { query: s.query, setQuery, selectedItem, setSelectedItem },
  });

  const sort = "year_desc";
  const artistId = search.selectedItem?.id;

  const { releases, totalItems, totalPages, loadingReleases } = useAllArtistReleases({
    artistId,
    role: s.roleFilter,
    page: s.page,
    perPage: PAGE_SIZE,
    sort,
  });

  const getCachedReleases = useCallback(
    (page: number) => {
      if (artistId == null) return undefined;
      return qc.getQueryData<{ releases: ExtenderRelease[] }>(
        releasesQueryOptions({ artistId, role: s.roleFilter, page, perPage: PAGE_SIZE, sort }).queryKey,
      )?.releases;
    },
    [qc, artistId, s.roleFilter, sort],
  );
  const fetchReleasesPage = useCallback(
    async (page: number) => {
      if (artistId == null) return [];
      const data = await qc.fetchQuery(
        releasesQueryOptions({ artistId, role: s.roleFilter, page, perPage: PAGE_SIZE, sort }),
      );
      return data.releases;
    },
    [artistId, s.roleFilter, qc, sort],
  );

  const setPage = useCallback((p: number) => setS((prev) => ({ ...prev, page: p })), [setS]);

  useAlbumPlaylistExtender({
    fallbackArtist: search.selectedItem?.name ?? "",
    totalPages,
    currentPage: s.page,
    setPage,
    getCachedReleases,
    fetchReleasesPage,
  });

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        <DiscographyHero />

        <EntitySearchBar search={search} placeholder="Oscar Mulero" />

        {search.selectedItem && (
          <div className="flex flex-col gap-5">
            <ArtistHero
              selectedArtist={search.selectedItem}
              totalItems={totalItems}
              loadingReleases={loadingReleases}
              roleFilter={s.roleFilter}
              onRoleFilterChange={(f) => setS((prev) => ({ ...prev, roleFilter: f, page: 1 }))}
            />

            {loadingReleases && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}

            {!loadingReleases && totalItems === 0 && (
              <p className="text-sm text-td-fg-m text-center py-10">No releases found</p>
            )}

            {releases.length > 0 && <ReleaseTimeline releases={releases} artistName={search.selectedItem.name} />}

            {totalPages > 1 && (
              <Pagination
                page={s.page}
                totalPages={totalPages}
                onPrev={() => setS((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                onNext={() => setS((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
