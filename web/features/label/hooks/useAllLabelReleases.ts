"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/lib/hono/client";
import type { LabelRelease } from "@/lib/python-api/generated/types/LabelRelease";

function fetchPage(labelId: number, page: number, signal: AbortSignal) {
  return parseResponse(
    api.discography.label.releases.$get(
      {
        query: {
          labelId: String(labelId),
          page: String(page),
          perPage: "100",
        },
      },
      { init: { signal } },
    ),
  );
}

async function fetchAllLabelReleases(labelId: number, signal: AbortSignal): Promise<LabelRelease[]> {
  const first = await fetchPage(labelId, 1, signal);
  const releases = [...first.releases];
  const totalPages = first.pagination.pages;

  if (totalPages > 1) {
    const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(labelId, i + 2, signal)));
    for (const p of rest) releases.push(...p.releases);
  }

  const seen = new Set<number>();
  return releases.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export function useAllLabelReleases(labelId: number | undefined) {
  const {
    data: releases = [],
    isPending,
    isFetching,
  } = useQuery({
    queryKey: ["label-releases", labelId],
    queryFn: ({ signal }) => fetchAllLabelReleases(labelId!, signal),
    enabled: labelId != null,
  });
  const loadingReleases = labelId != null && (isPending || isFetching);
  return { releases, loadingReleases };
}
