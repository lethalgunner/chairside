import type { Metadata } from 'next';
import './globals.css';
import NavWatchdog from '@/components/NavWatchdog';

export const metadata: Metadata = {
  title: 'Chairside',
  description: 'Clinic books for dental practices',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <NavWatchdog />
        {children}
      </body>
    </html>
  );
}
