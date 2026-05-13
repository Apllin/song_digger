import { Suspense } from "react";

import { DiscographyPage } from "@/features/discography/components/DiscographyPage";

export default function Page() {
  return (
    <Suspense>
      <DiscographyPage />
    </Suspense>
  );
}
