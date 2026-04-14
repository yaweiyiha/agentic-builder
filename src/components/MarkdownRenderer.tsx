"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
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
    <ul className="mb-3 space-y-1.5 pl-1 text-sm text-zinc-600">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-zinc-600">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="flex gap-2 leading-relaxed">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />
      <span>{children}</span>
    </li>
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

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  if (!content) return null;
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
