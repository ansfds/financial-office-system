import Page from '@/components/Page';
import TransactionsClient from '@/components/TransactionsClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const pageSize = 50;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const params = await searchParams;
  const page = Math.max(Number(params.page || 1), 1);
  const q = params.q?.trim() || '';
  const where = {
    deletedAt: null,
    OR: q
      ? [
          { number: { contains: q, mode: 'insensitive' as const } },
          { description: { contains: q, mode: 'insensitive' as const } },
          { executionType: { contains: q, mode: 'insensitive' as const } },
          { customType: { contains: q, mode: 'insensitive' as const } },
          { notes: { contains: q, mode: 'insensitive' as const } },
          { txId: { contains: q, mode: 'insensitive' as const } },
          { person: { fullName: { contains: q, mode: 'insensitive' as const } } },
          { person: { customerNo: { contains: q, mode: 'insensitive' as const } } },
        ]
      : undefined,
  };
  const [transactions, total] = await Promise.all([
    db.financialTransaction.findMany({
      where,
      select: {
        id: true,
        number: true,
        personId: true,
        typeId: true,
        customType: true,
        description: true,
        executionType: true,
        operationKind: true,
        operationDetails: true,
        agreedAmount: true,
        receivedAmount: true,
        paidAmount: true,
        bankName: true,
        verificationReceived: true,
        secureInternalNote: true,
        notes: true,
        status: true,
        transactionAt: true,
        sheinPaymentMethod: true,
        person: { select: { id: true, fullName: true, customerNo: true } },
        currency: { select: { id: true, code: true, name: true, symbol: true } },
        type: { select: { id: true, name: true } },
      },
      orderBy: { transactionAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.financialTransaction.count({ where }),
  ]);

  return (
    <Page title="جميع المعاملات">
      <TransactionsClient
        initialTransactions={JSON.parse(JSON.stringify(transactions))}
        initialPage={page}
        initialTotal={total}
        pageSize={pageSize}
        initialQuery={q}
      />
    </Page>
  );
}
