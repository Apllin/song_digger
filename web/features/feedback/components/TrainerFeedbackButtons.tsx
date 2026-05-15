"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

import { api } from "@/lib/hono/client";

interface TrainerFeedbackButtonsProps {
  searchQueryId: string;
  trackId: string;
}

export function TrainerFeedbackButtons({ searchQueryId, trackId }: TrainerFeedbackButtonsProps) {
  const { data: session } = useSession();
  const [voted, setVoted] = useState<boolean | null>(null);

  if (session?.user?.role !== "TRAINER") return null;

  async function submit(isSimilar: boolean) {
    setVoted(isSimilar);
    await api.feedback.similarity.$post({ json: { searchQueryId, trackId, isSimilar } });
  }

  return (
    <div className="flex gap-1 justify-center mt-1">
      <button
        onClick={() => submit(true)}
        title="Similar"
        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
          voted === true
            ? "bg-green-700 text-white"
            : "bg-td-card-bg text-td-fg-m hover:bg-green-900 hover:text-green-300"
        }`}
      >
        ✓ yes
      </button>
      <button
        onClick={() => submit(false)}
        title="Not similar"
        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
          voted === false ? "bg-red-700 text-white" : "bg-td-card-bg text-td-fg-m hover:bg-red-900 hover:text-red-300"
        }`}
      >
        ✗ no
      </button>
    </div>
  );
}
