import { NextRequest } from "next/server";
import { z } from "zod";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

const QuerySchema = z.string().trim().min(2).max(200);

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return Response.json([]);
  const q = parsed.data;

  try {
    const res = await fetch(
      `${PYTHON_SERVICE_URL}/suggestions?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return Response.json([]);
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json([]);
  }
}
