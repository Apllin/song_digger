import { NextRequest } from "next/server";
import { z } from "zod";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

const Schema = z.object({
  labelId: z.coerce.number().int().positive().max(1_000_000_000),
  page: z.coerce.number().int().positive().max(1000).default(1),
  perPage: z.coerce.number().int().positive().max(200).default(100),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = Schema.safeParse({
    labelId: searchParams.get("labelId"),
    page: searchParams.get("page") ?? undefined,
    perPage: searchParams.get("perPage") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { labelId, page, perPage } = parsed.data;

  const res = await fetch(
    `${PYTHON_SERVICE_URL}/discogs/label/${labelId}/releases?page=${page}&per_page=${perPage}`
  );
  if (!res.ok) return Response.json({ error: "upstream error" }, { status: 502 });
  return Response.json(await res.json());
}
