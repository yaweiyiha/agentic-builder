import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { SessionRecord } from '@pomodoro/shared-types';

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function HomePage() {
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          return 25 * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  return (
    <section className="mx-auto max-w-2xl rounded-xl bg-slate-900 p-6 text-slate-100">
      <h1 className="text-2xl font-bold">Pomodoro Timer</h1>
      <p className="mt-2 text-slate-300">Focus for 25 minutes, then take a break.</p>
      <div className="mt-6 text-6xl font-semibold">{formatTime(secondsLeft)}</div>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => setIsRunning((v) => !v)}
          className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          {isRunning ? 'Pause' : 'Start Timer'}
        </button>
        <button
          onClick={() => {
            setIsRunning(false);
            setSecondsLeft(25 * 60);
          }}
          className="rounded-md bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600"
        >
          Reset
        </button>
        <button
          onClick={() => navigate('/login')}
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
        >
          Login
        </button>
      </div>
    </section>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  return (
    <section className="mx-auto max-w-md rounded-xl bg-slate-900 p-6 text-slate-100">
      <h2 className="text-xl font-semibold">Login</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!email.includes('@')) {
            setError('Please enter a valid email address.');
            return;
          }
          if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
          }
          setError('');
          navigate('/dashboard');
        }}
      >
        <div>
          <label className="mb-1 block text-sm text-slate-300" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
          />
        </div>
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          Sign in
        </button>
      </form>
    </section>
  );
}

function DashboardPage() {
  const [expanded, setExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const sessions: SessionRecord[] = useMemo(
    () => [
      { id: 's1', type: 'work', startedAt: '2026-04-01T09:00:00.000Z', endedAt: '2026-04-01T09:25:00.000Z' },
      { id: 's2', type: 'work', startedAt: '2026-04-01T10:00:00.000Z', endedAt: '2026-04-01T10:25:00.000Z' },
      { id: 's3', type: 'break', startedAt: '2026-04-01T10:25:00.000Z', endedAt: '2026-04-01T10:30:00.000Z' }
    ],
    []
  );

  return (
    <section className="mx-auto max-w-3xl rounded-xl bg-slate-900 p-6 text-slate-100">
      <h2 className="text-xl font-semibold">Dashboard</h2>
      <div className="mt-4">
        <p className="text-slate-300">Productivity graph (weekly sessions)</p>
        <div className="mt-3 flex h-40 items-end gap-3 rounded-lg bg-slate-800 p-3">
          {[3, 4, 2, 5, 6, 4, 5].map((value, index) => (
            <div key={index} className="flex-1">
              <div
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer rounded-t-md bg-indigo-500 transition hover:bg-indigo-400"
                style={{ height: `${value * 20}px` }}
              />
              {hoveredIndex === index ? (
                <p className="mt-1 text-center text-xs text-indigo-300">{value} sessions</p>
              ) : (
                <p className="mt-1 text-center text-xs text-slate-500">Day {index + 1}</p>
              )}
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-4 rounded-md bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600"
      >
        View Details
      </button>
      {expanded ? (
        <ul className="mt-4 space-y-2">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-md bg-slate-800 p-3 text-sm">
              {session.type.toUpperCase()} • {new Date(session.startedAt).toLocaleTimeString()} -{' '}
              {new Date(session.endedAt).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SettingsPage() {
  const [workMinutes, setWorkMinutes] = useState('25');
  const [breakMinutes, setBreakMinutes] = useState('5');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [message, setMessage] = useState('');

  return (
    <section className="mx-auto max-w-md rounded-xl bg-slate-900 p-6 text-slate-100">
      <h2 className="text-xl font-semibold">Settings</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const work = Number(workMinutes);
          const rest = Number(breakMinutes);
          if (!Number.isFinite(work) || work < 1) {
            setMessage('Work duration must be at least 1 minute.');
            return;
          }
          if (!Number.isFinite(rest) || rest < 1) {
            setMessage('Break duration must be at least 1 minute.');
            return;
          }
          setMessage(`Saved: ${work} min work / ${rest} min break / sound ${soundEnabled ? 'on' : 'off'}`);
        }}
      >
        <div>
          <label className="mb-1 block text-sm text-slate-300" htmlFor="work">
            Work duration (minutes)
          </label>
          <input
            id="work"
            type="number"
            min={1}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2"
            value={workMinutes}
            onChange={(event) => setWorkMinutes(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300" htmlFor="break">
            Break duration (minutes)
          </label>
          <input
            id="break"
            type="number"
            min={1}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2"
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(event) => setSoundEnabled(event.target.checked)}
          />
          Enable sound notifications
        </label>
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          Save settings
        </button>
      </form>
    </section>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8">
      <nav className="mx-auto mb-6 flex max-w-3xl gap-4 text-sm text-slate-300">
        <Link className="hover:text-white" to="/home">
          Home
        </Link>
        <Link className="hover:text-white" to="/dashboard">
          Dashboard
        </Link>
        <Link className="hover:text-white" to="/settings">
          Settings
        </Link>
        <Link className="hover:text-white" to="/login">
          Login
        </Link>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </div>
  );
}
