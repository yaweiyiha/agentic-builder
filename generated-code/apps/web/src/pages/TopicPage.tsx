import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Reply, Topic } from "@forum/types";

interface TopicPageProps {
  topics: Topic[];
  replies: Reply[];
  viewerName: string;
  onViewerNameChange: (name: string) => void;
  onCreateReply: (input: { topicId: string; content: string; author: string }) => void;
  onUpdateReply: (replyId: string, content: string) => void;
  onDeleteReply: (replyId: string) => void;
}

export default function TopicPage({
  topics,
  replies,
  viewerName,
  onViewerNameChange,
  onCreateReply,
  onUpdateReply,
  onDeleteReply
}: TopicPageProps) {
  const { id } = useParams();
  const topic = topics.find((item) => item.id === id);
  const topicReplies = useMemo(() => replies.filter((reply) => reply.topicId === id), [id, replies]);

  const [content, setContent] = useState("");
  const [author, setAuthor] = useState(viewerName);
  const [formError, setFormError] = useState("");
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState("");

  if (!topic) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4">
        <p className="rounded bg-white p-4 shadow-sm">Topic not found.</p>
        <Link to="/" className="mt-4 inline-block text-blue-700 hover:underline">
          Back to topics
        </Link>
      </main>
    );
  }

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanContent = content.trim();
    const cleanAuthor = author.trim();

    if (!cleanContent || !cleanAuthor) {
      setFormError("Reply and author are required.");
      return;
    }

    onCreateReply({ topicId: topic.id, content: cleanContent, author: cleanAuthor });
    setContent("");
    setFormError("");
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEdit = editContent.trim();

    if (!editingReplyId) return;
    if (!cleanEdit) {
      setEditError("Edited reply cannot be empty.");
      return;
    }

    onUpdateReply(editingReplyId, cleanEdit);
    setEditingReplyId(null);
    setEditContent("");
    setEditError("");
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="rounded-lg bg-white p-4 shadow-sm">
        <Link to="/" className="text-sm text-blue-700 hover:underline">
          ← Back to topics
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{topic.title}</h2>
        <p className="mt-1 text-slate-700">{topic.body}</p>
        <p className="mt-1 text-xs text-slate-500">By {topic.author}</p>
      </header>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="viewerNameTopic" className="text-sm font-medium text-slate-700">
            Current user
          </label>
          <input
            id="viewerNameTopic"
            value={viewerName}
            onChange={(event) => onViewerNameChange(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Your display name"
          />
        </form>

        <h3 className="mb-2 text-lg font-semibold text-slate-900">Replies</h3>
        {topicReplies.length === 0 ? (
          <p className="text-slate-600">No replies yet.</p>
        ) : (
          <ul className="space-y-2">
            {topicReplies.map((reply) => {
              const isOwner = reply.author.trim() === viewerName.trim();
              return (
                <li key={reply.id} className="rounded border border-slate-200 p-3">
                  <p className="text-slate-800">{reply.content}</p>
                  <p className="mt-1 text-xs text-slate-500">By {reply.author}</p>
                  {isOwner ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingReplyId(reply.id);
                          setEditContent(reply.content);
                          setEditError("");
                        }}
                        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteReply(reply.id)}
                        className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="rounded-lg bg-white p-4 shadow-sm">
        <form onSubmit={submitReply} className="space-y-2">
          {formError ? <p className="rounded bg-red-50 p-2 text-sm text-red-700">{formError}</p> : null}
          <label htmlFor="replyInput" className="text-sm font-medium text-slate-700">
            Reply
          </label>
          <textarea
            id="replyInput"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-24 w-full rounded border border-slate-300 px-3 py-2"
          />
          <div className="space-y-1">
            <label htmlFor="replyAuthor" className="text-sm font-medium text-slate-700">
              Author
            </label>
            <input
              id="replyAuthor"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Submit Reply
          </button>
        </form>
      </footer>

      {editingReplyId ? (
        <div className="fixed inset-0 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-lg">
            <form onSubmit={submitEdit} className="space-y-3">
              <h4 className="text-lg font-semibold text-slate-900">Edit Reply</h4>
              {editError ? <p className="rounded bg-red-50 p-2 text-sm text-red-700">{editError}</p> : null}
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="min-h-28 w-full rounded border border-slate-300 px-3 py-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingReplyId(null);
                    setEditContent("");
                    setEditError("");
                  }}
                  className="flex-1 rounded border border-slate-300 px-3 py-2"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 rounded bg-blue-600 px-3 py-2 text-white">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
