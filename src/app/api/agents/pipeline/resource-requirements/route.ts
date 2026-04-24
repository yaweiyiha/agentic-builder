import { NextRequest, NextResponse } from "next/server";
import {
  readResourceRequirements,
  writeResourceRequirements,
  type ResourceRequirement,
} from "@/lib/pipeline/resource-requirements";

export const runtime = "nodejs";

function projectRoot() {
  return process.cwd();
}

export async function GET() {
  const items = await readResourceRequirements(projectRoot());
  return NextResponse.json({ requirements: items });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Invalid JSON body: ${err.message}`
            : "Invalid JSON body.",
      },
      { status: 400 },
    );
  }

  const list = (body as { requirements?: unknown }).requirements;
  if (!Array.isArray(list)) {
    return NextResponse.json(
      { error: "Expected `requirements` to be an array." },
      { status: 400 },
    );
  }

  const items: ResourceRequirement[] = [];
  for (const x of list) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o.envKey !== "string" || !o.envKey.trim()) continue;
    items.push({
      envKey: String(o.envKey),
      label: typeof o.label === "string" ? o.label : String(o.envKey),
      description: typeof o.description === "string" ? o.description : "",
      category:
        typeof o.category === "string"
          ? (o.category as ResourceRequirement["category"])
          : "other",
      required: o.required !== false,
      example: typeof o.example === "string" ? o.example : undefined,
      docsUrl: typeof o.docsUrl === "string" ? o.docsUrl : undefined,
      value: typeof o.value === "string" ? o.value : "",
    });
  }

  await writeResourceRequirements(projectRoot(), items);
  return NextResponse.json({ ok: true, count: items.length });
}

export async function DELETE() {
  await writeResourceRequirements(projectRoot(), []);
  return NextResponse.json({ ok: true });
}
