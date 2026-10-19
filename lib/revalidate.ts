import { revalidatePath } from 'next/cache';
import { canonicalAppPath } from './app-paths';

const financePaths = [
  '/',
  '/transactions',
  '/customers',
  '/cards',
  '/new-transaction',
  '/inventory',
  '/inventory/shein-cards',
  '/inventory/received-cards',
  '/reports',
  '/cashbox',
  '/settings',
  '/finance',
  '/daily-notes',
  '/reports/daily',
];

export function revalidatePaths(paths: string[] = []) {
  for (const path of new Set(paths.filter(Boolean).map(canonicalAppPath))) {
    revalidatePath(path);
  }
}

export function revalidateFinancePaths(extraPaths: string[] = []) {
  for (const path of new Set([...financePaths, ...extraPaths].map(canonicalAppPath))) {
    revalidatePath(path);
  }
  revalidatePath('/customers/[id]', 'page');
  revalidatePath('/cards/[id]', 'page');
}
