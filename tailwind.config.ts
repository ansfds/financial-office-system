import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: { fontFamily: { sans: ['Arial', 'sans-serif'] }, boxShadow: { card: '0 10px 30px rgba(15,23,42,.08)' } } },
  plugins: []
} satisfies Config;
