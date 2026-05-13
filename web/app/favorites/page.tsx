import { Suspense } from "react";

import { FavoritesSection } from "@/features/favorite/components/FavoritesSection";

export default function Page() {
  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(34px, 6.5vw, 84px)",
              lineHeight: 0.9,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            Favorites
          </h1>
          <p className="mt-4 text-subheading sm:text-[20px] font-semibold text-td-fg">The tracks you saved</p>
        </div>
        <Suspense>
          <FavoritesSection />
        </Suspense>
      </div>
    </div>
  );
}
