import { FormEvent, useState } from 'react';

interface ReplyInputProps {
  onSubmitReply: (content: string) => void;
}

export default function ReplyInput({ onSubmitReply }: ReplyInputProps) {
  const [replyText, setReplyText] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = replyText.trim();

    if (!trimmed) {
      setError('Reply cannot be empty.');
      return;
    }

    if (trimmed.length > 500) {
      setError('Reply must be 500 characters or fewer.');
      return;
    }

    onSubmitReply(trimmed);
    setReplyText('');
    setError('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-[0.5rem] rounded-[0.375rem] border border-[#e4e4e7] bg-[#ffffff] p-[1rem]"
      aria-label="Reply form"
    >
      <label htmlFor="reply-input" className="text-[0.875rem] font-medium text-[#18181b]">
        Reply
      </label>

      <div className="flex flex-col gap-[0.5rem] sm:flex-row">
        <input
          id="reply-input"
          type="text"
          value={replyText}
          onChange={(event) => {
            setReplyText(event.target.value);
            if (error) setError('');
          }}
          placeholder="Write your reply..."
          className="h-[2.5rem] w-full rounded-[0.375rem] border border-[#d4d4d8] px-[0.5rem] text-[1rem] text-[#18181b] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'reply-error' : undefined}
        />

        <button
          type="submit"
          className="h-[2.5rem] rounded-[0.375rem] bg-[#2563eb] px-[1rem] text-[1rem] font-semibold text-[#ffffff] transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Submit Reply"
          disabled={!replyText.trim()}
        >
          Submit Reply
        </button>
      </div>

      {error && (
        <p id="reply-error" className="text-[0.875rem] text-[#dc2626]">
          {error}
        </p>
      )}
    </form>
  );
}
