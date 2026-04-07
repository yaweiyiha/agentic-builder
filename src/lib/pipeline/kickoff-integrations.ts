import {
  invokeKickoffWebhook,
  type KickoffWebhookBase,
  type WebhookCallResult,
} from "./kickoff-webhooks";
import { saveKickoffRepoMetadata } from "./push-kickoff-repo";

const API_TIMEOUT_MS = 45_000;

export interface GithubDirectResult {
  kind: "github_api";
  ok: boolean;
  htmlUrl?: string;
  cloneUrl?: string;
  name?: string;
  error?: string;
  status?: number;
}

export interface JiraDirectResult {
  kind: "jira_api";
  ok: boolean;
  issueKey?: string;
  browseUrl?: string;
  error?: string;
  status?: number;
}

function slugForGithubRepo(brief: string, runId: string): string {
  const base = brief
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = runId.replace(/-/g, "").slice(0, 8);
  const name = `${base || "agentic"}-${suffix}`;
  return name.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

async function createGithubRepository(params: {
  token: string;
  org?: string;
  repoName: string;
  description: string;
}): Promise<GithubDirectResult> {
  const endpoint = params.org
    ? `https://api.github.com/orgs/${encodeURIComponent(params.org)}/repos`
    : "https://api.github.com/user/repos";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.repoName,
        description: params.description.slice(0, 350),
        private: true,
        auto_init: true,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: { html_url?: string; clone_url?: string; name?: string; message?: string } =
      {};
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      /* keep */
    }

    if (!res.ok) {
      return {
        kind: "github_api",
        ok: false,
        status: res.status,
        error: data.message ?? text.slice(0, 400),
      };
    }

    return {
      kind: "github_api",
      ok: true,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      name: data.name ?? params.repoName,
      status: res.status,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "github_api", ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

function normalizeJiraHost(host: string): string {
  let h = host.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
  return h;
}

function jiraAdfFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim() || "(no body)";
  const paragraphs = trimmed.split(/\n{2,}/).slice(0, 80);
  const content = paragraphs.map((p) => ({
    type: "paragraph",
    content: [{ type: "text", text: p.slice(0, 8000) }],
  }));
  return {
    type: "doc",
    version: 1,
    content:
      content.length > 0
        ? content
        : [
            {
              type: "paragraph",
              content: [{ type: "text", text: "(empty)" }],
            },
          ],
  };
}

async function createJiraIssue(params: {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  summary: string;
  descriptionText: string;
}): Promise<JiraDirectResult> {
  const base = normalizeJiraHost(params.host);
  const auth = Buffer.from(
    `${params.email}:${params.apiToken}`,
    "utf-8",
  ).toString("base64");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: params.projectKey },
          summary: params.summary.slice(0, 255),
          description: jiraAdfFromText(params.descriptionText),
          issuetype: { name: params.issueType },
        },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: { key?: string; errorMessages?: string[] } = {};
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      /* keep */
    }

    if (!res.ok) {
      const err =
        data.errorMessages?.join("; ") ?? text.slice(0, 400);
      return {
        kind: "jira_api",
        ok: false,
        status: res.status,
        error: err,
      };
    }

    const key = data.key;
    return {
      kind: "jira_api",
      ok: true,
      issueKey: key,
      browseUrl: key ? `${base}/browse/${key}` : undefined,
      status: res.status,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "jira_api", ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

function formatWebhookLine(r: WebhookCallResult, label: string): string {
  if (r.skipped) {
    return `- **${label}** (webhook): skipped — ${r.detail}`;
  }
  return `- **${label}** (webhook): ${r.ok ? "OK" : "Failed"} (HTTP ${r.status})${r.detail ? ` — \`${r.detail.replace(/`/g, "'").slice(0, 200)}\`` : ""}`;
}

export async function runKickoffIntegrations(params: {
  runId: string;
  sessionId: string;
  featureBrief: string;
  codeOutputRoot: string;
  writtenFiles: string[];
  prdExcerpt: string;
}): Promise<{
  markdown: string;
  metadata: Record<string, unknown>;
}> {
  const base: KickoffWebhookBase = {
    runId: params.runId,
    sessionId: params.sessionId,
    featureBrief: params.featureBrief,
    codeOutputRoot: params.codeOutputRoot,
    writtenFiles: params.writtenFiles,
  };

  const bearer = process.env.PROJECT_KICKOFF_WEBHOOK_BEARER_TOKEN;
  const lines: string[] = [
    "## Integrations",
    "",
    "Webhook URLs take precedence over direct API when both could apply.",
    "",
  ];
  const metadata: Record<string, unknown> = {};

  const gitWh = process.env.PROJECT_KICKOFF_GIT_WEBHOOK_URL?.trim();
  const ghToken = (
    process.env.PROJECT_KICKOFF_GITHUB_TOKEN || process.env.GITHUB_TOKEN
  )?.trim();

  if (gitWh) {
    const r = await invokeKickoffWebhook(
      gitWh,
      "create_git_repository",
      base,
      bearer,
    );
    metadata.git = r;
    lines.push("### Git repository", formatWebhookLine(r, "Git"), "");
  } else if (ghToken) {
    const org = process.env.PROJECT_KICKOFF_GITHUB_ORG?.trim();
    const repoOverride = process.env.PROJECT_KICKOFF_GITHUB_REPO?.trim();
    const repoName =
      repoOverride && /^[a-z0-9_.-]+$/i.test(repoOverride)
        ? repoOverride
        : slugForGithubRepo(params.featureBrief, params.runId);

    const gh = await createGithubRepository({
      token: ghToken,
      org: org || undefined,
      repoName,
      description: `Agentic Builder kick-off — ${params.featureBrief.slice(0, 120)}`,
    });
    metadata.github = gh;
    if (gh.ok && gh.cloneUrl) {
      await saveKickoffRepoMetadata(process.cwd(), {
        cloneUrl: gh.cloneUrl,
        htmlUrl: gh.htmlUrl,
        name: gh.name,
      });
    }
    lines.push("### Git repository (GitHub API)");
    if (gh.ok && gh.htmlUrl) {
      lines.push(`- Created **${gh.name}**`, `- URL: ${gh.htmlUrl}`);
      if (gh.cloneUrl) lines.push(`- Clone: \`${gh.cloneUrl}\``);
      lines.push(
        "- After coding finishes, use **Push generated code to this repo** in the Kick-off tab (requires server `GITHUB_TOKEN`).",
      );
    } else {
      lines.push(
        `- Failed${gh.status ? ` (HTTP ${gh.status})` : ""}: ${gh.error ?? "unknown"}`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      "### Git repository",
      "_Skipped — set `PROJECT_KICKOFF_GIT_WEBHOOK_URL` or `GITHUB_TOKEN` (or `PROJECT_KICKOFF_GITHUB_TOKEN`)_",
      "",
    );
    metadata.git = { skipped: true };
  }

  const jiraEnabled = process.env.PROJECT_KICKOFF_JIRA_ENABLED === "true";
  const jiraWh = process.env.PROJECT_KICKOFF_JIRA_WEBHOOK_URL?.trim();
  const jiraHost = process.env.PROJECT_KICKOFF_JIRA_HOST?.trim();
  const jiraEmail = process.env.PROJECT_KICKOFF_JIRA_EMAIL?.trim();
  const jiraToken = process.env.PROJECT_KICKOFF_JIRA_API_TOKEN?.trim();
  const jiraProject = process.env.PROJECT_KICKOFF_JIRA_PROJECT_KEY?.trim();
  const jiraIssueType =
    process.env.PROJECT_KICKOFF_JIRA_ISSUE_TYPE?.trim() || "Task";

  if (!jiraEnabled) {
    lines.push(
      "### Jira",
      "_Disabled — set `PROJECT_KICKOFF_JIRA_ENABLED=true` and configure webhook or Cloud API credentials._",
      "",
    );
    metadata.jira = { disabled: true, reason: "PROJECT_KICKOFF_JIRA_ENABLED not true" };
  } else if (jiraWh) {
    const r = await invokeKickoffWebhook(
      jiraWh,
      "create_jira_tasks",
      base,
      bearer,
    );
    metadata.jira = r;
    lines.push("### Jira", formatWebhookLine(r, "Jira"), "");
  } else if (jiraHost && jiraEmail && jiraToken && jiraProject) {
    const summary = `[Kick-off] ${params.featureBrief.slice(0, 200)}`;
    const bodyText = [
      `Run: \`${params.runId}\``,
      "",
      "Feature brief:",
      params.featureBrief,
      "",
      "PRD excerpt:",
      params.prdExcerpt.slice(0, 6000),
    ].join("\n");

    const jr = await createJiraIssue({
      host: jiraHost,
      email: jiraEmail,
      apiToken: jiraToken,
      projectKey: jiraProject,
      issueType: jiraIssueType,
      summary,
      descriptionText: bodyText,
    });
    metadata.jira = jr;
    lines.push("### Jira (REST API)");
    if (jr.ok && jr.browseUrl) {
      lines.push(`- Created **${jr.issueKey}**`, `- ${jr.browseUrl}`);
    } else {
      lines.push(
        `- Failed${jr.status ? ` (HTTP ${jr.status})` : ""}: ${jr.error ?? "unknown"}`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      "### Jira",
      "_Jira enabled but incomplete config — set `PROJECT_KICKOFF_JIRA_WEBHOOK_URL` **or** host + email + API token + project key._",
      "",
    );
    metadata.jira = { skipped: true, reason: "incomplete_config" };
  }

  return { markdown: lines.join("\n"), metadata };
}
