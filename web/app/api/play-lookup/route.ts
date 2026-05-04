import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get("artist") ?? "";
  const title = req.nextUrl.searchParams.get("title") ?? "";
  if (!artist || !title) {
    return Response.json({ found: false }, { status: 400 });
  }

  try {
    const url = new URL(`${PYTHON_SERVICE_URL}/play-lookup`);
    url.searchParams.set("artist", artist);
    url.searchParams.set("title", title);
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return Response.json({ found: false });
    return Response.json(await res.json());
  } catch {
    return Response.json({ found: false });
  }
}
