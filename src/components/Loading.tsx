"use client";

interface LoadingProps {
  size?: "sm" | "md" | "lg";
  text?: string;
}

const sizeMap = {
  sm: 32,
  md: 48,
  lg: 64,
};

export default function Loading({ size = "md", text }: LoadingProps) {
  const px = sizeMap[size];
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <img
        src="/assets/loding.svg"
        alt="Loading"
        width={px}
        height={px}
        role="status"
        aria-label="Loading"
        style={{ display: "block" }}
      />
      {text ? (
        <p className="text-sm text-(--muted)">{text}</p>
      ) : null}
    </div>
  );
}
