// app/api/matches/probe/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/matches/probe",
    timestamp: new Date().toISOString(),
    vercel: {
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    },
  });
}
