import Page from '@/components/Page';
import TransactionsClient from '@/components/TransactionsClient';
import { db } from '@/lib/db';

export default async function TransactionsPage() {
  const transactions = await db.financialTransaction.findMany({
    where: { deletedAt: null },
    include: { person: true, currency: true, type: true },
    orderBy: { transactionAt: 'desc' },
    take: 300,
  });

  return (
    <Page title="جميع المعاملات">
      <TransactionsClient initialTransactions={JSON.parse(JSON.stringify(transactions))} />
    </Page>
  );
}
