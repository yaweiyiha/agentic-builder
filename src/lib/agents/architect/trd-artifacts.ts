/**
 * Parse fenced code blocks emitted by TRDAgent into named artifacts.
 *
 * The TRD prompt requires the model to append, after the human-readable
 * Markdown sections, structured artifacts as fenced code blocks tagged
 * `file:<path>`. We only recognise two paths today:
 *
 *   ```typescript file:shared/schema.ts          → schemaTs
 *   ```yaml file:business-rules.dsl.yaml         → rulesYaml
 *
 * Anything else with a `file:` header is recorded as `unknown` so a
 * mistyped path surfaces in the dashboard rather than disappearing.
 *
 * Same parser shape as worker codegen's parseFileOutputRobust — pure
 * function, never throws, returns empty fields when the input is missing
 * the expected blocks.
 */

export interface TrdArtifactMalformed {
  path: string;
  reason: string;
}

export interface TrdArtifactUnknown {
  path: string;
  body: string;
}

export interface TrdArtifacts {
  /** Contents of the `shared/schema.ts` block, if present. */
  schemaTs?: string;
  /** Contents of the `business-rules.dsl.yaml` block, if present. */
  rulesYaml?: string;
  /** Blocks whose header was malformed or that never closed. */
  malformed: TrdArtifactMalformed[];
  /** Blocks with a recognisable header but unrecognised path. */
  unknown: TrdArtifactUnknown[];
}

const HEADER = /^\s*(`{3,})\s*(?:[A-Za-z0-9_+-]+\s+)?file:(\S+?)\s*$/;

export function extractTrdArtifacts(content: string): TrdArtifacts {
  const out: TrdArtifacts = { malformed: [], unknown: [] };
  if (!content) return out;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = HEADER.exec(line);
    if (!m) continue;

    const fence = m[1]!;
    const rawPath = m[2]!;
    const filePath = rawPath.trim();
    const headerLine = i + 1;

    if (!filePath) {
      out.malformed.push({ path: rawPath, reason: `empty path at line ${headerLine}` });
      continue;
    }

    const closer = findMatchingFence(lines, i + 1, fence);
    if (closer < 0) {
      out.malformed.push({
        path: filePath,
        reason: `unclosed fence opened at line ${headerLine}`,
      });
      break;
    }

    const body = lines.slice(i + 1, closer).join("\n");
    if (filePath === "shared/schema.ts") {
      out.schemaTs = body;
    } else if (filePath === "business-rules.dsl.yaml") {
      out.rulesYaml = body;
    } else {
      out.unknown.push({ path: filePath, body });
    }

    i = closer;
  }

  return out;
}

function findMatchingFence(
  lines: string[],
  fromIdx: number,
  fence: string,
): number {
  for (let i = fromIdx; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === fence) return i;
  }
  return -1;
}
