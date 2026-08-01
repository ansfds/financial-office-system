import Page from '@/components/Page';
import TransactionsClient from '@/components/TransactionsClient';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const pageSize = 50;
const executionStatuses = ['PENDING', 'COMPLETED', 'NOT_EXECUTED'] as const;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; executionStatus?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(Number(params.page || 1), 1);
  const q = params.q?.trim() || '';
  const executionStatus = executionStatuses.includes(params.executionStatus as any)
    ? (params.executionStatus as (typeof executionStatuses)[number])
    : 'PENDING';
  const where = {
    deletedAt: null,
    executionStatus,
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
        executionStatus: true,
        executionNote: true,
        notExecutedAction: true,
        status: true,
        createdBy: true,
        transactionAt: true,
        sheinPaymentMethod: true,
        executionItems: {
          include: {
            customer: { select: { id: true, fullName: true, customerNo: true } },
            sheinCard: { select: { id: true, code: true, denomination: true, status: true, usedAt: true } },
            executedBy: { select: { id: true, username: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
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
        initialExecutionStatus={executionStatus}
      />
    </Page>
  );
}
