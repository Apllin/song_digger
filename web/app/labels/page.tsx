import { Suspense } from "react";

import { LabelsPage } from "@/features/label/components/LabelsPage";

export default function Page() {
  return (
    <Suspense>
      <LabelsPage />
    </Suspense>
  );
}
