import { revalidatePath } from 'next/cache';

const financePaths = [
  '/dashboard',
  '/transactions',
  '/people',
  '/new-transaction',
  '/inventory',
  '/inventory/shein-cards',
  '/inventory/received-cards',
  '/reports',
  '/cashbox',
  '/settings',
];

export function revalidateFinancePaths(extraPaths: string[] = []) {
  for (const path of new Set([...financePaths, ...extraPaths])) {
    revalidatePath(path);
  }
}
