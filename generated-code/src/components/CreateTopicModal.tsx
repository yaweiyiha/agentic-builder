import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

type CreateTopicPayload = {
  title: string;
  content: string;
};

type CreateTopicModalProps = {
  /**
   * Optional controlled mode: pass isOpen + onOpenChange from parent.
   * If omitted, the component manages open/close state internally.
   */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Called when a valid topic is submitted.
   */
  onCreateTopic?: (payload: CreateTopicPayload) => void | Promise<void>;
  /**
   * Optional custom trigger label.
   */
  triggerLabel?: string;
};

export default function CreateTopicModal({
  isOpen,
  onOpenChange,
  onCreateTopic,
  triggerLabel = "Create New Topic",
}: CreateTopicModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [titleError, setTitleError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const open = useMemo(
    () => (typeof isOpen === "boolean" ? isOpen : internalOpen),
    [isOpen, internalOpen],
  );

  const setOpen = (nextOpen: boolean) => {
    if (typeof isOpen === "boolean") {
      onOpenChange?.(nextOpen);
      return;
    }
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const resetForm = () => {
    setTitle("");
    setContent("");
    setTitleError("");
  };

  const handleOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const validate = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("Topic title is required.");
      return false;
    }
    if (trimmedTitle.length < 3) {
      setTitleError("Topic title must be at least 3 characters.");
      return false;
    }
    setTitleError("");
    return true;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    try {
      setIsSubmitting(true);
      await onCreateTopic?.({
        title: title.trim(),
        content: content.trim(),
      });
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <div className="fixed bottom-[16px] left-0 right-0 mx-auto w-full max-w-[960px] px-[16px]">
        <div className="flex justify-end">
          <button
            type="button"
            aria-label="Create new topic"
            onClick={handleOpen}
            className="inline-flex items-center gap-[8px] rounded-[6px] bg-[#2563eb] px-[16px] py-[8px] font-['Arial',sans-serif] text-[16px] font-semibold text-[#ffffff] transition-colors hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-offset-2"
          >
            <Plus className="h-[16px] w-[16px]" />
            {triggerLabel}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b]/50 p-[16px]"
          role="presentation"
          onClick={handleClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-topic-title"
            className="w-full max-w-[560px] rounded-[6px] bg-[#ffffff] p-[16px] shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-[16px] flex items-center justify-between">
              <h2
                id="create-topic-title"
                className="font-['Arial',sans-serif] text-[20px] font-semibold text-[#18181b]"
              >
                Create New Topic
              </h2>
              <button
                type="button"
                aria-label="Close create topic dialog"
                onClick={handleClose}
                className="rounded-[6px] p-[4px] text-[#18181b] hover:bg-[#f4f4f5] focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-offset-2"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
              <div className="flex flex-col gap-[8px]">
                <label
                  htmlFor="topic-title"
                  className="font-['Arial',sans-serif] text-[14px] font-medium text-[#18181b]"
                >
                  Topic Title
                </label>
                <input
                  id="topic-title"
                  aria-label="Topic title input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-[6px] border border-[#d4d4d8] px-[12px] py-[8px] font-['Arial',sans-serif] text-[14px] text-[#18181b] outline-none placeholder:text-[#71717a] focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                  placeholder="Enter topic title"
                  maxLength={120}
                />
                {titleError && (
                  <p className="font-['Arial',sans-serif] text-[12px] text-[#dc2626]">
                    {titleError}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-[8px]">
                <label
                  htmlFor="topic-content"
                  className="font-['Arial',sans-serif] text-[14px] font-medium text-[#18181b]"
                >
                  Topic Details (optional)
                </label>
                <textarea
                  id="topic-content"
                  aria-label="Topic details input"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-[120px] w-full resize-y rounded-[6px] border border-[#d4d4d8] px-[12px] py-[8px] font-['Arial',sans-serif] text-[14px] text-[#18181b] outline-none placeholder:text-[#71717a] focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                  placeholder="Add more details about your topic"
                  maxLength={2000}
                />
              </div>

              <div className="flex items-center justify-end gap-[8px]">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-[6px] border border-[#d4d4d8] bg-[#ffffff] px-[16px] py-[8px] font-['Arial',sans-serif] text-[14px] font-medium text-[#18181b] hover:bg-[#f4f4f5] focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-[6px] bg-[#2563eb] px-[16px] py-[8px] font-['Arial',sans-serif] text-[14px] font-medium text-[#ffffff] hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-offset-2"
                >
                  {isSubmitting ? "Creating..." : "Create Topic"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
