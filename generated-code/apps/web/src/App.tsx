import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import TopicPage from "./pages/TopicPage";
import { loadViewerName, saveViewerName } from "./lib/storage";
import { useForumStore } from "./lib/useForumStore";

export default function App() {
  const { data, createTopic, createReply, updateReply, deleteReply } = useForumStore();
  const [viewerName, setViewerName] = useState(() => loadViewerName());
  const [secondsOpen, setSecondsOpen] = useState(0);

  useEffect(() => {
    saveViewerName(viewerName);
  }, [viewerName]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsOpen((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between p-4">
          <Link to="/" className="text-xl font-bold text-slate-900">
            Browser Forum
          </Link>
          <p className="text-xs text-slate-500">Session: {secondsOpen}s</p>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              topics={data.topics}
              viewerName={viewerName}
              onViewerNameChange={setViewerName}
              onCreateTopic={createTopic}
            />
          }
        />
        <Route
          path="/topic/:id"
          element={
            <TopicPage
              topics={data.topics}
              replies={data.replies}
              viewerName={viewerName}
              onViewerNameChange={setViewerName}
              onCreateReply={createReply}
              onUpdateReply={updateReply}
              onDeleteReply={deleteReply}
            />
          }
        />
      </Routes>
    </div>
  );
}
