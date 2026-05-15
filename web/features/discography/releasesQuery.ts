import { queryOptions } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import type { ReleasesQuery } from "@/features/discography/schemas";
import { api } from "@/lib/hono/client";

type ReleasesQueryParams = Omit<ReleasesQuery, "artistId"> & { artistId: number };

export function releasesQueryOptions({ artistId, role, page, perPage, sort }: ReleasesQueryParams) {
  return queryOptions({
    queryKey: ["artist-releases", artistId, role, page, perPage, sort] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.discography.releases.$get(
          {
            query: {
              artistId: String(artistId),
              role,
              page: String(page),
              perPage: String(perPage),
              sort,
            },
          },
          { init: { signal } },
        ),
      ),
  });
}
