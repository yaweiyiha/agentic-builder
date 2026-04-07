import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';

type EditPostModalProps = {
  isOpen: boolean;
  initialContent: string;
  onClose: () => void;
  onSave: (updatedContent: string) => void;
};

const MAX_LENGTH = 1000;

export default function EditPostModal({
  isOpen,
  initialContent,
  onClose,
  onSave,
}: EditPostModalProps) {
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setContent(initialContent);
      setError('');
    }
  }, [isOpen, initialContent]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = content.trim();

    if (!trimmed) {
      setError('Post content cannot be empty.');
      return;
    }

    if (trimmed.length > MAX_LENGTH) {
      setError(`Post content must be ${MAX_LENGTH} characters or fewer.`);
      return;
    }

    onSave(trimmed);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b]/50 p-[16px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-post-title"
    >
      <div className="w-full max-w-[560px] rounded-[6px] bg-[#ffffff] p-[16px] font-['Arial',sans-serif] text-[#18181b] shadow-lg">
        <div className="mb-[16px] flex items-center justify-between">
          <h2 id="edit-post-title" className="text-[20px] font-semibold text-[#18181b]">
            Edit Post
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit post dialog"
            className="rounded-[6px] p-[8px] text-[#18181b] transition hover:bg-[#2563eb]/10"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-[8px]">
          <label htmlFor="edit-post-input" className="text-[14px] font-medium text-[#18181b]">
            Update your reply
          </label>
          <textarea
            id="edit-post-input"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-[120px] w-full rounded-[6px] border border-[#18181b]/20 px-[8px] py-[8px] text-[14px] text-[#18181b] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            maxLength={MAX_LENGTH}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'edit-post-error' : 'edit-post-help'}
          />
          {error ? (
            <p id="edit-post-error" className="text-[13px] text-red-600">
              {error}
            </p>
          ) : (
            <p id="edit-post-help" className="text-[12px] text-[#18181b]/70">
              {content.length}/{MAX_LENGTH}
            </p>
          )}

          <div className="mt-[8px] flex items-center justify-end gap-[8px]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] border border-[#18181b]/20 bg-[#ffffff] px-[16px] py-[8px] text-[14px] font-medium text-[#18181b] transition hover:bg-[#18181b]/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-[6px] bg-[#2563eb] px-[16px] py-[8px] text-[14px] font-medium text-[#ffffff] transition hover:brightness-95 active:brightness-90"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
