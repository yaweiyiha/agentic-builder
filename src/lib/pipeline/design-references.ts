import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Design references — user-supplied screenshots that guide the coding phase.
 *
 * Layout on disk:
 *   .blueprint/design-references/
 *     manifest.json            — array of DesignReferenceEntry
 *     <id>.<ext>               — image binary
 *
 * At kickoff time, `copyDesignReferencesToOutput` mirrors the whole folder
 * into `<outputRoot>/.design-references/` so coding workers (and humans)
 * can consult the files from inside the generated project.
 */

export interface DesignReferenceEntry {
  /** Stable random id used for filenames and API routes. */
  id: string;
  /** Original filename supplied by the uploader (display only). */
  fileName: string;
  /** Filename on disk (`<id>.<ext>`); always lives under the references dir. */
  storedFileName: string;
  /** MIME type, e.g. `image/png`. */
  mime: string;
  bytes: number;
  /** Human-readable label, e.g. "Login page mockup". */
  label: string;
  /**
   * Optional hint binding this reference to a page/route or PRD section,
   * e.g. `/login`, `FR-AU01`, `PAGE-01`. Empty string when unspecified.
   */
  pageHint: string;
  /** ISO timestamp. */
  uploadedAt: string;
}

const REFERENCE_DIR_REL = path.join(".blueprint", "design-references");
const MANIFEST_FILE = "manifest.json";

const MAX_BYTES_PER_FILE = 6 * 1024 * 1024;
const MAX_TOTAL_REFERENCES = 24;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const ACCEPTED_IMAGE_MIMES = Object.keys(EXT_BY_MIME);

export function designReferenceDirAbs(projectRoot: string): string {
  return path.join(projectRoot, REFERENCE_DIR_REL);
}

function manifestPathAbs(projectRoot: string): string {
  return path.join(designReferenceDirAbs(projectRoot), MANIFEST_FILE);
}

async function ensureDir(projectRoot: string): Promise<void> {
  await fs.mkdir(designReferenceDirAbs(projectRoot), { recursive: true });
}

export async function readManifest(
  projectRoot: string,
): Promise<DesignReferenceEntry[]> {
  try {
    const raw = await fs.readFile(manifestPathAbs(projectRoot), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is DesignReferenceEntry =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as DesignReferenceEntry).id === "string" &&
        typeof (x as DesignReferenceEntry).storedFileName === "string",
    );
  } catch {
    return [];
  }
}

async function writeManifest(
  projectRoot: string,
  entries: DesignReferenceEntry[],
): Promise<void> {
  await ensureDir(projectRoot);
  await fs.writeFile(
    manifestPathAbs(projectRoot),
    JSON.stringify(entries, null, 2),
    "utf-8",
  );
}

export interface AddDesignReferenceInput {
  fileName: string;
  mime: string;
  bytes: Buffer;
  label?: string;
  pageHint?: string;
}

export interface AddDesignReferenceResult {
  ok: true;
  entry: DesignReferenceEntry;
  manifest: DesignReferenceEntry[];
}

export interface AddDesignReferenceFailure {
  ok: false;
  error: string;
  status: number;
}

/**
 * Persists a single uploaded image and appends it to the manifest.
 */
