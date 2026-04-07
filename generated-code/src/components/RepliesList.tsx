import { FormEvent, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

export interface Reply {
  id: string;
  content: string;
  createdAt: string;
}

interface RepliesListProps {
  replies: Reply[];
  onEditReply: (replyId: string, newContent: string) => void;
  onDeleteReply: (replyId: string) => void;
}

export default function RepliesList({ replies, onEditReply, onDeleteReply }: RepliesListProps) {
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  const [editError, setEditError] = useState('');

  const openEditDialog = (replyId: string, currentContent: string) => {
    setEditingReplyId(replyId);
    setEditedText(currentContent);
    setEditError('');
  };

  const closeEditDialog = () => {
    setEditingReplyId(null);
    setEditedText('');
    setEditError('');
  };

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingReplyId) return;

    const trimmed = editedText.trim();

    if (!trimmed) {
      setEditError('Reply cannot be empty.');
      return;
    }

    if (trimmed.length > 500) {
      setEditError('Reply must be 500 characters or fewer.');
      return;
    }

    onEditReply(editingReplyId, trimmed);
    closeEditDialog();
  };

  return (
    <section className="flex w-full flex-col gap-[0.5rem]" aria-label="Replies List">
      {replies.length === 0 ? (
        <div className="rounded-[0.375rem] border border-dashed border-[#d4d4d8] bg-[#ffffff] p-[1rem] text-[1rem] text-[#18181b]">
          No replies yet. Be the first to reply.
        </div>
      ) : (
        replies.map((reply) => (
          <article
            key={reply.id}
            className="rounded-[0.375rem] border border-[#e4e4e7] bg-[#ffffff] p-[1rem]"
          >
            <p className="whitespace-pre-wrap text-[1rem] text-[#18181b]">{reply.content}</p>
            <div className="mt-[0.5rem] flex items-center justify-between gap-[0.5rem]">
              <span className="text-[0.75rem] text-[#52525b]">
                {new Date(reply.createdAt).toLocaleString()}
              </span>
              <div className="flex items-center gap-[0.25rem]">
                <button
                  type="button"
                  onClick={() => openEditDialog(reply.id, reply.content)}
                  className="inline-flex items-center gap-[0.25rem] rounded-[0.375rem] px-[0.5rem] py-[0.25rem] text-[0.875rem] font-medium text-[#2563eb] hover:bg-[#eff6ff]"
                  aria-label={`Edit reply ${reply.id}`}
                >
                  <Pencil className="h-[0.875rem] w-[0.875rem]" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteReply(reply.id)}
                  className="inline-flex items-center gap-[0.25rem] rounded-[0.375rem] px-[0.5rem] py-[0.25rem] text-[0.875rem] font-medium text-[#dc2626] hover:bg-[#fef2f2]"
                  aria-label={`Delete reply ${reply.id}`}
                >
                  <Trash2 className="h-[0.875rem] w-[0.875rem]" />
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))
      )}

      {editingReplyId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b]/40 p-[1rem]"
          role="dialog"
          aria-modal="true"
          aria-label="Edit reply dialog"
        >
          <div className="w-full max-w-[32rem] rounded-[0.375rem] bg-[#ffffff] p-[1rem] shadow-lg">
            <h3 className="text-[1rem] font-semibold text-[#18181b]">Edit Reply</h3>
            <form onSubmit={handleEditSubmit} className="mt-[0.5rem] flex flex-col gap-[0.5rem]">
              <textarea
                value={editedText}
                onChange={(event) => {
                  setEditedText(event.target.value);
                  if (editError) setEditError('');
                }}
                className="min-h-[7rem] w-full rounded-[0.375rem] border border-[#d4d4d8] p-[0.5rem] text-[1rem] text-[#18181b] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                aria-label="Edit reply input"
              />
              {editError && <p className="text-[0.875rem] text-[#dc2626]">{editError}</p>}
              <div className="flex justify-end gap-[0.5rem]">
                <button
                  type="button"
                  onClick={closeEditDialog}
                  className="rounded-[0.375rem] border border-[#d4d4d8] px-[1rem] py-[0.5rem] text-[0.875rem] font-medium text-[#18181b] hover:bg-[#f4f4f5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-[0.375rem] bg-[#2563eb] px-[1rem] py-[0.5rem] text-[0.875rem] font-semibold text-[#ffffff] hover:bg-[#1d4ed8]"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
