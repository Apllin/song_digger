"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import type { ReleasesQuery } from "@/features/discography/schemas";
import { api } from "@/lib/hono/client";

// artistId comes from the Discogs artist model (number), not from the query
// string, so we override its type here.
type Params = Omit<ReleasesQuery, "artistId"> & { artistId: number | undefined };

export function useAllArtistReleases({ artistId, role, page, perPage, sort }: Params) {
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["artist-releases", artistId, role, page, perPage, sort] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.releases.$get(
          {
            query: {
              artistId: String(artistId!),
              role,
              page: String(page),
              perPage: String(perPage),
              sort,
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: artistId != null,
  });

  return {
    releases: data?.releases ?? [],
    totalItems: data?.pagination.items ?? 0,
    totalPages: data?.pagination.pages ?? 1,
    loadingReleases: artistId != null && (isPending || isFetching),
  };
}
