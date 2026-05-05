import { NextRequest } from "next/server";
import { z } from "zod";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

const ParamSchema = z.string().trim().min(1).max(500);

export async function GET(req: NextRequest) {
  const artist = ParamSchema.safeParse(
    req.nextUrl.searchParams.get("artist") ?? "",
  );
  const title = ParamSchema.safeParse(
    req.nextUrl.searchParams.get("title") ?? "",
  );
  if (!artist.success || !title.success) {
    return Response.json({ found: false }, { status: 400 });
  }

  try {
    const url = new URL(`${PYTHON_SERVICE_URL}/play-lookup`);
    url.searchParams.set("artist", artist.data);
    url.searchParams.set("title", title.data);
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return Response.json({ found: false });
    return Response.json(await res.json());
  } catch {
    return Response.json({ found: false });
  }
}
