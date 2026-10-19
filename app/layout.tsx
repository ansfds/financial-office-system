import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/ThemeProvider';
import NetworkStatusIndicator from '@/components/NetworkStatusIndicator';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

const logoUrl = '/brand/elwaseet-logo-reference.jpg';

export const metadata: Metadata = {
  title: 'منظومة الوسيط',
  description: 'منظومة إدارة الزبائن والبطاقات والحسابات',
  applicationName: 'منظومة الوسيط',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'منظومة الوسيط',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: logoUrl }, { url: '/icons/app-icon.svg' }],
    shortcut: [{ url: '/icons/app-icon.svg' }],
    apple: [{ url: logoUrl }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#071426' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <Toaster richColors position="top-center" />
          <NetworkStatusIndicator />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
