import React from 'react';

interface FooterProps {
  onCreateTopic: () => void;
}

const Footer: React.FC<FooterProps> = ({ onCreateTopic }) => {
  return (
    <footer className="w-full border-t border-[#e4e4e7] bg-[#ffffff] px-[1rem] py-[1rem] md:px-[1.5rem]">
      <div className="mx-auto flex w-full max-w-[64rem] justify-end">
        <button
          type="button"
          onClick={onCreateTopic}
          className="rounded-[0.375rem] bg-[#2563eb] px-[1rem] py-[0.5rem] text-[0.95rem] font-medium text-[#ffffff] transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 [font-family:Arial,sans-serif]"
          aria-label="Create new topic"
        >
          Create New Topic
        </button>
      </div>
    </footer>
  );
};

export default Footer;
