"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/lib/hono/client";

const PAGE_SIZE = 15;

export function useArtistReleases(artistId: number | undefined, page: number, roleFilter: "main" | "all") {
  const role = roleFilter === "main" ? ("Main" as const) : undefined;
  const { data, isPending } = useQuery({
    queryKey: ["artist-releases", artistId, page, role ?? "all"],
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.releases.$get(
          {
            query: {
              artistId: String(artistId!),
              page: String(page),
              perPage: String(PAGE_SIZE),
              ...(role ? { role } : {}),
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: artistId != null,
    placeholderData: keepPreviousData,
  });

  return {
    releases: data?.releases ?? [],
    totalItems: data?.pagination.items ?? 0,
    totalPages: data?.pagination.pages ?? 0,
    loadingReleases: artistId != null && isPending,
  };
}
