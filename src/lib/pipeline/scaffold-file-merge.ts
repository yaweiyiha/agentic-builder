/**
 * Merge incoming file content with existing scaffold on disk instead of blind overwrite.
 */

import path from "path";

export function normalizeScaffoldRelPath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized.split(path.sep).join("/");
}

function isJsonMergeable(rel: string): boolean {
  const base = path.basename(rel);
  if (base === "package.json" || base === "package-lock.json") return true;
  if (base.startsWith("tsconfig") && base.endsWith(".json")) return true;
  return false;
}

function isYamlWorkspace(rel: string): boolean {
  return (
    path.basename(rel) === "pnpm-workspace.yaml" ||
    path.basename(rel) === "pnpm-workspace.yml"
  );
}

function isLineMergeable(rel: string): boolean {
  const base = path.basename(rel);
  return base === ".gitignore" || base === ".eslintignore";
}

export type MergeResult =
  | { kind: "merged"; content: string }
  | { kind: "skip"; reason: string }
  | { kind: "use_incoming"; content: string };

function mergePackageJson(
  baseRaw: string,
  incomingRaw: string,
): MergeResult {
  let base: Record<string, unknown>;
  let incoming: Record<string, unknown>;
  try {
    base = JSON.parse(baseRaw) as Record<string, unknown>;
    incoming = JSON.parse(incomingRaw) as Record<string, unknown>;
  } catch {
    return { kind: "skip", reason: "invalid JSON in package.json merge" };
  }

  const mergeDepBlock = (
    b: unknown,
    inc: unknown,
  ): Record<string, string> => {
    const left =
      b && typeof b === "object" && !Array.isArray(b)
        ? (b as Record<string, string>)
        : {};
    const right =
      inc && typeof inc === "object" && !Array.isArray(inc)
        ? (inc as Record<string, string>)
        : {};
    return { ...left, ...right };
  };

  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "scripts") {
      const bs = base.scripts;
      const isObj = (x: unknown) =>
        x && typeof x === "object" && !Array.isArray(x);
      if (isObj(bs) && isObj(v)) {
        out.scripts = { ...(bs as object), ...(v as object) };
      } else if (v !== undefined) {
        out.scripts = v;
      }
    } else if (
      k === "dependencies" ||
      k === "devDependencies" ||
      k === "peerDependencies" ||
      k === "optionalDependencies"
    ) {
      out[k] = mergeDepBlock(base[k], v);
    } else if (k === "pnpm" && typeof base.pnpm === "object" && base.pnpm && typeof v === "object" && v) {
      out.pnpm = { ...(base.pnpm as object), ...(v as object) };
    } else {
      out[k] = v;
    }
  }

  return {
    kind: "merged",
    content: `${JSON.stringify(out, null, 2)}\n`,
  };
}

function deepMergeObjects(
  base: unknown,
  incoming: unknown,
): unknown {
  if (incoming === undefined) return base;
  if (
    base &&
    incoming &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    typeof incoming === "object" &&
    !Array.isArray(incoming)
  ) {
    const o: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      if (k in o) {
        o[k] = deepMergeObjects(o[k], v);
      } else {
        o[k] = v;
      }
    }
    return o;
  }
  return incoming;
}

function mergeStringArraysUnique(a: unknown, b: unknown): unknown {
  const aa = Array.isArray(a) ? a.map(String) : [];
  const bb = Array.isArray(b) ? b.map(String) : [];
  return [...new Set([...aa, ...bb])];
}

