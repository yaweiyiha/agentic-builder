"use client";

interface LoadingProps {
  size?: "sm" | "md" | "lg";
  text?: string;
}

const sizeMap = {
  sm: "h-4 w-4",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

export default function Loading({ size = "md", text }: LoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className={`${sizeMap[size]} rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin`}
        role="status"
        aria-label="Loading"
      />
      {text ? (
        <p className="text-sm text-[var(--muted)]">{text}</p>
      ) : null}
    </div>
  );
}
