import { NextRequest } from "next/server";
import { z } from "zod";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

const Schema = z.object({
  releaseId: z.coerce.number().int().positive().max(1_000_000_000),
  type: z.enum(["release", "master"]).default("release"),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = Schema.safeParse({
    releaseId: searchParams.get("releaseId"),
    type: searchParams.get("type") ?? undefined,
  });
  if (!parsed.success) return Response.json([], { status: 400 });
  const { releaseId, type } = parsed.data;

  const res = await fetch(
    `${PYTHON_SERVICE_URL}/discogs/release/${releaseId}/tracklist?release_type=${type}`
  );
  if (!res.ok) return Response.json([], { status: 502 });
  return Response.json(await res.json());
}
