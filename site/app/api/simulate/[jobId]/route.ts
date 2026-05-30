import { NextResponse } from "next/server";
import { pollSimulation, simWorkerConfigured } from "@/lib/sim-client";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  if (!simWorkerConfigured()) {
    return NextResponse.json(
      { error: "Simulation worker not configured.", configured: false },
      { status: 503 },
    );
  }
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  }
  try {
    const job = await pollSimulation(jobId);
    return NextResponse.json(job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "poll failed";
    const status = msg === "job not found" ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
