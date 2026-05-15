import { NextResponse } from "next/server";
import { resolveHumanDecision } from "@/lib/pipeline/human-decision";

/**
 * POST /api/agents/coding/decide
 *
 * Resolves a pending human-in-the-loop decision for an active
 * integration_verify_fix session.
 *
 * Body: { sessionId: string; decisionId: string }
 * - sessionId: the coding session that is waiting for input
 * - decisionId: one of the option ids from INTEGRATION_DECISION_OPTIONS
 *
 * Returns 200 { ok: true } on success, 404 when no pending decision exists
 * (e.g. already timed out or the session ended).
 */
export async function POST(req: Request) {
  let body: { sessionId?: string; decisionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, decisionId } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }
  if (!decisionId || typeof decisionId !== "string") {
    return NextResponse.json(
      { error: "decisionId is required" },
      { status: 400 },
    );
  }

  const resolved = resolveHumanDecision(sessionId, decisionId);
  if (!resolved) {
    return NextResponse.json(
      {
        error:
          "No pending decision found for this session. It may have already timed out or the session has ended.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
