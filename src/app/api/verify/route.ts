import { NextRequest, NextResponse } from "next/server";
import { VerifierAgent } from "@/lib/agents";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prdContent, designContent } = body as {
      prdContent: string;
      designContent: string;
    };

    if (!prdContent || !designContent) {
      return NextResponse.json(
        { error: "Both prdContent and designContent are required" },
        { status: 400 }
      );
    }

    const verifier = new VerifierAgent();
    const result = await verifier.verifyAlignment(prdContent, designContent);

    return NextResponse.json({
      verification: result.content,
      model: result.model,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      usage: result.usage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
