import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroCommerce Storefront",
  description: "Next-Gen B2B2C Headless Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-primary-bg text-primary-text antialiased">
        {children}
      </body>
    </html>
  );
}
