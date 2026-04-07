type DeletePostButtonProps = {
  onDelete: () => void;
  isOwner: boolean;
  confirmMessage?: string;
};

export default function DeletePostButton({
  onDelete,
  isOwner,
  confirmMessage = 'Are you sure you want to delete this post? This action cannot be undone.',
}: DeletePostButtonProps) {
  const handleDeleteClick = () => {
    if (!isOwner) return;

    const confirmed = window.confirm(confirmMessage);
    if (confirmed) {
      onDelete();
    }
  };

  return (
    <button
      type="button"
      onClick={handleDeleteClick}
      disabled={!isOwner}
      aria-label={isOwner ? 'Delete post' : 'Only the author can delete this post'}
      className="rounded-[6px] border border-[#18181b]/20 bg-[#ffffff] px-[8px] py-[4px] text-[13px] font-medium text-[#18181b] transition hover:bg-[#18181b]/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Delete
    </button>
  );
}
