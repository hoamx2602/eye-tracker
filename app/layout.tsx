import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Precision Eye Tracker',
  description: 'Web-based eye tracking with MediaPipe and calibration',
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
