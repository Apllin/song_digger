"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/lib/hono/client";

// The Python service owns dedup + role filter + year sort and returns the full
// list for an artist (optionally filtered by role). Web just paginates locally.
export function useAllArtistReleases(artistId: number | undefined, roleFilter: "main" | "all") {
  const role = roleFilter === "main" ? ("Main" as const) : undefined;
  const { data, isPending, isFetching } = useQuery({
    queryKey: ["artist-releases-all", artistId, role ?? "all"],
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.releases.$get(
          {
            query: {
              artistId: String(artistId!),
              ...(role ? { role } : {}),
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: artistId != null,
  });

  return {
    releases: data?.releases ?? [],
    loadingReleases: artistId != null && (isPending || isFetching),
  };
}
