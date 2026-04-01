import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bradford Eye Tracking System',
  description: 'Advanced neurological eye tracking assessment platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
