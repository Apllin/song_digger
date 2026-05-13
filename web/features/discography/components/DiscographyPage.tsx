"use client";

import { useAtom } from "jotai";
import { useSearchParams } from "next/navigation";
import { useAllArtistReleases } from "../hooks/useAllArtistReleases";
import { ArtistHero } from "./ArtistHero";
import { DiscographyHero } from "./DiscographyHero";
import { ReleaseTimeline } from "./ReleaseTimeline";

import { EntitySearchBar } from "@/components/EntitySearchBar";
import { Pagination } from "@/components/Pagination";
import { Spinner } from "@/components/Spinner";
import { discographyAtom } from "@/lib/atoms/discography";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";
import { useEntitySearch } from "@/lib/useEntitySearch";

const PAGE_SIZE = 15;

export function DiscographyPage() {
  const defaultArtist = useSearchParams().get("artist") ?? undefined;
  const [s, setS] = useAtom(discographyAtom);

  const search = useEntitySearch<DiscogsArtist>({
    historyKey: "discography-history",
    queryKeyPrefix: "artist-suggestions",
    fetchFn: (q, signal) => fetchApi(api.discography.search.$get({ query: { q } }, { init: { signal } })),
    defaultValue: defaultArtist,
    onSelect: () => setS((prev) => ({ ...prev, page: 1 })),
  });

  const { releases, totalItems, totalPages, loadingReleases } = useAllArtistReleases({
    artistId: search.selectedItem?.id,
    role: s.roleFilter === "main" ? "Main" : "all",
    page: s.page,
    perPage: PAGE_SIZE,
    sort: "year_desc",
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
