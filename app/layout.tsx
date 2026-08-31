import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/ThemeProvider';
import NetworkStatusIndicator from '@/components/NetworkStatusIndicator';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

const logoUrl = 'https://i.postimg.cc/k4nQr4gx/680242520-122094061526346951-872670812110961262-n.jpg';

export const metadata: Metadata = {
  title: 'منظومة الوسيط | إدارة الزبائن والبطاقات',
  description: 'منظومة عربية لإدارة الزبائن والبطاقات وحسابات لنا وعلينا',
  applicationName: 'منظومة الوسيط',
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
    icon: [{ url: '/icons/app-icon.svg' }, { url: logoUrl }],
    shortcut: [{ url: '/icons/app-icon.svg' }],
    apple: [{ url: '/icons/app-icon.svg' }],
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
