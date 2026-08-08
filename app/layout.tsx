import './globals.css';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/ThemeProvider';

const logoUrl = 'https://i.postimg.cc/k4nQr4gx/680242520-122094061526346951-872670812110961262-n.jpg';

export const metadata = {
  title: 'منظومة الوسيط | إدارة الزبائن والبطاقات',
  description: 'منظومة عربية لإدارة الزبائن والبطاقات وحسابات لنا وعلينا',
  icons: {
    icon: [{ url: logoUrl }],
    shortcut: [{ url: logoUrl }],
    apple: [{ url: logoUrl }],
  },
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
