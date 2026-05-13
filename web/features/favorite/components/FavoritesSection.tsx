"use client";

import Link from "next/link";

import { useFavoritesFlow } from "@/features/favorite/hooks/useFavorites";
import { ResultsGrid } from "@/features/search/components/ResultsGrid";

const favoritesLabel = (n: number) => `${n} saved track${n === 1 ? "" : "s"}`;

export function FavoritesSection() {
  const { userId, sessionStatus, page, setPage, data, isLoading, isFetchingPage, totalPages } = useFavoritesFlow();
  const tracks = data?.tracks ?? [];
  const totalItems = data?.pagination.items ?? 0;

  if (sessionStatus === "loading" || isLoading) {
    return (
      <div className="flex justify-center py-20">
        <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-td-fg-m">
        <p className="text-sm">
          <Link href="/login" className="text-td-accent underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see your favorites.
        </p>
      </div>
    );
  }

  if (totalItems === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-td-fg-m">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
          />
        </svg>
        <p className="text-sm">No favorites yet. Tap the heart on a track to save it here.</p>
      </div>
    );
  }

  return (
    <ResultsGrid
      tracks={tracks}
      page={page}
      totalPages={totalPages}
      totalItems={totalItems}
      isLoading={isFetchingPage}
      summaryLabel={favoritesLabel}
      onPrev={() => setPage((p) => Math.max(1, p - 1))}
      onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
    />
  );
}
