import { NextRequest } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({}));
  if (!videoId) return Response.json({ error: "videoId required" }, { status: 400 });

  const res = await fetch(`${PYTHON_SERVICE_URL}/ytm/add-to-playlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });

  const data = await res.json();
  return Response.json(data, { status: res.ok ? 200 : res.status });
}

export async function GET() {
  const res = await fetch(`${PYTHON_SERVICE_URL}/ytm/playlist-status`);
  return Response.json(await res.json());
}
