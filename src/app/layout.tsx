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
      <body className="antialiased min-h-screen bg-(--background) text-(--foreground) flex" suppressHydrationWarning>
        <AppNav />
        <div className="flex-1 min-w-0 flex flex-col pl-60 overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
