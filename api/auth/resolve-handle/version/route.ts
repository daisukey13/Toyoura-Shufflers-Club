// app/api/version/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_GITHUB_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      null,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    generatedAt: new Date().toISOString(),
  });
}

