import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createTopic, loadForumData, saveForumData } from "../lib/storage";
import type { Topic } from "../types/forum";

export default function HomePage() {
  const [topics, setTopics] = useState<Topic[]>(() => loadForumData().topics);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [secondsOpen, setSecondsOpen] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setSecondsOpen((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, []);

  const sortedTopics = useMemo(
    () =>
      [...topics].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [topics]
  );

  const handleCreateTopic = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextBody = body.trim();

    if (!nextTitle || !nextBody) {
      setError("Title and description are required.");
      return;
    }

    const newTopic = createTopic(nextTitle, nextBody);
    const nextTopics = [newTopic, ...topics];
    const data = loadForumData();
    saveForumData({ ...data, topics: nextTopics });

    setTopics(nextTopics);
    setTitle("");
    setBody("");
    setError("");
    setShowForm(false);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Browser Forum</h1>
          <p className="text-sm text-slate-600">
            Session active for {secondsOpen}s
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? "Close" : "Create New Topic"}
        </button>
      </header>

      {showForm && (
        <form
          onSubmit={handleCreateTopic}
          className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <label htmlFor="topic-title" className="mb-1 block text-sm font-medium">
              Topic title
            </label>
            <input
              id="topic-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="Enter title"
            />
          </div>
          <div>
            <label htmlFor="topic-body" className="mb-1 block text-sm font-medium">
              Description
            </label>
            <textarea
              id="topic-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="Write details"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Save Topic
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        {sortedTopics.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-600">
            No topics yet. Create one to start the discussion.
          </p>
        ) : (
          sortedTopics.map((topic) => (
            <Link
              key={topic.id}
              to={`/topic/${topic.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm"
            >
              <h2 className="font-semibold text-slate-900">{topic.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{topic.body}</p>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
