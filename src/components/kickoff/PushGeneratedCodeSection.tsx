"use client";

import { useEffect, useState } from "react";

type PushInfo = {
  available: boolean;
  hasToken: boolean;
  repo: {
    name?: string;
    htmlUrl?: string;
    cloneUrl?: string;
    savedAt?: string;
  } | null;
};

export default function PushGeneratedCodeSection({
  codeOutputDir,
}: {
  codeOutputDir: string;
}) {
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents/push-generated-code")
      .then((r) => r.json())
      .then((data: PushInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const handlePush = async () => {
    setPushing(true);
    setMessage(null);
    try {
      const r = await fetch("/api/agents/push-generated-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeOutputDir }),
      });
      const data = (await r.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        detail?: string;
      };
      if (!r.ok) {
        setMessage(
          [data.error, data.detail].filter(Boolean).join("\n") || "Push failed",
        );
        return;
      }
      setMessage(data.message ?? "Done.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setPushing(false);
    }
  };

  if (info === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-[13px] text-zinc-500 shadow-sm">
        Checking GitHub push configuration…
      </div>
    );
  }

  if (!info.available) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 p-5 text-[13px] leading-relaxed text-zinc-600 shadow-sm">
        <p className="font-semibold text-zinc-900">Push generated code</p>
        <p className="mt-2">
          After kick-off creates a GitHub repo (direct API with{" "}
          <code className="rounded bg-zinc-200/80 px-1">GITHUB_TOKEN</code>),
          this panel can push{" "}
          <code className="rounded bg-zinc-200/80 px-1">{codeOutputDir}</code>{" "}
          to that repository. Re-run kick-off once with token configured, or add{" "}
          <code className="rounded bg-zinc-200/80 px-1">.blueprint/kickoff-repo.json</code>{" "}
          manually.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.06)]">
      <p className="text-[15px] font-semibold text-zinc-900">
        Push generated code to kick-off repo
      </p>
      {info.repo?.htmlUrl && (
        <p className="mt-1 text-xs text-zinc-500">
          Target:{" "}
          <a
            href={info.repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 underline"
          >
            {info.repo.name ?? info.repo.htmlUrl}
          </a>
        </p>
      )}
      {!info.hasToken && (
        <p className="mt-2 text-xs text-amber-800">
          Set <code className="rounded bg-amber-100 px-1">GITHUB_TOKEN</code>{" "}
          (or{" "}
          <code className="rounded bg-amber-100 px-1">
            PROJECT_KICKOFF_GITHUB_TOKEN
          </code>
          ) in <code className="rounded bg-amber-100 px-1">.env.local</code> on
          the machine running the app, then click Push.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pushing || !info.hasToken}
          onClick={handlePush}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pushing ? "Pushing…" : `Push ${codeOutputDir} → GitHub`}
        </button>
        <span className="text-[11px] text-zinc-400">
          Clones the kick-off repo, copies your output folder, commits, and
          pushes.
        </span>
      </div>
      {message && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-[11px] whitespace-pre-wrap text-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
          {message}
        </pre>
      )}
    </div>
  );
}
