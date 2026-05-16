"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/lib/hono/client";

export function useLabelReleases(
  labelId: number | undefined,
  labelName: string | undefined,
  page: number,
  perPage: number,
) {
  const query = useQuery({
    queryKey: ["label-releases", labelId, labelName, page, perPage] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.label.releases.$get(
          {
            query: {
              labelId: String(labelId),
              labelName: String(labelName),
              page: String(page),
              perPage: String(perPage),
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: labelId != null && !!labelName,
  });

  return {
    releases: query.data?.releases ?? [],
    totalPages: query.data?.pagination.pages ?? 0,
    totalItems: query.data?.pagination.items ?? 0,
    loadingReleases: labelId != null && (query.isPending || query.isFetching),
  };
}
