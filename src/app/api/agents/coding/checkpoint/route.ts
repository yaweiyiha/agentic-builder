import { NextResponse } from "next/server";
import {
  readSessionCheckpoint,
  clearSessionCheckpoint,
} from "@/lib/pipeline/session-checkpoint";

export async function GET() {
  const checkpoint = await readSessionCheckpoint(process.cwd());
  return NextResponse.json({ checkpoint: checkpoint ?? null });
}

/** Called when a fresh full coding run starts, to clear stale retry state. */
export async function DELETE() {
  await clearSessionCheckpoint(process.cwd());
  return NextResponse.json({ ok: true });
}
