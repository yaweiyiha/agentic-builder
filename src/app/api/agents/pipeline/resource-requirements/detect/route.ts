import { NextRequest, NextResponse } from "next/server";
import { ResourceDetectorAgent } from "@/lib/agents/kickoff/resource-detector-agent";
import {
  mergeDetectedRequirements,
  readResourceRequirements,
  writeResourceRequirements,
} from "@/lib/pipeline/resource-requirements";

export const runtime = "nodejs";
export const maxDuration = 120;

function projectRoot() {
  return process.cwd();
}

export async function POST(request: NextRequest) {
  let body: {
    prd?: string;
    trd?: string;
    sysdesign?: string;
    implguide?: string;
    sessionId?: string;
  };
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Invalid JSON body: ${err.message}`
            : "Invalid JSON body.",
      },
      { status: 400 },
    );
  }

  const prd = body.prd?.trim();
  if (!prd) {
    return NextResponse.json(
      { error: "Missing `prd` content." },
      { status: 400 },
    );
  }

  const agent = new ResourceDetectorAgent();
  let detection;
  try {
    detection = await agent.detect(
      {
        prd,
        trd: body.trd,
        sysDesign: body.sysdesign,
        implGuide: body.implguide,
      },
      body.sessionId,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Resource detection failed.",
      },
      { status: 500 },
    );
  }

  const existing = await readResourceRequirements(projectRoot());
  const merged = mergeDetectedRequirements(existing, detection.requirements);
  await writeResourceRequirements(projectRoot(), merged);

  return NextResponse.json({
    requirements: merged,
    parseError: detection.parseError,
    model: detection.model,
    costUsd: detection.costUsd,
    durationMs: detection.durationMs,
  });
}
