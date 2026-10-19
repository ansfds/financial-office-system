import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'منظومة الوسيط',
    short_name: 'الوسيط',
    description: 'منظومة إدارة الزبائن والبطاقات والحسابات',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#031124',
    theme_color: '#0b4bd8',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      {
        src: '/brand/elwaseet-logo-reference.jpg',
        sizes: '800x800',
        type: 'image/jpeg',
        purpose: 'any',
      },
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
