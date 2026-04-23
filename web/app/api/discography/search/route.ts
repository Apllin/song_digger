import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q) return Response.json([], { status: 400 });

  const res = await fetch(
    `${PYTHON_SERVICE_URL}/discogs/search?q=${encodeURIComponent(q)}`
  );
  if (!res.ok) return Response.json([], { status: 502 });
  return Response.json(await res.json());
}
