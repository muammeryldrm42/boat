import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ghost Galleon',
  description: 'An original spectral galleon rendered with three.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
