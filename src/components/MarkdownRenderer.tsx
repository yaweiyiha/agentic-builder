"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

function createMarkdownComponents(variant: "default" | "prd"): Components {
  const isPrd = variant === "prd";

  if (isPrd) {
    return {
      h1: ({ children }) => (
        <h1 className="mb-6 border-b border-zinc-800 pb-4 text-2xl font-bold tracking-tight text-zinc-50">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mb-3 mt-10 flex items-center gap-3 text-lg font-semibold tracking-tight text-zinc-100">
          <span
            className="h-6 w-1 shrink-0 rounded-full bg-indigo-500"
            aria-hidden
          />
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="mb-2 mt-8 text-base font-semibold text-indigo-300">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          {children}
        </h4>
      ),
      p: ({ children }) => (
        <p className="mb-3 text-[15px] leading-[1.7] text-zinc-300">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="mb-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-zinc-300 marker:text-indigo-400">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="mb-4 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-zinc-300 marker:text-zinc-500">
          {children}
        </ol>
      ),
      li: ({ children }) => (
        <li className="leading-relaxed [&>p]:mb-0">{children}</li>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-zinc-100">{children}</strong>
      ),
      em: ({ children }) => <em className="text-zinc-200">{children}</em>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-400 underline decoration-indigo-500/40 underline-offset-2 transition-colors hover:text-indigo-300 hover:decoration-indigo-400"
        >
          {children}
        </a>
      ),
      code: ({ children, className }) => {
        const isBlock = className?.includes("language-");
        if (isBlock) {
          return (
            <code className="block font-mono text-xs leading-relaxed text-emerald-300">
              {children}
            </code>
          );
        }
        return (
          <code className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.8125rem] text-amber-200 ring-1 ring-zinc-700/80">
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="mb-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-inner [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5">
          {children}
        </pre>
      ),
      blockquote: ({ children }) => (
        <blockquote className="mb-4 border-l-[3px] border-indigo-500/70 bg-zinc-900/50 py-2 pl-4 pr-3 text-[15px] italic leading-relaxed text-zinc-400">
          {children}
        </blockquote>
      ),
      table: ({ children }) => (
        <div className="mb-6 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-zinc-900 [&::-webkit-scrollbar]:h-1.5">
          <table className="w-full min-w-[32rem] border-collapse text-[14px]">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="border-b border-zinc-700 bg-zinc-900/90 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {children}
        </thead>
      ),
      tbody: ({ children }) => (
        <tbody className="divide-y divide-zinc-800">{children}</tbody>
      ),
      tr: ({ children }) => (
        <tr className="transition-colors hover:bg-zinc-800/40">{children}</tr>
      ),
      th: ({ children }) => (
        <th className="px-4 py-3 font-semibold text-zinc-200">{children}</th>
      ),
      td: ({ children }) => (
        <td className="px-4 py-2.5 text-zinc-300">{children}</td>
      ),
      hr: () => (
        <hr className="my-8 border-0 border-t border-dashed border-zinc-800" />
      ),
    };
  }

  return {
    h1: ({ children }) => (
      <h1 className="mb-4 text-xl font-bold text-zinc-900">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-3 mt-6 text-lg font-semibold text-zinc-800">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-4 text-base font-semibold text-indigo-700">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-3 text-sm font-semibold text-indigo-600">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="mb-3 text-sm leading-relaxed text-zinc-600">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm text-zinc-600 marker:text-indigo-500">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed [&>p]:mb-0">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-zinc-800">{children}</strong>
    ),
    em: ({ children }) => <em className="text-zinc-700">{children}</em>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 underline decoration-indigo-300 hover:decoration-indigo-500"
      >
        {children}
      </a>
    ),
    code: ({ children, className }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <code className="block text-xs leading-relaxed text-emerald-700">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-emerald-700">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-3 border-l-2 border-indigo-400 pl-4 text-sm italic text-zinc-500">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="mb-3 overflow-x-auto rounded-lg border border-zinc-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-zinc-100 text-xs font-semibold text-zinc-600">
        {children}
      </thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-zinc-200 last:border-0">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 text-zinc-700">{children}</td>
    ),
    hr: () => <hr className="my-6 border-zinc-200" />,
  };
}

const defaultComponents = createMarkdownComponents("default");

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Richer typography for PRD review (dark, deliverable-style). */
  variant?: "default" | "prd";
}

export default function MarkdownRenderer({
  content,
  className = "",
  variant = "default",
}: MarkdownRendererProps) {
  if (!content) return null;
  const components =
    variant === "prd" ? createMarkdownComponents("prd") : defaultComponents;
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
