import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';
import Header from '../components/Header';
import TopicList, { TopicListItem } from '../components/TopicList';

const TOPICS_STORAGE_KEY = 'forum_topics';

const Home: React.FC = () => {
  const [topics, setTopics] = useState<TopicListItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    const raw = localStorage.getItem(TOPICS_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as TopicListItem[];
      if (Array.isArray(parsed)) {
        setTopics(parsed);
      }
    } catch {
      localStorage.removeItem(TOPICS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(TOPICS_STORAGE_KEY, JSON.stringify(topics));
  }, [topics]);

  const sortedTopics = useMemo(
    () =>
      [...topics].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [topics]
  );

  const handleOpenDialog = () => {
    setValidationError('');
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setValidationError('');
    setTitle('');
  };

  const handleCreateTopic = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      setValidationError('Topic title must be at least 3 characters long.');
      return;
    }

    const newTopic: TopicListItem = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      createdAt: new Date().toISOString(),
    };

    setTopics((prev) => [newTopic, ...prev]);
    handleCloseDialog();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] text-[#18181b] [font-family:Arial,sans-serif]">
      <Header title="Browser-Based Forum" />

      <main className="mx-auto w-full max-w-[64rem] flex-1 px-[1rem] py-[1rem] md:px-[1.5rem] md:py-[1.5rem]">
        <TopicList topics={sortedTopics} />
      </main>

      <Footer onCreateTopic={handleOpenDialog} />

      {isDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b]/50 p-[1rem]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-topic-title"
        >
          <div className="w-full max-w-[32rem] rounded-[0.375rem] bg-[#ffffff] p-[1rem] shadow-lg md:p-[1.5rem]">
            <h2
              id="create-topic-title"
              className="text-[1.125rem] font-semibold text-[#18181b]"
            >
              Create New Topic
            </h2>

            <form onSubmit={handleCreateTopic} className="mt-[1rem] flex flex-col gap-[1rem]">
              <div className="flex flex-col gap-[0.25rem]">
                <label htmlFor="topic-title" className="text-[0.9rem] font-medium text-[#18181b]">
                  Topic Title
                </label>
                <input
                  id="topic-title"
                  name="topicTitle"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter a topic title..."
                  className="rounded-[0.375rem] border border-[#d4d4d8] px-[0.75rem] py-[0.5rem] text-[0.95rem] text-[#18181b] outline-none transition-colors placeholder:text-[#71717a] focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                  aria-invalid={validationError ? 'true' : 'false'}
                  aria-describedby={validationError ? 'topic-error' : undefined}
                />
                {validationError ? (
                  <p id="topic-error" className="text-[0.8rem] text-[#dc2626]">
                    {validationError}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-[0.5rem]">
                <button
                  type="button"
                  onClick={handleCloseDialog}
                  className="rounded-[0.375rem] border border-[#d4d4d8] px-[1rem] py-[0.5rem] text-[0.9rem] text-[#18181b] transition-colors hover:bg-[#f4f4f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-[0.375rem] bg-[#2563eb] px-[1rem] py-[0.5rem] text-[0.9rem] font-medium text-[#ffffff] transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
                >
                  Create Topic
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
