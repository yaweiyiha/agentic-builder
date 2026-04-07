import React from 'react';

interface HeaderProps {
  title?: string;
}

const Header: React.FC<HeaderProps> = ({ title = 'Browser Forum' }) => {
  return (
    <header className="w-full border-b border-[#e4e4e7] bg-[#ffffff] px-[1rem] py-[1rem] md:px-[1.5rem]">
      <div className="mx-auto w-full max-w-[64rem]">
        <h1 className="text-[1.5rem] font-semibold leading-[1.2] text-[#18181b] [font-family:Arial,sans-serif]">
          {title}
        </h1>
      </div>
    </header>
  );
};

export default Header;
