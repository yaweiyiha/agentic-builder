import { Link, Route, Routes } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
      <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
    </Routes>
  )
}

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-gray-900">Welcome</h1>
        <p className="mt-2 text-sm text-gray-600">
          M-Tier · React + Vite + Express Monorepo
        </p>
        <nav className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/dashboard"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Open dashboard
          </Link>
          <Link
            to="/settings"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Open settings
          </Link>
        </nav>
      </div>
    </div>
  )
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">
          This route is ready. Replace with real page content.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}

export default App
