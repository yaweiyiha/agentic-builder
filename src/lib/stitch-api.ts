/**
 * Minimal Stitch MCP API client.
 *
 * Calls https://stitch.googleapis.com/mcp directly via JSON-RPC,
 * without requiring the stitch-mcp subprocess.
 *
 * Auth (checked in order):
 *   1. STITCH_REFRESH_TOKEN + STITCH_OAUTH_CLIENT_ID + STITCH_OAUTH_CLIENT_SECRET
 *      → auto-exchange for a fresh access token on every call (never expires)
 *   2. STITCH_ACCESS_TOKEN → Authorization: Bearer header (expires in ~1h)
 *   3. gcloud auth application-default print-access-token (dev fallback)
 */

import { execSync } from "child_process";

const STITCH_MCP_URL = "https://stitch.googleapis.com/mcp";
const STITCH_PROJECT_BASE_URL = "https://stitch.withgoogle.com/projects";

export interface StitchScreen {
  projectId: string;
  screenId: string;
  screenshotUrl: string | null;
  htmlDownloadUrl: string | null;
  projectUrl: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Exchange a refresh token for a fresh access token using the Google OAuth2 endpoint.
 * This is the recommended long-lived auth strategy when gcloud is not available.
 */
async function exchangeRefreshToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Failed to refresh Stitch token (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Refresh token exchange returned no access_token");
  return data.access_token;
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const refreshToken = process.env.STITCH_REFRESH_TOKEN;
  const clientId = process.env.STITCH_OAUTH_CLIENT_ID;
  const clientSecret = process.env.STITCH_OAUTH_CLIENT_SECRET;

  // Priority 1: refresh token flow (never expires, recommended)
  if (refreshToken && clientId && clientSecret) {
    const accessToken = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
    return { Authorization: `Bearer ${accessToken}` };
  }

  // Priority 2: static access token (expires in ~1h)
  const accessToken = process.env.STITCH_ACCESS_TOKEN;
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  // Priority 3: gcloud ADC fallback (dev environment)
  try {
    const token = execSync(
      "gcloud auth application-default print-access-token",
      { encoding: "utf8", timeout: 10_000 },
    ).trim();
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // ignore
  }

  throw new Error(
    "Stitch auth not configured. Options:\n" +
      "  1. Set STITCH_REFRESH_TOKEN + STITCH_OAUTH_CLIENT_ID + STITCH_OAUTH_CLIENT_SECRET (recommended, never expires)\n" +
      "  2. Set STITCH_ACCESS_TOKEN (expires in ~1h)\n" +
      "  3. Run: gcloud auth application-default login",
  );
}

// ─── Low-level JSON-RPC call ──────────────────────────────────────────────────

async function callStitchTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const headers = await buildAuthHeaders();

  // Stitch requires the billing project ID to be specified
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (projectId) {
    headers["X-Goog-User-Project"] = projectId;
  }

  const body = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id: Date.now(),
  };

  const response = await fetch(STITCH_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stitch API HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    result?: {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    error?: { message: string; code?: number };
  };

  if (data.error) {
    throw new Error(`Stitch API error [${data.error.code}]: ${data.error.message}`);
  }

  // MCP protocol wraps the actual payload inside result.content[0].text
  const content = data.result?.content;
  const textContent = content?.find((c) => c.type === "text")?.text ?? "";

  if (data.result?.isError) {
    throw new Error(`Stitch tool error: ${textContent}`);
  }

  // Parse the text payload as JSON; fall back to raw result if it fails
  try {
    return JSON.parse(textContent) as T;
  } catch {
    // Some tools return plain text — return as-is wrapped in an object
    return { raw: textContent } as T;
  }
}

// ─── High-level helpers ───────────────────────────────────────────────────────

interface CreateProjectResult {
  name?: string; // "projects/{id}"
}

interface GenerateScreenResult {
  outputComponents?: Array<{
    design?: {
      screens?: Array<{
        name?: string; // "projects/{p}/screens/{s}"
        id?: string;
        screenshot?: { downloadUrl?: string };
        htmlCode?: { downloadUrl?: string };
      }>;
    };
  }>;
}

/**
 * Creates a Stitch project and generates one screen from the given prompt.
 * Returns URLs suitable for embedding in the UI.
 */
export async function generateStitchScreen(
  prompt: string,
  projectTitle?: string,
): Promise<StitchScreen> {
  // 1. Create project
  const project = await callStitchTool<CreateProjectResult>("create_project", {
    title: projectTitle ?? "AgenticBuilder Design",
  });

  console.log("[StitchAPI] create_project raw response:", JSON.stringify(project));

  const rawProjectName = project?.name ?? "";
  const projectId = rawProjectName.startsWith("projects/")
    ? rawProjectName.slice(9)
    : rawProjectName;

  if (!projectId) {
    throw new Error("Stitch create_project returned no project ID");
  }

  console.log("[StitchAPI] project created:", projectId);

  // 2. Generate screen
  const generated = await callStitchTool<GenerateScreenResult>(
    "generate_screen_from_text",
    {
      projectId,
      prompt,
      deviceType: "DESKTOP",
      modelId: "GEMINI_3_1_PRO",
    },
  );

  console.log("[StitchAPI] generate_screen raw response:", JSON.stringify(generated));

  // Parse the nested response structure
  const screen = (generated?.outputComponents ?? [])
    .flatMap((c) => c?.design?.screens ?? [])
    .find((s) => s != null);

  if (!screen) {
    throw new Error("Stitch generate_screen_from_text returned no screen");
  }

  // Extract screenId from name "projects/{p}/screens/{s}"
  let screenId = screen.id ?? "";
  if (!screenId && screen.name) {
    const parts = screen.name.split("/screens/");
    if (parts.length === 2) screenId = parts[1];
  }

  console.log("[StitchAPI] screen generated:", screenId);

  return {
    projectId,
    screenId,
    screenshotUrl: screen.screenshot?.downloadUrl ?? null,
    htmlDownloadUrl: screen.htmlCode?.downloadUrl ?? null,
    projectUrl: `${STITCH_PROJECT_BASE_URL}/${projectId}`,
  };
}
