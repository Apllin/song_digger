"use client";

import { useSession } from "next-auth/react";

export function useUserId(): string | null {
  const { data: session } = useSession();
  return session?.user?.id ?? null;
}
