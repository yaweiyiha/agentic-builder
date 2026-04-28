import { NextRequest, NextResponse } from "next/server";
import { getProjects, createProject } from "@/lib/project-store";

/** GET /api/projects — list all projects */
export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("[api/projects] GET error:", err);
    return NextResponse.json({ message: "Internal server error." }, { status: 500 });
  }
}

/** POST /api/projects — create a new project */
export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };

    if (!name || !name.trim()) {
      return NextResponse.json(
        { message: "Project name is required." },
        { status: 400 },
      );
    }

    const project = await createProject(name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("[api/projects] POST error:", err);
    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 },
    );
  }
}
