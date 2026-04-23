import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length < 2) return Response.json([]);

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
