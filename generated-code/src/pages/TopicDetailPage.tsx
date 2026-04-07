import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createReply, loadForumData, saveForumData } from "../lib/storage";
import type { Reply } from "../types/forum";

export default function TopicDetailPage() {
  const params = useParams<{ id: string }>();
  const topicId = params.id ?? "";
  const data = loadForumData();
  const topic = data.topics.find((t) => t.id === topicId);

  const [replies, setReplies] = useState<Reply[]>(
    () => loadForumData().replies.filter((reply) => reply.topicId === topicId)
  );
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState("");
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const sortedReplies = useMemo(
    () =>
      [...replies].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [replies]
  );

  const handleSubmitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = replyText.trim();

    if (!next) {
      setError("Reply cannot be empty.");
      return;
    }

    const newReply = createReply(topicId, next);
    const nextReplies = [...replies, newReply];
    const fullData = loadForumData();

    saveForumData({
      ...fullData,
      replies: [...fullData.replies, newReply]
    });

    setReplies(nextReplies);
    setReplyText("");
    setError("");
  };

  const handleDeleteReply = (replyId: string) => {
    const fullData = loadForumData();
    const nextAllReplies = fullData.replies.filter((r) => r.id !== replyId);
    const nextTopicReplies = replies.filter((r) => r.id !== replyId);

    saveForumData({ ...fullData, replies: nextAllReplies });
    setReplies(nextTopicReplies);
  };

  const handleStartEdit = (reply: Reply) => {
    setEditingReplyId(reply.id);
    setEditingText(reply.content);
  };

  const handleSaveEdit = (replyId: string) => {
    const nextText = editingText.trim();
    if (!nextText) return;

    const fullData = loadForumData();
    const nextAllReplies = fullData.replies.map((r) =>
      r.id === replyId ? { ...r, content: nextText } : r
    );
    const nextTopicReplies = replies.map((r) =>
      r.id === replyId ? { ...r, content: nextText } : r
    );

    saveForumData({ ...fullData, replies: nextAllReplies });
    setReplies(nextTopicReplies);
    setEditingReplyId(null);
    setEditingText("");
  };

  if (!topic) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl p-6">
        <p className="mb-4 text-slate-700">Topic not found.</p>
        <Link to="/" className="text-blue-600 hover:underline">
          Back to Topics
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-6">
      <header className="mb-6">
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          ← Back to Topics
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{topic.title}</h1>
        <p className="mt-1 text-slate-700">{topic.body}</p>
      </header>

      <section className="mb-6 space-y-3">
        <h2 className="text-lg font-semibold">Replies</h2>
        {sortedReplies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
            No replies yet.
          </p>
        ) : (
          sortedReplies.map((reply) => (
            <article key={reply.id} className="rounded-lg border border-slate-200 bg-white p-4">
              {editingReplyId === reply.id ? (
                <div className="space-y-2">
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(reply.id)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingReplyId(null);
                        setEditingText("");
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-slate-800">{reply.content}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(reply)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteReply(reply.id)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </section>

      <form onSubmit={handleSubmitReply} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <label htmlFor="reply-input" className="block text-sm font-medium">
          Add a reply
        </label>
        <input
          id="reply-input"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          placeholder="Write your reply"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Submit Reply
        </button>
      </form>
    </main>
  );
}
