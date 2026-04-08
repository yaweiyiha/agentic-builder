import { Routes, Route } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-900">Welcome</h1>
              <p className="mt-2 text-gray-600">M-Tier &middot; React + Vite + Express Monorepo</p>
            </div>
          </div>
        }
      />
    </Routes>
  )
}

export default App