function mergeTsconfigJson(baseRaw: string, incomingRaw: string): MergeResult {
  let base: Record<string, unknown>;
  let incoming: Record<string, unknown>;
  try {
    base = JSON.parse(baseRaw) as Record<string, unknown>;
    incoming = JSON.parse(incomingRaw) as Record<string, unknown>;
  } catch {
    return { kind: "skip", reason: "invalid JSON in tsconfig merge" };
  }

  const arrayKeys = new Set([
    "include",
    "exclude",
    "files",
    "types",
    "lib",
  ]);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "compilerOptions") {
      const bc = base.compilerOptions;
      const ic = v;
      if (
        bc &&
        typeof bc === "object" &&
        !Array.isArray(bc) &&
        ic &&
        typeof ic === "object" &&
        !Array.isArray(ic)
      ) {
        out.compilerOptions = deepMergeObjects(bc, ic) as Record<
          string,
          unknown
        >;
      } else if (v !== undefined) {
        out.compilerOptions = v;
      }
    } else if (k === "references") {
      const br = Array.isArray(base.references) ? base.references : [];
      const ir = Array.isArray(v) ? v : [];
      const byPath = new Map<string, unknown>();
      for (const r of br) {
        if (r && typeof r === "object" && "path" in (r as object)) {
          byPath.set(String((r as { path: string }).path), r);
        }
      }
      for (const r of ir) {
        if (r && typeof r === "object" && "path" in (r as object)) {
          byPath.set(String((r as { path: string }).path), r);
        }
      }
      out.references = [...byPath.values()];
    } else if (arrayKeys.has(k)) {
      out[k] = mergeStringArraysUnique(base[k], v);
    } else {
      out[k] = v !== undefined ? v : base[k];
    }
  }

  return {
    kind: "merged",
    content: `${JSON.stringify(out, null, 2)}\n`,
  };
}

function mergePnpmWorkspaceYaml(baseRaw: string, incomingRaw: string): MergeResult {
  const extractPkgs = (raw: string): string[] => {
    const lines = raw.split("\n");
    const pkgs: string[] = [];
    let inPkgs = false;
    for (const line of lines) {
      if (/^packages:\s*$/.test(line.trim())) {
        inPkgs = true;
        continue;
      }
      if (inPkgs) {
        if (/^\S/.test(line) && !line.trim().startsWith("-")) {
          break;
        }
        const m = line.match(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/);
        if (m) pkgs.push(m[1].trim());
      }
    }
    return pkgs;
  };

  const basePkgs = extractPkgs(baseRaw);
  const incPkgs = extractPkgs(incomingRaw);
  const merged = [...new Set([...basePkgs, ...incPkgs])];
  if (merged.length === 0) {
    return { kind: "use_incoming", content: incomingRaw };
  }

  const body = merged.map((p) => `  - '${p}'`).join("\n");
  const out = `packages:\n${body}\n`;
  return { kind: "merged", content: out };
}

function mergeGitignoreLike(baseRaw: string, incomingRaw: string): MergeResult {
  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  const merged = [...new Set([...lines(baseRaw), ...lines(incomingRaw)])];
  const header =
    "# Merged: scaffold + generated (duplicates removed)\n";
  return {
    kind: "merged",
    content: `${header}\n${merged.join("\n")}\n`,
  };
}

/**
 * Decide final content when `relPath` is a scaffold-protected file that already exists on disk.
 */
export function mergeScaffoldContent(
  relPath: string,
  existingOnDisk: string,
  incoming: string,
  options: { forceOverwrite?: boolean },
): MergeResult {
  const norm = normalizeScaffoldRelPath(relPath);

  if (options.forceOverwrite) {
    return { kind: "use_incoming", content: incoming };
  }

  if (isJsonMergeable(norm)) {
    if (norm.endsWith("package-lock.json")) {
      return {
        kind: "skip",
        reason: "package-lock.json: keep scaffold lock; run install locally",
      };
    }
    if (path.basename(norm).startsWith("tsconfig") && norm.endsWith(".json")) {
      return mergeTsconfigJson(existingOnDisk, incoming);
    }
    if (path.basename(norm) === "package.json") {
      return mergePackageJson(existingOnDisk, incoming);
    }
  }

  if (isYamlWorkspace(norm)) {
    return mergePnpmWorkspaceYaml(existingOnDisk, incoming);
  }

  if (isLineMergeable(norm)) {
    return mergeGitignoreLike(existingOnDisk, incoming);
  }

  return {
    kind: "skip",
    reason:
      "scaffold source/config: merge not supported; preserved existing file",
  };
}
