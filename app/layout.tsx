import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { clerkEnabled } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = { title: 'SnapFlow', description: 'The operating system for school photography companies.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const page = (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
  if (!clerkEnabled) return page;
  const { ClerkProvider } = await import('@clerk/nextjs');
  return <ClerkProvider>{page}</ClerkProvider>;
}
