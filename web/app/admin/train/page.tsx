import { redirect } from "next/navigation";

import { TrainPanel } from "@/features/admin/components/TrainPanel";
import { countLabeledSamples, loadLatestModel } from "@/features/admin/server/loadLatestModel";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getCurrentUser();
  if (!session?.id) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { role: true },
  });
  if (user?.role !== "TRAINER") {
    return (
      <div className="min-h-screen text-td-fg flex items-center justify-center">
        <p className="text-td-fg-m">Trainer role required.</p>
      </div>
    );
  }

  const [latest, labeledCount] = await Promise.all([loadLatestModel(), countLabeledSamples()]);

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-4xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28">
        <h1
          className="font-display text-td-fg m-0 mb-6"
          style={{
            fontSize: "clamp(28px, 5vw, 56px)",
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            fontWeight: 600,
          }}
        >
          Train ranking model
        </h1>
        <TrainPanel latest={latest} labeledCount={labeledCount} />
      </div>
    </div>
  );
}
