import { revalidatePath } from 'next/cache';

const financePaths = [
  '/dashboard',
  '/transactions',
  '/people',
  '/cards',
  '/new-transaction',
  '/inventory',
  '/inventory/shein-cards',
  '/inventory/received-cards',
  '/reports',
  '/cashbox',
  '/settings',
  '/accounts',
  '/daily-notes',
  '/reports/daily',
];

export function revalidatePaths(paths: string[] = []) {
  for (const path of new Set(paths.filter(Boolean))) {
    revalidatePath(path);
  }
}

export function revalidateFinancePaths(extraPaths: string[] = []) {
  for (const path of new Set([...financePaths, ...extraPaths])) {
    revalidatePath(path);
  }
  revalidatePath('/people/[id]', 'page');
  revalidatePath('/cards/[id]', 'page');
}
