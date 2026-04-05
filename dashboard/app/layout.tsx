import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const themeBootScript = `
(() => {
  try {
    const storedTheme = localStorage.getItem('hmstx-theme');
    const theme = ['light', 'contrast', 'dark', 'forest-green', 'crimson-red', 'neon-orange', 'radiant-yellow', 'puffy-pink', 'purple-haze'].includes(storedTheme || '')
      ? storedTheme
      : 'dark';
    const storedStyle = localStorage.getItem('hmstx-style');
    const style = storedStyle === 'filesystem' ? 'filesystem' : 'classic-v2';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.style = style;
  } catch {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.style = 'classic-v2';
  }
})();
`;

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const metadataBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');

export const metadata: Metadata = {
  title: 'HmSTx',
  description: 'Operational dashboard for the Termux home server',
  manifest: `${metadataBasePath}/manifest.webmanifest` || '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3ee' },
    { media: '(prefers-color-scheme: dark)', color: '#111315' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <a href="#app-main" className="skip-link">Skip To Main Content</a>
        {children}
      </body>
    </html>
  );
}
