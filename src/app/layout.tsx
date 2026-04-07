import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/components/AppNav";

export const metadata: Metadata = {
  title: "Agentic Builder",
  description: "AI-powered desktop application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="font-sans antialiased min-h-screen bg-[var(--background)] text-[var(--foreground)]"
      >
        <AppNav />
        {children}
      </body>
    </html>
  );
}
