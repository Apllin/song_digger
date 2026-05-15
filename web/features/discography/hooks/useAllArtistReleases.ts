"use client";

import { useQuery } from "@tanstack/react-query";

import { releasesQueryOptions } from "@/features/discography/releasesQuery";
import type { ReleasesQuery } from "@/features/discography/schemas";

// artistId comes from the Discogs artist model (number), not from the query
// string, so we override its type here.
type Params = Omit<ReleasesQuery, "artistId"> & { artistId: number | undefined };

export function useAllArtistReleases({ artistId, role, page, perPage, sort }: Params) {
  const { data, isPending, isFetching } = useQuery({
    ...releasesQueryOptions({ artistId: artistId!, role, page, perPage, sort }),
    enabled: artistId != null,
  });

  return {
    releases: data?.releases ?? [],
    totalItems: data?.pagination.items ?? 0,
    totalPages: data?.pagination.pages ?? 1,
    loadingReleases: artistId != null && (isPending || isFetching),
  };
}
