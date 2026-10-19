import { Prisma } from '@prisma/client';
import { jsonValue } from './system-backup';
export async function archiveCustomer(tx: Prisma.TransactionClient, id: string, username: string) {
  await tx.$executeRaw`SELECT id FROM "Person" WHERE id = ${id} FOR UPDATE`;
  const person = await tx.person.findFirst({ where: { id, deletedAt: null, status: 'ACTIVE' } });
  if (!person) throw new Error('PERSON_NOT_FOUND');
  const now = new Date();
  const cardsWhere = { batch: { personId: id }, deletedAt: null };
  const transactionIds = (
    await tx.financialTransaction.findMany({ where: { personId: id }, select: { id: true } })
  ).map((t) => t.id);
  const cards = await tx.receivedCustomerCard.updateMany({ where: cardsWhere, data: { deletedAt: now } });
  await tx.receivedCardOperation.updateMany({
    where: { card: { batch: { personId: id } }, deletedAt: null },
    data: { deletedAt: now, deletedBy: username, deleteReason: 'أرشفة الزبون' },
  });
  const transactions = await tx.financialTransaction.updateMany({
    where: { id: { in: transactionIds }, deletedAt: null },
    data: { deletedAt: now },
  });
  await tx.transactionMovement.updateMany({
    where: { transactionId: { in: transactionIds }, deletedAt: null },
    data: { deletedAt: now },
  });
  await tx.customerCardEntryTransaction.updateMany({
    where: { personId: id },
    data: { status: 'CANCELLED' },
  });
  for (const model of [
    'customerWalletSettlement',
    'customerCardDelivery',
    'customerAccountRepayment',
  ] as const) {
    await (tx[model] as any).updateMany({
      where: { personId: id, deletedAt: null },
      data: { deletedAt: now, deletedBy: username, deleteReason: 'أرشفة الزبون' },
    });
  }
  await tx.person.update({ where: { id }, data: { deletedAt: now, status: 'ARCHIVED' } });
  await tx.deletedItem.create({ data: { entityType: 'Person', entityId: id, snapshot: jsonValue(person) } });
  await tx.auditLog.create({
    data: {
      action: 'PERSON_ARCHIVE_CASCADE',
      username,
      entityType: 'Person',
      entityId: id,
      description: 'أرشفة الزبون وبياناته التشغيلية مع حفظ السجل المالي التاريخي',
      newValue: { cards: cards.count, transactions: transactions.count },
    },
  });
  return { success: true, cards: cards.count, transactions: transactions.count };
}
