"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/lib/hono/client";

// One page per request. Python materializes the full sorted list on first
// call and caches it for 30 days; every subsequent page request against the
// same label is a cheap slice from `ExternalApiCache`. React Query caches
// each (labelId, page) tuple separately so Prev/Next within a session is
// instant after the first visit to each page.
export function useLabelReleases(labelId: number | undefined, page: number, perPage: number) {
  const query = useQuery({
    queryKey: ["label-releases", labelId, page, perPage] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.label.releases.$get(
          {
            query: {
              labelId: String(labelId),
              page: String(page),
              perPage: String(perPage),
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: labelId != null,
  });

  return {
    releases: query.data?.releases ?? [],
    totalPages: query.data?.pagination.pages ?? 0,
    totalItems: query.data?.pagination.items ?? 0,
    loadingReleases: labelId != null && (query.isPending || query.isFetching),
  };
}
