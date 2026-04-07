'use client';

import { useEffect, useState } from 'react';

export default function Page() {
  const [status, setStatus] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        setState('loading');
        const response = await fetch('/api/health', { method: 'GET' });

        if (!isMounted) return;

        setStatus(response.status);

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const data = (await response.json()) as { message?: string; status?: string };
          setMessage(data.message ?? data.status ?? '');
        } else {
          const text = await response.text();
          setMessage(text);
        }

        setState(response.ok ? 'success' : 'error');
      } catch (error) {
        if (!isMounted) return;
        setState('error');
        setMessage(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    checkHealth();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#ffffff] text-[#18181b] flex flex-col items-center justify-center gap-[1rem] p-[1rem] font-['Arial',sans-serif]">
      <h1 className="text-[2rem] font-semibold">Pomodoro Timer</h1>

      <section className="w-full max-w-[32rem] rounded-[0.375rem] border border-[#18181b]/10 p-[1rem]">
        <p className="text-[1rem]">
          API Health Check:{' '}
          <span className="font-semibold text-[#2563eb]">
            {state === 'loading' ? 'Loading...' : status ?? 'N/A'}
          </span>
        </p>
        {message ? <p className="mt-[0.5rem] text-[0.875rem]">{message}</p> : null}
      </section>
    </main>
  );
}
