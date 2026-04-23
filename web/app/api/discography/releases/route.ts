import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artistId = searchParams.get("artistId");
  const page = searchParams.get("page") ?? "1";
  const perPage = searchParams.get("perPage") ?? "100";

  if (!artistId) return Response.json({ error: "artistId required" }, { status: 400 });

  const res = await fetch(
    `${PYTHON_SERVICE_URL}/discogs/artist/${artistId}/releases?page=${page}&per_page=${perPage}`
  );
  if (!res.ok) return Response.json({ error: "upstream error" }, { status: 502 });
  return Response.json(await res.json());
}
