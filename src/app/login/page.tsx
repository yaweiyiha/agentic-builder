"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function LogoMark() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="white" aria-hidden>
      <path d="M6 0L12 3.5V10.5L6 14L0 10.5V3.5L6 0Z" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json()) as { ok?: boolean; message?: string };

      if (!res.ok) {
        setError(data.message ?? "Login failed. Please try again.");
        return;
      }

      // Navigate to dashboard after successful login
      router.push("/dashboard/pipeline");
      router.refresh();
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, rgb(248, 249, 255) 0%, rgb(245, 243, 255) 100%)",
      }}
    >
      {/* Background blurs */}
      <div className="pointer-events-none absolute right-[-80px] top-[-160px] w-[480px] h-[480px] rounded-full bg-[#dbeafe] blur-[60px] opacity-40" />
      <div className="pointer-events-none absolute bottom-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full bg-[#faf5ff] blur-[60px] opacity-40" />

      <div className="relative w-full max-w-[440px]">
        {/* Card */}
        <div className="bg-white/90 backdrop-blur-sm border border-[#e2e8f0] rounded-2xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.12)] p-10">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3 mb-10">
            <div className="w-12 h-12 bg-black rounded-[6px] flex items-center justify-center">
              <LogoMark />
            </div>
            <div className="text-center">
              <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[#0f172a]">
                Agentic Builder
              </h1>
              <p className="text-[13px] text-[#64748b] mt-0.5">
                Sign in to your workspace
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-[#374151]" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-10 px-3.5 rounded-lg border border-[#e2e8f0] text-[14px] text-[#0f172a] placeholder-[#94a3b8] bg-white outline-none focus:border-[#712ae2] focus:ring-2 focus:ring-[rgba(113,42,226,0.15)] transition"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-[#374151]" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 px-3.5 pr-10 rounded-lg border border-[#e2e8f0] text-[14px] text-[#0f172a] placeholder-[#94a3b8] bg-white outline-none focus:border-[#712ae2] focus:ring-2 focus:ring-[rgba(113,42,226,0.15)] transition"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-[13px] text-[#ef4444] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3.5 py-2.5">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 h-11 w-full bg-[#712ae2] hover:bg-[#5b22b8] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[15px] font-bold rounded-lg transition-colors shadow-[0_4px_12px_rgba(113,42,226,0.3)]"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          {/* Hint */}
          <p className="mt-6 text-center text-[12px] text-[#94a3b8]">
            Demo:{" "}
            <span className="font-mono text-[#475569]">admin@agentic.ai</span>
            {" / "}
            <span className="font-mono text-[#475569]">agentic2024</span>
          </p>
        </div>
      </div>
    </div>
  );
}
