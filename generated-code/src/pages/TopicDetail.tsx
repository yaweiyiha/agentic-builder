import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import RepliesList, { Reply } from '../components/RepliesList';
import ReplyInput from '../components/ReplyInput';

interface TopicRecord {
  id: string;
  title: string;
  replies: Reply[];
}

const STORAGE_KEY = 'forum_topics';

export default function TopicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<TopicRecord | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const topics: TopicRecord[] = raw ? JSON.parse(raw) : [];
    const found = topics.find((item) => item.id === id) ?? null;
    setTopic(found);
  }, [id]);

  const topicTitle = useMemo(() => topic?.title ?? 'Topic', [topic]);

  const persistTopic = (nextTopic: TopicRecord) => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const topics: TopicRecord[] = raw ? JSON.parse(raw) : [];
    const updatedTopics = topics.map((item) => (item.id === nextTopic.id ? nextTopic : item));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTopics));
    setTopic(nextTopic);
  };

  const handleSubmitReply = (content: string) => {
    if (!topic) return;

    const nextReply: Reply = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
    };

    const nextTopic: TopicRecord = {
      ...topic,
      replies: [...topic.replies, nextReply],
    };

    persistTopic(nextTopic);
  };

  const handleEditReply = (replyId: string, newContent: string) => {
    if (!topic) return;

    const nextTopic: TopicRecord = {
      ...topic,
      replies: topic.replies.map((reply) =>
        reply.id === replyId ? { ...reply, content: newContent } : reply,
      ),
    };

    persistTopic(nextTopic);
  };

  const handleDeleteReply = (replyId: string) => {
    if (!topic) return;

    const nextTopic: TopicRecord = {
      ...topic,
      replies: topic.replies.filter((reply) => reply.id !== replyId),
    };

    persistTopic(nextTopic);
  };

  if (!id) {
    return (
      <main className="min-h-screen bg-[#ffffff] p-[1rem] font-[Arial,sans-serif] text-[#18181b]">
        <div className="mx-auto max-w-[48rem] rounded-[0.375rem] border border-[#e4e4e7] p-[1rem]">
          <p className="text-[1rem]">Invalid topic ID.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-[0.5rem] rounded-[0.375rem] bg-[#2563eb] px-[1rem] py-[0.5rem] text-[#ffffff]"
          >
            Go Home
          </button>
        </div>
      </main>
    );
  }

  if (!topic) {
    return (
      <main className="min-h-screen bg-[#ffffff] p-[1rem] font-[Arial,sans-serif] text-[#18181b]">
        <div className="mx-auto max-w-[48rem] rounded-[0.375rem] border border-[#e4e4e7] p-[1rem]">
          <p className="text-[1rem]">Topic not found.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-[0.5rem] rounded-[0.375rem] bg-[#2563eb] px-[1rem] py-[0.5rem] text-[#ffffff]"
          >
            Back to Topics
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#ffffff] font-[Arial,sans-serif] text-[#18181b]">
      <div className="mx-auto flex min-h-screen w-full max-w-[48rem] flex-col gap-[1rem] p-[1rem]">
        <header className="flex items-center justify-between rounded-[0.375rem] border border-[#e4e4e7] bg-[#ffffff] p-[1rem]">
          <h1 className="text-[1.25rem] font-semibold text-[#18181b]">{topicTitle}</h1>
          <Link
            to="/"
            className="rounded-[0.375rem] border border-[#d4d4d8] px-[0.75rem] py-[0.5rem] text-[0.875rem] font-medium text-[#18181b] hover:bg-[#f4f4f5]"
          >
            Back
          </Link>
        </header>

        <section className="flex-1">
          <RepliesList
            replies={topic.replies}
            onEditReply={handleEditReply}
            onDeleteReply={handleDeleteReply}
          />
        </section>

        <footer className="sticky bottom-0 bg-[#ffffff] pb-[0.5rem]">
          <ReplyInput onSubmitReply={handleSubmitReply} />
        </footer>
      </div>
    </main>
  );
}
