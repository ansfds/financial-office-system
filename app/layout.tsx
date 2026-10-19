import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/ThemeProvider';
import NetworkStatusIndicator from '@/components/NetworkStatusIndicator';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

const logoUrl = '/brand/elwaseet-logo-reference.jpg';

function metadataBaseUrl() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBaseUrl(),
  title: 'الوسيط العالمي | للدفع الإلكتروني والحوالات',
  description: 'حلول مالية متكاملة للدفع والتحويل وشراء العملات والخدمات الإلكترونية محليًا ودوليًا.',
  applicationName: 'الوسيط العالمي',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'الوسيط العالمي',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: logoUrl }, { url: '/icons/app-icon.svg' }],
    shortcut: [{ url: '/icons/app-icon.svg' }],
    apple: [{ url: logoUrl }],
  },
  openGraph: {
    title: 'الوسيط العالمي للدفع الإلكتروني والحوالات',
    description: 'خدمات دفع وتحويل وشراء عملات رقمية وفواتير عالمية بهوية مالية موثوقة.',
    locale: 'ar_LY',
    type: 'website',
    images: [{ url: logoUrl }],
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
