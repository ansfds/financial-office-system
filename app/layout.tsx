import './globals.css';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/ThemeProvider';

export const metadata = {
  title: 'منظومة محاسبة ( شركة الوسيط العالمي للحوالات المالية )',
  description: 'إدارة المعاملات والصندوق والمخزن والديون',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <Toaster richColors position="top-center" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
