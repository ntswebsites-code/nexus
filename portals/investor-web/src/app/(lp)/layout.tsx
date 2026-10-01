import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Geist_Mono, Inter, Montserrat } from 'next/font/google';
import { Toaster } from 'sonner';
import { ORG_LOGO_PATH, ORG_NAME } from '@/lib/branding';
import './globals.css';

const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: `${ORG_NAME} | LP Portal`,
  description: 'Fund performance, capital activity, documents and requests for Matanho limited partners.',
  icons: { icon: ORG_LOGO_PATH, shortcut: ORG_LOGO_PATH, apple: ORG_LOGO_PATH },
};

export default function LpRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`font-sans ${montserrat.variable} ${inter.variable} ${geistMono.variable} antialiased`}>
        <Suspense fallback={null}>{children}</Suspense>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              color: 'rgba(0, 0, 0, 0.9)',
              fontWeight: '600',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
            },
            className: 'font-semibold',
          }}
        />
      </body>
    </html>
  );
}
