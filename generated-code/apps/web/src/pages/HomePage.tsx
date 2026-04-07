import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Topic } from "@forum/types";

interface HomePageProps {
  topics: Topic[];
  viewerName: string;
  onViewerNameChange: (name: string) => void;
  onCreateTopic: (input: { title: string; body: string; author: string }) => string;
}

export default function HomePage({
  topics,
  viewerName,
  onViewerNameChange,
  onCreateTopic
}: HomePageProps) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState(viewerName);
  const [error, setError] = useState("");

  const openDialog = () => {
    setAuthor(viewerName);
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
    setTitle("");
    setBody("");
    setError("");
  };

  const onSubmitTopic = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const cleanAuthor = author.trim();

    if (!cleanTitle || !cleanBody || !cleanAuthor) {
      setError("Title, description, and author are required.");
      return;
    }
    if (cleanTitle.length > 120) {
      setError("Title must be 120 characters or fewer.");
      return;
    }

    const topicId = onCreateTopic({ title: cleanTitle, body: cleanBody, author: cleanAuthor });
    closeDialog();
    navigate(`/topic/${topicId}`);
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col gap-4 p-4">
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="viewerName" className="text-sm font-medium text-slate-700">
            Current user
          </label>
          <input
            id="viewerName"
            value={viewerName}
            onChange={(event) => onViewerNameChange(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            placeholder="Your display name"
          />
        </form>
      </section>

      <section className="flex-1 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Topics</h2>
        {topics.length === 0 ? (
          <p className="text-slate-600">No topics yet. Create your first discussion topic.</p>
        ) : (
          <ul className="space-y-2">
            {topics.map((topic) => (
              <li key={topic.id} className="rounded border border-slate-200 p-3">
                <Link className="text-base font-semibold text-blue-700 hover:underline" to={`/topic/${topic.id}`}>
                  {topic.title}
                </Link>
                <p className="mt-1 text-sm text-slate-700">{topic.body}</p>
                <p className="mt-1 text-xs text-slate-500">By {topic.author}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="sticky bottom-0 mt-auto">
        <button
          type="button"
          onClick={openDialog}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
        >
          Create New Topic
        </button>
      </footer>

      <dialog ref={dialogRef} className="w-[min(95vw,32rem)] rounded-lg p-0 backdrop:bg-black/40">
        <form onSubmit={onSubmitTopic} className="space-y-3 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Create Topic</h3>
          {error ? <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
          <div className="space-y-1">
            <label htmlFor="topicTitle" className="text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              id="topicTitle"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="topicBody" className="text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              id="topicBody"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-28 w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="topicAuthor" className="text-sm font-medium text-slate-700">
              Author
            </label>
            <input
              id="topicAuthor"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="flex-1 rounded bg-blue-600 px-3 py-2 text-white">
              Create
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
