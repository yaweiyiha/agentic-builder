import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css'; // Ensure Tailwind CSS is imported here
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Providers from './providers'; // Import the client-side Providers component

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Policy & Claims Portal',
  description: 'Manage your policies and claims efficiently.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} flex flex-col min-h-screen`}>
        <Providers>
          <Header />
          <main className="flex-grow p-[24px] bg-[#F1F5F9]">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
