import fs from "fs/promises";
import path from "path";
import type { PipelineStepId, StepResult } from "@/lib/pipeline/types";

interface PipelineSnapshot {
  savedAt: string;
  featureBrief: string;
  codeOutputDir: string;
  totalCostUsd: number;
  steps: Record<PipelineStepId, StepResult | null>;
}

export async function GET() {
  const snapshotPath = path.resolve(
    process.cwd(),
    ".blueprint",
    "pipeline-snapshot.json",
  );

  try {
    const raw = await fs.readFile(snapshotPath, "utf-8");
    const snapshot: PipelineSnapshot = JSON.parse(raw);
    return Response.json({ snapshot });
  } catch {
    return Response.json(
      { error: "No pipeline snapshot found. Run the pipeline first." },
      { status: 404 },
    );
  }
}
