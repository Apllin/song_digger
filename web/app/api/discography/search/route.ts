import { NextRequest } from "next/server";
import { z } from "zod";

import { gateAnonymousRequest } from "@/lib/anonymous-counter";
import { auth } from "@/lib/auth";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

const QuerySchema = z.string().trim().min(1).max(200);

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return Response.json([], { status: 400 });
  const q = parsed.data;

  const session = await auth();
  if (!session?.user) {
    const gate = await gateAnonymousRequest();
    if (!gate.ok) {
      return Response.json({ error: "ANONYMOUS_LIMIT_REACHED" }, { status: 429 });
    }
  }

  const res = await fetch(`${PYTHON_SERVICE_URL}/discogs/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) return Response.json([], { status: 502 });
  return Response.json(await res.json());
}
