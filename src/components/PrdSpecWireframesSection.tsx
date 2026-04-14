"use client";

import { motion } from "motion/react";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";

export function parsePrdStepMetadata(metadata: unknown): {
  prdSpec: PrdSpec | null;
} {
  if (!metadata || typeof metadata !== "object") {
    return { prdSpec: null };
  }
  const m = metadata as Record<string, unknown>;
  const prdSpec = (m.prdSpec as PrdSpec | undefined) ?? null;
  return { prdSpec };
}

export default function PrdSpecWireframesSection({
  prdSpec,
  intro,
}: {
  prdSpec: PrdSpec | null;
  /** Optional note shown above the sections when content exists. */
  intro?: string;
}) {
  const hasSpec = prdSpec && prdSpec.pages?.length > 0;
  if (!hasSpec) return null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {intro && (
        <p className="text-[13px] leading-relaxed text-zinc-500">{intro}</p>
      )}
      <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]"
        >
          <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Structured PRD spec
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
            Extracted pages and component IDs (CMP-*) for task coverage. Synced
            after PRD generation completes.
          </p>
          <div className="mt-5 space-y-5">
            {prdSpec!.pages.map((page, i) => (
              <div
                key={page.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] font-semibold text-indigo-700">
                    {page.id}
                  </span>
                  <span className="text-[14px] font-semibold text-zinc-900">
                    {page.name}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {page.route}
                  </span>
                </div>
                {page.layoutRegions.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      Layout regions
                    </p>
                    <ul className="mt-1 list-inside list-disc text-[13px] text-zinc-700">
                      {page.layoutRegions.map((r, j) => (
                        <li key={j}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {page.interactiveComponents.length > 0 && (
                  <div className="mt-3 overflow-x-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-2">
                    <table className="w-full min-w-[560px] border-collapse text-left text-[12px]">
                      <thead>
                        <tr className="border-b border-zinc-200 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          <th className="py-2 pr-2">ID</th>
                          <th className="py-2 pr-2">Component</th>
                          <th className="py-2 pr-2">Type</th>
                          <th className="py-2 pr-2">Interaction</th>
                          <th className="py-2">Effect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.interactiveComponents.map((c) => (
                          <tr
                            key={c.id}
                            className="border-b border-zinc-100 align-top last:border-b-0"
                          >
                            <td className="py-2 pr-2 font-mono text-[11px] font-medium text-indigo-800">
                              {c.id}
                            </td>
                            <td className="py-2 pr-2 font-medium text-zinc-900">
                              {c.name}
                            </td>
                            <td className="py-2 pr-2 text-zinc-600">{c.type}</td>
                            <td className="py-2 pr-2 text-zinc-600">
                              {c.interaction}
                            </td>
                            <td className="py-2 text-zinc-600">{c.effect}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {page.staticElements.length > 0 && (
                  <p className="mt-2 text-[12px] text-zinc-600">
                    <span className="font-medium text-zinc-700">Static: </span>
                    {page.staticElements.join(" · ")}
                  </p>
                )}
                {page.states.length > 0 && (
                  <p className="mt-1 text-[12px] text-zinc-600">
                    <span className="font-medium text-zinc-700">States: </span>
                    {page.states.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </motion.section>
    </div>
  );
}
