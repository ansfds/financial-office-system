import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'منظومة الوسيط لإدارة الزبائن والبطاقات',
    short_name: 'الوسيط',
    description: 'منظومة مالية عربية لإدارة الزبائن والبطاقات والحسابات.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f6f8fb',
    theme_color: '#2563eb',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      {
        src: '/icons/app-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/app-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
