/**
 * Side-effecting helper that runs the TRD artifact pipeline end-to-end:
 * parse fenced blocks, write `shared-schema.ts` and `business-rules.dsl.yaml`
 * into a blueprint directory, validate the rules DSL.
 *
 * Lives separately from `trd-artifacts.ts` (pure parser) so the parser
 * stays I/O-free and trivially testable.
 *
 * Two callers in production:
 *   - src/lib/pipeline/engine.ts (legacy single-pipeline flow)
 *   - src/app/api/agents/parallel-generate/route.ts (pipeline-ui parallel
 *     doc generation flow)
 *
 * Both must invoke this so the artifacts land on disk regardless of which
 * orchestrator drives the TRD step. Best-effort: never throws, returns
 * structured data the caller can surface via SSE / step metadata.
 */

import fs from "fs/promises";
import path from "path";

import { extractTrdArtifacts, type TrdArtifacts } from "./trd-artifacts";
import {
  validateRulesDsl,
  type RulesDslValidation,
} from "./trd-rules-validator";
import {
  validateWorkflowDag,
  type DagValidation,
} from "./dag-validator";

export interface PersistedTrdArtifacts {
  /** Raw parser output — useful for surfacing malformed/unknown blocks. */
  artifacts: TrdArtifacts;
  /** Absolute paths actually written. Empty when no recognised blocks. */
  written: {
    schemaTs?: string;
    rulesYaml?: string;
    pipelineDagYaml?: string;
  };
  /** Result of running validateRulesDsl when rulesYaml was present. */
  rulesValidation?: RulesDslValidation;
  /** Result of running validateWorkflowDag when pipelineDagYaml was present. */
  dagValidation?: DagValidation;
}

export async function persistTrdArtifactsFromContent(
  content: string,
  blueprintDir: string,
): Promise<PersistedTrdArtifacts> {
  const artifacts = extractTrdArtifacts(content);
  await fs.mkdir(blueprintDir, { recursive: true });

  const written: PersistedTrdArtifacts["written"] = {};
  let rulesValidation: RulesDslValidation | undefined;
  let dagValidation: DagValidation | undefined;

  if (artifacts.schemaTs) {
    const p = path.join(blueprintDir, "shared-schema.ts");
    await fs.writeFile(p, artifacts.schemaTs, "utf8");
    written.schemaTs = p;
  }

  if (artifacts.rulesYaml) {
    const p = path.join(blueprintDir, "business-rules.dsl.yaml");
    await fs.writeFile(p, artifacts.rulesYaml, "utf8");
    written.rulesYaml = p;
    rulesValidation = validateRulesDsl(artifacts.rulesYaml);
  }

  if (artifacts.pipelineDagYaml) {
    const p = path.join(blueprintDir, "pipeline-dag.yaml");
    await fs.writeFile(p, artifacts.pipelineDagYaml, "utf8");
    written.pipelineDagYaml = p;
    dagValidation = validateWorkflowDag(artifacts.pipelineDagYaml, {
      trdMarkdown: content,
    });
  }

  return { artifacts, written, rulesValidation, dagValidation };
}