export async function addDesignReference(
  projectRoot: string,
  input: AddDesignReferenceInput,
): Promise<AddDesignReferenceResult | AddDesignReferenceFailure> {
  const mime = input.mime.toLowerCase();
  if (!EXT_BY_MIME[mime]) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported image type "${input.mime}". Allowed: ${ACCEPTED_IMAGE_MIMES.join(", ")}.`,
    };
  }
  if (input.bytes.byteLength > MAX_BYTES_PER_FILE) {
    return {
      ok: false,
      status: 413,
      error: `File is too large (${input.bytes.byteLength} bytes). Limit: ${MAX_BYTES_PER_FILE} bytes.`,
    };
  }

  const existing = await readManifest(projectRoot);
  if (existing.length >= MAX_TOTAL_REFERENCES) {
    return {
      ok: false,
      status: 409,
      error: `Already at the ${MAX_TOTAL_REFERENCES}-reference limit. Remove an existing reference first.`,
    };
  }

  const id = crypto.randomBytes(8).toString("hex");
  const ext = EXT_BY_MIME[mime];
  const storedFileName = `${id}.${ext}`;
  const entry: DesignReferenceEntry = {
    id,
    fileName: input.fileName.slice(0, 200) || `${id}.${ext}`,
    storedFileName,
    mime,
    bytes: input.bytes.byteLength,
    label: (input.label ?? "").trim().slice(0, 120),
    pageHint: (input.pageHint ?? "").trim().slice(0, 80),
    uploadedAt: new Date().toISOString(),
  };

  await ensureDir(projectRoot);
  await fs.writeFile(
    path.join(designReferenceDirAbs(projectRoot), storedFileName),
    input.bytes,
  );

  const manifest = [...existing, entry];
  await writeManifest(projectRoot, manifest);
  return { ok: true, entry, manifest };
}

export interface UpdateDesignReferenceInput {
  label?: string;
  pageHint?: string;
}

export async function updateDesignReference(
  projectRoot: string,
  id: string,
  input: UpdateDesignReferenceInput,
): Promise<DesignReferenceEntry | null> {
  const entries = await readManifest(projectRoot);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const current = entries[idx]!;
  const next: DesignReferenceEntry = {
    ...current,
    label:
      typeof input.label === "string"
        ? input.label.trim().slice(0, 120)
        : current.label,
    pageHint:
      typeof input.pageHint === "string"
        ? input.pageHint.trim().slice(0, 80)
        : current.pageHint,
  };
  entries[idx] = next;
  await writeManifest(projectRoot, entries);
  return next;
}

export async function deleteDesignReference(
  projectRoot: string,
  id: string,
): Promise<DesignReferenceEntry[]> {
  const entries = await readManifest(projectRoot);
  const target = entries.find((e) => e.id === id);
  if (!target) return entries;
  try {
    await fs.unlink(
      path.join(designReferenceDirAbs(projectRoot), target.storedFileName),
    );
  } catch {
    // best-effort
  }
  const next = entries.filter((e) => e.id !== id);
  await writeManifest(projectRoot, next);
  return next;
}

export async function clearAllDesignReferences(
  projectRoot: string,
): Promise<void> {
  const entries = await readManifest(projectRoot);
  for (const entry of entries) {
    try {
      await fs.unlink(
        path.join(designReferenceDirAbs(projectRoot), entry.storedFileName),
      );
    } catch {
      // best-effort
    }
  }
  await writeManifest(projectRoot, []);
}

export async function readDesignReferenceFile(
  projectRoot: string,
  id: string,
): Promise<{ entry: DesignReferenceEntry; data: Buffer } | null> {
  const entries = await readManifest(projectRoot);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  try {
    const data = await fs.readFile(
      path.join(designReferenceDirAbs(projectRoot), entry.storedFileName),
    );
    return { entry, data };
  } catch {
    return null;
  }
}

/**
 * Mirrors `.blueprint/design-references/` into `<outputRoot>/.design-references/`
 * so that coding workers can read the files through their normal fs tooling.
 * Returns the manifest entries that were copied (empty when nothing exists).
 */
export async function copyDesignReferencesToOutput(
  projectRoot: string,
  outputRoot: string,
): Promise<DesignReferenceEntry[]> {
  const entries = await readManifest(projectRoot);
  if (entries.length === 0) return [];

  const srcDir = designReferenceDirAbs(projectRoot);
  const destDir = path.join(outputRoot, ".design-references");
  await fs.mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    const src = path.join(srcDir, entry.storedFileName);
    const dest = path.join(destDir, entry.storedFileName);
    try {
      await fs.copyFile(src, dest);
    } catch (err) {
      console.warn(
        `[DesignReferences] Failed to copy ${entry.storedFileName}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  try {
    await fs.writeFile(
      path.join(destDir, MANIFEST_FILE),
      JSON.stringify(entries, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.warn(
      "[DesignReferences] Failed to write output manifest:",
      err instanceof Error ? err.message : err,
    );
  }

  return entries;
}

/**
 * Reads the mirrored manifest from an output tree (written by
 * `copyDesignReferencesToOutput`). Returns an empty array on any failure.
 */
export async function readDesignReferencesFromOutput(
  outputRoot: string,
): Promise<DesignReferenceEntry[]> {
  try {
    const raw = await fs.readFile(
      path.join(outputRoot, ".design-references", MANIFEST_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is DesignReferenceEntry =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as DesignReferenceEntry).id === "string" &&
        typeof (x as DesignReferenceEntry).storedFileName === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Formats the manifest as a markdown block that can be injected into the
 * task-breakdown prompt and the coding-worker prompt. Returns an empty
 * string when no references exist (caller should skip the section).
 */
export function formatDesignReferencesPromptBlock(
  entries: DesignReferenceEntry[],
): string {
  if (entries.length === 0) return "";
  const lines = entries.map((entry, i) => {
    const label = entry.label || "(no label)";
    const hint = entry.pageHint ? ` — target: \`${entry.pageHint}\`` : "";
    return `${i + 1}. \`.design-references/${entry.storedFileName}\` — **${label}**${hint} (original name: \`${entry.fileName}\`, ${entry.mime})`;
  });
  return [
    "## Design references (user-uploaded screenshots)",
    "",
    `The user attached **${entries.length}** screenshot reference(s) before coding. They live under \`.design-references/\` inside the project root (also mirrored from \`.blueprint/design-references/\`).`,
    "",
    lines.join("\n"),
    "",
    "Rules for agents:",
    "- Treat each screenshot as the **visual ground truth** for the page listed in its `target` hint. Match layout regions, component placement, colour palette, typography, spacing, and interactive states as closely as possible.",
    "- If a reference has no `target`, apply its aesthetic across the matching feature area (pick the best-fit page by label).",
    "- Do NOT rename, move, or delete files under `.design-references/` — leave them as-is so downstream tooling can consult them.",
    "- When pixel-matching is impossible (e.g. missing image tools), infer the user intent from the label/target and prioritize matching the structural composition.",
    "",
  ].join("\n");
}
