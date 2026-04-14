/**
 * Optional outbound webhooks after local files are written.
 * Point URLs at your automation (e.g. create repo, Jira issues).
 */

export type ProjectKickoffTarget = "create_git_repository" | "create_jira_tasks";

export interface ProjectKickoffWebhookPayload {
  event: "project_kickoff";
  target: ProjectKickoffTarget;
  runId: string;
  sessionId: string;
  featureBrief: string;
  codeOutputRoot: string;
  writtenFiles: string[];
  timestamp: string;
}

export interface WebhookCallResult {
  target: ProjectKickoffTarget;
  url: string;
  ok: boolean;
  status: number;
  detail: string;
  skipped: boolean;
}

const WEBHOOK_TIMEOUT_MS = 45_000;

async function postJson(
  url: string,
  body: unknown,
  bearerToken?: string,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "AgenticBuilder/1.0",
  };
  const token = bearerToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const detail = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    return { ok: res.ok, status: res.status, detail: detail || "(empty body)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, detail: msg };
  } finally {
    clearTimeout(t);
  }
}

function buildPayload(
  target: ProjectKickoffTarget,
  base: Omit<ProjectKickoffWebhookPayload, "event" | "target" | "timestamp">,
): ProjectKickoffWebhookPayload {
  return {
    event: "project_kickoff",
    target,
    ...base,
    timestamp: new Date().toISOString(),
  };
}

export type KickoffWebhookBase = Omit<
  ProjectKickoffWebhookPayload,
  "event" | "target" | "timestamp"
>;

/** Single webhook call (used by orchestrator and legacy batch helper). */
export async function invokeKickoffWebhook(
  url: string | undefined,
  target: ProjectKickoffTarget,
  base: KickoffWebhookBase,
  bearerToken?: string,
): Promise<WebhookCallResult> {
  const trimmed = url?.trim();
  if (!trimmed) {
    return {
      target,
      url: "",
      ok: true,
      status: 0,
      detail:
        target === "create_git_repository"
          ? "PROJECT_KICKOFF_GIT_WEBHOOK_URL not set"
          : "PROJECT_KICKOFF_JIRA_WEBHOOK_URL not set",
      skipped: true,
    };
  }

  const body = buildPayload(target, base);
  const { ok, status, detail } = await postJson(
    trimmed,
    body,
    bearerToken,
  );
  return {
    target,
    url: trimmed,
    ok,
    status,
    detail,
    skipped: false,
  };
}

export async function invokeProjectKickoffWebhooks(params: {
  runId: string;
  sessionId: string;
  featureBrief: string;
  codeOutputRoot: string;
  writtenFiles: string[];
  gitWebhookUrl?: string;
  jiraWebhookUrl?: string;
  bearerToken?: string;
}): Promise<WebhookCallResult[]> {
  const base: KickoffWebhookBase = {
    runId: params.runId,
    sessionId: params.sessionId,
    featureBrief: params.featureBrief,
    codeOutputRoot: params.codeOutputRoot,
    writtenFiles: params.writtenFiles,
  };

  return [
    await invokeKickoffWebhook(
      params.gitWebhookUrl,
      "create_git_repository",
      base,
      params.bearerToken,
    ),
    await invokeKickoffWebhook(
      params.jiraWebhookUrl,
      "create_jira_tasks",
      base,
      params.bearerToken,
    ),
  ];
}

export function formatWebhookSummaryMarkdown(results: WebhookCallResult[]): string {
  const lines: string[] = ["## Integrations (webhooks)", ""];
  for (const r of results) {
    const label =
      r.target === "create_git_repository"
        ? "Git repository"
        : "Jira tasks";
    if (r.skipped) {
      lines.push(`- **${label}**: skipped — ${r.detail}`);
    } else {
      lines.push(
        `- **${label}**: ${r.ok ? "OK" : "Failed"} (HTTP ${r.status})`,
      );
      if (!r.ok || r.detail) {
        lines.push(`  - Response: \`${r.detail.replace(/`/g, "'")}\``);
      }
    }
  }
  return lines.join("\n");
}
