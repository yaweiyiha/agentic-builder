import { NextRequest } from "next/server";

import { getSystemMemory } from "@/lib/memory";
import type { MemoryKind, MemoryRecord } from "@/lib/memory/types";

export const maxDuration = 30;

/** Status filter applied on top of recall results. Mirrors the design
 *  doc §12.7 three-layer architecture. */
export type StatusFilter = "all" | "active" | "shadow" | "deprecated" | "approved";

const SUPPORTED_KINDS: MemoryKind[] = ["failure-pattern", "classification"];
const ACTIVE_THRESHOLD = 0.3;

export interface MemoryListItem {
  id: string;
  layer: "L1" | "L2";
  kind: MemoryKind;
  title: string;
  tags: string[];
  source: string;
  createdAt: number;
  updatedAt: number;
  metrics: { hits?: number; lastHitAt?: number; score?: number };
  status: Exclude<StatusFilter, "all" | "approved">;
  approved: boolean;
  /** Cluster-occurrence hint for mined patterns (parsed from body). */
  occurrences?: number;
  bodyPreview: string;
}

function statusOf(r: MemoryRecord): Exclude<StatusFilter, "all" | "approved"> {
  const score = r.metrics.score ?? 0;
  const approved = r.tags.includes("manual:approved");
  if (score < 0 && !approved) return "deprecated";
  if (score >= ACTIVE_THRESHOLD || approved) return "active";
  return "shadow";
}

function extractOccurrences(body: string): number | undefined {
  const m = body.match(/(\d+)\s+occurrences/);
  if (m) return Number(m[1]);
  return undefined;
}

function toListItem(r: MemoryRecord): MemoryListItem {
  return {
    id: r.id,
    layer: r.layer,
    kind: r.kind,
    title: r.title,
    tags: r.tags,
    source: r.source,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    metrics: r.metrics,
    status: statusOf(r),
    approved: r.tags.includes("manual:approved"),
    occurrences: extractOccurrences(r.body),
    bodyPreview: r.body.slice(0, 200),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const statusParam = (url.searchParams.get("status") ?? "all") as StatusFilter;
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? "200")));

  const kinds: MemoryKind[] = kindParam
    ? [kindParam as MemoryKind].filter((k) => SUPPORTED_KINDS.includes(k))
    : SUPPORTED_KINDS;

  if (kinds.length === 0) {
    return Response.json({ items: [], total: 0 }, { status: 200 });
  }

  try {
    const store = getSystemMemory();
    const all: MemoryRecord[] = [];
    for (const kind of kinds) {
      const rs = await store.list({ layer: "L1", kind, limit: 1_000_000 });
      all.push(...rs);
    }

    const filtered = all.filter((r) => {
      const item = toListItem(r);
      if (statusParam === "approved" && !item.approved) return false;
      if (statusParam !== "all" && statusParam !== "approved") {
        if (item.status !== statusParam) return false;
      }
      if (search) {
        const hay = (r.title + " " + r.body + " " + r.tags.join(" ")).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Sort: active first, then by occurrences desc, then by hits desc, then by updatedAt desc.
    filtered.sort((a, b) => {
      const sa = statusOf(a);
      const sb = statusOf(b);
      const rank = (s: typeof sa): number =>
        s === "active" ? 0 : s === "shadow" ? 1 : 2;
      if (rank(sa) !== rank(sb)) return rank(sa) - rank(sb);
      const oa = extractOccurrences(a.body) ?? 0;
      const ob = extractOccurrences(b.body) ?? 0;
      if (oa !== ob) return ob - oa;
      const ha = a.metrics.hits ?? 0;
      const hb = b.metrics.hits ?? 0;
      if (ha !== hb) return hb - ha;
      return b.updatedAt - a.updatedAt;
    });

    const items = filtered.slice(0, limit).map(toListItem);
    return Response.json(
      { items, total: filtered.length, supportedKinds: SUPPORTED_KINDS },
      { status: 200 },
    );
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
