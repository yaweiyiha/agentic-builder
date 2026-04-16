import fs from "fs/promises";
import path from "path";

const TOOL_TRANSCRIPT_MARKER = "## Tool Transcript";
const MAX_PENCIL_SUMMARY_CHARS = 12_000;

/**
 * PencilDesign.md is mostly MCP tool dumps. Codegen models attend to the summary
 * and layout hints at the top; the transcript dilutes the prompt and hides DesignSpec.
 */
export function preparePencilDesignForCodegen(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const idx = trimmed.indexOf(TOOL_TRANSCRIPT_MARKER);
  const withoutTranscript =
    idx >= 0 ? trimmed.slice(0, idx).trim() : trimmed;

  const note =
    idx >= 0
      ? "\n\n_(Full Pencil MCP tool transcript omitted from codegen context to reduce noise.)_"
      : "";

  const body = withoutTranscript + note;
  if (body.length <= MAX_PENCIL_SUMMARY_CHARS) return body;
  return `${body.slice(0, MAX_PENCIL_SUMMARY_CHARS)}\n\n[PencilDesign summary truncated for codegen]`;
}

/**
 * Vite serves `frontend/public/` at URL `/`. Exported PNGs must live under
 * `frontend/public/design/` so the app can use `src="/design/..."`.
 * Legacy path `generated-code/public/design/` is still listed if present.
 */
export async function buildPublicDesignAssetsBlock(
  outputRoot: string,
): Promise<string> {
  const dirs: Array<{ abs: string; urlPrefix: string }> = [
    {
      abs: path.join(outputRoot, "frontend", "public", "design"),
      urlPrefix: "/design",
    },
    {
      abs: path.join(outputRoot, "public", "design"),
      urlPrefix: "/design",
    },
  ];

  const seen = new Set<string>();
  const files: string[] = [];

  for (const { abs, urlPrefix } of dirs) {
    try {
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat?.isDirectory()) continue;

      async function walk(dir: string, prefix: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            await walk(full, rel);
          } else {
            const url = `${urlPrefix}/${rel.replace(/\\/g, "/")}`;
            if (!seen.has(url)) {
              seen.add(url);
              files.push(url);
            }
          }
        }
      }
      await walk(abs, "");
    } catch {
      /* skip */
    }
  }

  if (files.length === 0) return "";

  const lines = files.slice(0, 80).map((u) => `- \`${u}\``);
  const more =
    files.length > 80
      ? `\n- _…and ${files.length - 80} more file(s)_`
      : "";
  return [
    "## Design assets on disk (Pencil / exports)",
    "",
    "Vite serves `frontend/public/` at the site root. Use `src=\"/design/...\"` for files listed below.",
    "Match layout and visual hierarchy from **Design Specification** and any dimensions/colors stated above.",
    "",
    ...lines,
    more,
  ].join("\n");
}

/** Read Pencil markdown from root (canonical) or legacy nested paths. */
export async function readPencilDesignDoc(outputRoot: string): Promise<string> {
  const candidates = [
    "PencilDesign.md",
    path.join("frontend", "public", "design", "PencilDesign.md"),
    path.join("public", "design", "PencilDesign.md"),
  ];
  for (const rel of candidates) {
    try {
      const raw = await fs.readFile(path.join(outputRoot, rel), "utf-8");
      if (raw.trim()) return raw;
    } catch {
      /* try next */
    }
  }
  return "";
}

/**
 * Single place to assemble what the supervisor passes as `frontendDesignContext`:
 * DesignSpec + cleaned Pencil summary + optional public/design file list.
 */
export async function buildFrontendDesignContextForCodegen(
  outputRoot: string,
  designSpecDoc: string,
  pencilDesignRaw: string,
): Promise<string> {
  const pencil = preparePencilDesignForCodegen(pencilDesignRaw);
  const assets = await buildPublicDesignAssetsBlock(outputRoot);
  return [
    designSpecDoc.trim()
      ? `## Design Specification\n\n${designSpecDoc}`
      : "",
    pencil ? `## Pencil design (implementation summary)\n\n${pencil}` : "",
    assets,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}
