import { healthCheck } from "@/lib/python-client";

export async function GET() {
  const pythonOk = await healthCheck();
  return Response.json({
    status: "ok",
    python_service: pythonOk ? "ok" : "unavailable",
  });
}
