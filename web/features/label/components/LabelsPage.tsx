"use client";

import { useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useLabelReleases } from "../hooks/useLabelReleases";
import { LabelHero } from "./LabelHero";
import { LabelReleaseGrid } from "./LabelReleaseGrid";
import { LabelsHero } from "./LabelsHero";
import { PopularLabels } from "./PopularLabels";

import { EntitySearchBar } from "@/components/EntitySearchBar";
import { Pagination } from "@/components/Pagination";
import { Spinner } from "@/components/Spinner";
import { type ExtenderRelease, useAlbumPlaylistExtender } from "@/features/discography/hooks/useAlbumPlaylistExtender";
import { labelsAtom } from "@/lib/atoms/labels";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";
import type { LabelRelease } from "@/lib/python-api/generated/types/LabelRelease";
import { useEntitySearch } from "@/lib/useEntitySearch";

const PAGE_SIZE = 15;

function toExtenderRelease(r: LabelRelease): ExtenderRelease {
  return {
    id: String(r.id),
    type: r.type ?? null,
    artist: r.artist ?? null,
    thumb: r.thumb ?? null,
  };
}

export function LabelsPage() {
  const defaultLabel = useSearchParams().get("label") ?? undefined;
  const [s, setS] = useAtom(labelsAtom);

  const search = useEntitySearch<DiscogsLabel>({
    historyKey: "labels-history",
    queryKeyPrefix: "label-suggestions",
    fetchFn: (q, signal) => fetchApi(api.discography.label.search.$get({ query: { q } }, { init: { signal } })),
    defaultValue: defaultLabel,
    onSelect: () => setS((prev) => ({ ...prev, page: 1 })),
  });

  const labelId = search.selectedItem?.id;
  const { releases, totalItems, totalPages, loadingReleases } = useLabelReleases(labelId, s.page, PAGE_SIZE);

  const qc = useQueryClient();
  const releasesQueryKey = useCallback(
    (page: number) => ["label-releases", labelId, page, PAGE_SIZE] as const,
    [labelId],
  );
  const getCachedReleases = useCallback(
    (page: number) =>
      qc.getQueryData<{ releases: LabelRelease[] }>(releasesQueryKey(page))?.releases.map(toExtenderRelease),
    [qc, releasesQueryKey],
  );
  const fetchReleasesPage = useCallback(
    async (page: number) => {
      if (labelId == null) return [];
      const data = await qc.fetchQuery({
        queryKey: releasesQueryKey(page),
        queryFn: ({ signal }) =>
          parseResponse(
            api.discography.label.releases.$get(
              {
                query: { labelId: String(labelId), page: String(page), perPage: String(PAGE_SIZE) },
              },
              { init: { signal } },
            ),
          ),
      });
      return data.releases.map(toExtenderRelease);
    },
    [labelId, qc, releasesQueryKey],
  );

  const setPage = useCallback((p: number) => setS((prev) => ({ ...prev, page: p })), [setS]);

  useAlbumPlaylistExtender({
    fallbackArtist: "Various",
    totalPages,
    currentPage: s.page,
    setPage,
    getCachedReleases,
    fetchReleasesPage,
  });

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        <LabelsHero />

        <PopularLabels selectedLabelName={search.selectedItem?.name} onSelect={search.pickItem} />

        <EntitySearchBar search={search} placeholder="Tresor" suggestionImageClassName="rounded" />

        {search.selectedItem && (
          <div className="flex flex-col gap-5">
            <LabelHero selectedLabel={search.selectedItem} totalItems={totalItems} loadingReleases={loadingReleases} />

            {loadingReleases && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}

            {!loadingReleases && totalItems === 0 && (
              <p className="text-sm text-td-fg-m text-center py-10">No releases found</p>
            )}

            {releases.length > 0 && <LabelReleaseGrid releases={releases} />}

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
