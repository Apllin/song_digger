import { Suspense } from "react";

import { SearchSection } from "@/features/search/components/SearchSection";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const initialQuery = q ?? "";
  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(40px, 8.5vw, 108px)",
              lineHeight: 0.85,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            <span className="block">Find your next</span>
            <span className="block">favourite track</span>
          </h1>
        </div>
        <Suspense>
          <SearchSection initialQuery={initialQuery} />
        </Suspense>
      </div>
    </div>
  );
}
