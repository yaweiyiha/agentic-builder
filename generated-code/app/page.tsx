'use client';

import { useEffect, useState } from 'react';

type HealthState = {
  statusCode: number | null;
  statusText: string;
  error: string | null;
};

export default function Page() {
  const [health, setHealth] = useState<HealthState>({
    statusCode: null,
    statusText: 'Checking...',
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health', {
          method: 'GET',
          signal: controller.signal,
        });

        setHealth({
          statusCode: response.status,
          statusText: response.statusText || 'OK',
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setHealth({
          statusCode: null,
          statusText: 'Request failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    void checkHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[#ffffff] text-[#18181b] font-[Arial,sans-serif] p-[1rem]">
      <div className="mx-auto w-full max-w-[720px] flex flex-col gap-[0.5rem]">
        <h1 className="text-[2rem] font-bold">Browser-Based Forum System</h1>

        <p className="text-[1rem]">
          API Health:{' '}
          <span className="font-semibold text-[#2563eb]">
            {health.statusCode !== null
              ? `${health.statusCode} ${health.statusText}`
              : health.statusText}
          </span>
        </p>

        {health.error ? (
          <p className="text-[0.875rem] text-red-600">{health.error}</p>
        ) : null}
      </div>
    </main>
  );
}
