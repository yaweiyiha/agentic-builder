import type { Metadata } from 'next';
import './globals.css'; // Assuming this contains Tailwind directives

export const metadata: Metadata = {
  title: 'Pomodoro Productivity Tracker',
  description: 'Enhance your focus and track productivity with the Pomodoro Technique.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Applying font-base from design tokens. Tailwind's default sans-serif is often similar to Arial. */}
      {/* Using a slightly off-white for the body background to provide subtle contrast with pure white elements. */}
      <body className="font-['Arial',sans-serif] bg-[#f8fafc] text-[#18181b]">
        {children}
      </body>
    </html>
  );
}
