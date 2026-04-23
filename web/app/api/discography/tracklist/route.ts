import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const releaseId = searchParams.get("releaseId");
  const releaseType = searchParams.get("type") ?? "release";

  if (!releaseId) return Response.json({ error: "releaseId required" }, { status: 400 });

  const res = await fetch(
    `${PYTHON_SERVICE_URL}/discogs/release/${releaseId}/tracklist?release_type=${releaseType}`
  );
  if (!res.ok) return Response.json([], { status: 502 });
  return Response.json(await res.json());
}
