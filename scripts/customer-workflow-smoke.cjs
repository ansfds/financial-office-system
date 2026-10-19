// Destructive integration tests: this runner hard-codes and verifies an isolated loopback DB.
const env = require('./local-review-env.cjs');
const { PrismaClient } = require('@prisma/client');
const assert = require('node:assert/strict');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3000';
const results = [];
let cookie;
function pass(name) {
  results.push(name);
  console.log('PASS ' + name);
}
async function api(url, data, method = 'POST', auth = cookie, origin = base) {
  const response = await fetch(base + url, {
    method,
    headers: {
      ...(auth ? { cookie: auth } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      Origin: origin,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
async function success(url, data, method = 'POST') {
  const r = await api(url, data, method);
  assert(r.status < 300, `${url}: ${r.status} ${r.body?.error || ''}`);
  return r.body;
}
async function login(username, password) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function trigger(name, table, timing) {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate_test_failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE ${timing} ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}_fn()`,
  );
}
async function dropTrigger(name, table) {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}_fn()`);
}
async function main() {
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).port, '55432');
  await dropTrigger('test_backup_failure', 'DeletedItem');
  await dropTrigger('test_reset_failure', 'Person');
  await db.auditLog.deleteMany({ where: { action: 'RESET_PASSWORD_CHECK' } });
  cookie = await login('ANS', env.USER_ANS_PASSWORD);
  const staffCookie = await login('Hossam', env.USER_HOSSAM_PASSWORD);
  assert.equal(
    (await api('/api/admin/reset-system', { step: 'verify', resetPassword: 'wrong' }, 'POST', null)).status,
    401,
  );
  assert.equal(
    (await api('/api/admin/reset-system', { step: 'verify', resetPassword: 'wrong' }, 'POST', staffCookie))
      .status,
    403,
  );
  assert.equal(
    (
      await api(
        '/api/admin/reset-system',
        { step: 'verify', resetPassword: env.RESET_SYSTEM_PASSWORD },
        'POST',
        cookie,
        'https://other.invalid',
      )
    ).status,
    403,
  );
  assert.equal(
    (await api('/api/admin/reset-system', { step: 'verify', resetPassword: 'wrong' })).status,
    403,
  );
  pass('reset authentication, admin scope, CSRF and wrong-password rejection');
  const usd = await db.currency.findUniqueOrThrow({ where: { code: 'USD' } });
  const lyd = await db.currency.findUniqueOrThrow({ where: { code: 'LYD' } });
  const suffix = Date.now();
  const person = await success('/api/people', {
    fullName: 'زبون اختبار ' + suffix,
    phone: '091' + suffix,
    phoneSecondary: '092' + suffix,
  });
  const duplicate = await api('/api/people', { fullName: 'اسم آخر', phone: '091 ' + suffix });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.duplicate.id, person.id);
  const search = await success(
    '/api/people?q=' + encodeURIComponent(person.phoneSecondary),
    undefined,
    'GET',
  );
  assert(search.some((p) => p.id === person.id));
  pass('customer creation, optional secondary phone, duplicate prevention and secondary-phone search');
  async function batch(count, receivedAt) {
    return success('/api/inventory/received-cards', {
      personId: person.id,
      receivedAt,
      cardCount: count,
      agreedAmountPerCard: 1800,
      cards: Array.from({ length: count }, (_, i) => ({
        cardLast4: String(4354 + i),
        valueUsd: 2000,
        agreedAmount: 1800,
        currencyId: i % 2 ? lyd.id : usd.id,
        status: 'RECEIVED',
      })),
    });
  }
  const first = await batch(4, '2026-10-18T12:00:00Z');
  const second = await batch(3, '2026-10-19T12:00:00Z');
  await batch(3, '2026-10-20T12:00:00Z');
  assert(first.entryTransactionId);
  assert.equal(first.cards.length, 4);
  const detail = await success('/api/people/' + person.id, undefined, 'GET');
  assert.equal(detail.cardBatches.length, 3);
  assert.equal(detail.cardBatches[1].id, second.id);
  assert.equal(detail.cardBatches[2].cards.length, 4);
  const invalid = await api('/api/inventory/received-cards', {
    personId: person.id,
    cardCount: 1,
    agreedAmountPerCard: 1800,
    cards: [{ cardLast4: '1234567890123456', valueUsd: 2000, agreedAmount: 1800, currencyId: usd.id }],
  });
  assert.equal(invalid.status, 400);
  assert(!JSON.stringify(first).includes('cardImage'));
  pass(
    'three independent batches, ten cards, newest-first history, strict last-four validation and no image payload',
  );
  const cardId = first.cards[0].id;
  for (let i = 0; i < 3; i++)
    await success(`/api/inventory/received-cards/${cardId}/operations`, {
      operationType: 'INVOICE',
      amount: 500,
    });
  let card = (await success('/api/people/' + person.id, undefined, 'GET')).cardBatches
    .find((b) => b.id === first.id)
    .cards.find((c) => c.id === cardId);
  assert.equal(card.operations.length, 3);
  assert.equal(Number(card.totalDeducted), 1500);
  assert.equal(Number(card.remainingAmount), 500);
  const over = await api(`/api/inventory/received-cards/${cardId}/operations`, {
    operationType: 'INVOICE',
    amount: 501,
  });
  assert.equal(over.status, 400);
  await success(`/api/inventory/received-cards/${cardId}/status`, { status: 'INSUFFICIENT_BALANCE' });
  let dashboard = await success('/api/dashboard', undefined, 'GET');
  assert(dashboard.cardStatuses.some((s) => s.status === 'INSUFFICIENT_BALANCE' && s._count >= 1));
  card = await success(`/api/inventory/received-cards/${cardId}/operations`, {
    operationType: 'FINAL_SETTLEMENT',
  });
  assert.equal(card.status, 'SETTLED');
  assert.equal(Number(card.remainingAmount), 0);
  dashboard = await success('/api/dashboard', undefined, 'GET');
  assert(dashboard.cardStatuses.some((s) => s.status === 'SETTLED' && s._count >= 1));
  const last = card.operations.find((o) => o.operationType === 'FINAL_SETTLEMENT');
  await success(`/api/inventory/received-cards/${cardId}/operations/${last.id}`, undefined, 'DELETE');
  card = (await success('/api/people/' + person.id, undefined, 'GET')).cardBatches
    .find((b) => b.id === first.id)
    .cards.find((c) => c.id === cardId);
  assert.equal(card.status, 'IN_SETTLEMENT');
  assert(Number(card.currentStage) < 5);
  pass(
    'three withdrawals of 500, overdraw rejection, automatic clearing, status counters and undo recalculation',
  );
  await success(`/api/people/${person.id}/wallet-settlements`, {
    accountType: 'DEBT',
    direction: 'ADD',
    currencyId: usd.id,
    paymentMethod: 'USD_CASH',
    amount: 75,
    reason: 'حركة اختبار',
    effectMode: 'NORMAL',
  });
  const accounts = await success('/api/people?q=' + encodeURIComponent(person.fullName), undefined, 'GET');
  assert(accounts[0].wallet.some((w) => w.debt === 75 && w.currency.code === 'USD'));
  pass('wallet movement is reflected in the same customer summary');
  const note = await success('/api/daily-notes', {
    title: 'متابعة بطاقات اليوم',
    content: 'مذكرة اختبار محفوظة',
  });
  const edited = await success(
    '/api/daily-notes/' + note.id,
    { title: note.title, content: 'تم تعديل المذكرة', updatedAt: note.updatedAt },
    'PATCH',
  );
  assert.equal(edited.content, 'تم تعديل المذكرة');
  assert.equal(
    (
      await api(
        '/api/daily-notes/' + note.id,
        { title: note.title, content: 'stale', updatedAt: note.updatedAt },
        'PATCH',
      )
    ).status,
    409,
  );
  pass('daily note create, edit, archive and concurrent-edit conflict');
  const before = (await success('/api/dashboard', undefined, 'GET')).inventory.receivedCards;
  await success('/api/people/' + person.id, undefined, 'DELETE');
  const after = (await success('/api/dashboard', undefined, 'GET')).inventory.receivedCards;
  assert.equal(before - after, 10);
  assert.equal((await api('/api/people/' + person.id, undefined, 'GET')).status, 404);
  assert.equal(
    await db.receivedCustomerCard.count({ where: { batch: { personId: person.id }, deletedAt: null } }),
    0,
  );
  assert.equal(
    await db.customerWalletSettlement.count({ where: { personId: person.id, deletedAt: null } }),
    0,
  );
  assert.equal(
    await db
      .$queryRawUnsafe(
        `SELECT count(*)::int AS count FROM "ReceivedCustomerCard" c LEFT JOIN "ReceivedCardBatch" b ON b.id=c."batchId" WHERE b.id IS NULL`,
      )
      .then((r) => r[0].count),
    0,
  );
  pass('atomic customer archive removes ten active cards and wallet records without orphans');
  const usersBefore = await db.user.count(),
    settingsBefore = await db.systemSetting.count(),
    sessionsBefore = await db.loginSession.count();
  const operationalBefore = await db.person.count();
  const verified = await success('/api/admin/reset-system', {
    step: 'verify',
    resetPassword: env.RESET_SYSTEM_PASSWORD,
  });
  assert.equal(await db.person.count(), operationalBefore);
  pass('password verification and cancelled final confirmation leave operational data intact');
  const confirm = { step: 'confirm', challenge: verified.challenge, confirmationText: 'تصفير' };
  await trigger('test_backup_failure', 'DeletedItem', 'INSERT');
  assert.equal((await api('/api/admin/reset-system', confirm)).status, 500);
  assert.equal(await db.person.count(), operationalBefore);
  await dropTrigger('test_backup_failure', 'DeletedItem');
  pass('forced backup failure prevents reset');
  await trigger('test_reset_failure', 'Person', 'DELETE');
  const notesBefore = await db.dailyNote.count();
  assert.equal((await api('/api/admin/reset-system', confirm)).status, 500);
  assert.equal(await db.person.count(), operationalBefore);
  assert.equal(await db.dailyNote.count(), notesBefore);
  await dropTrigger('test_reset_failure', 'Person');
  pass('failure after earlier deletes rolls back all data and the backup transaction');
  const reset = await success('/api/admin/reset-system', confirm);
  assert.equal(await db.person.count(), 0);
  assert.equal(await db.receivedCustomerCard.count(), 0);
  assert.equal(await db.dailyNote.count(), 0);
  assert.equal(await db.customerCardEntryTransaction.count(), 0);
  assert.equal(await db.user.count(), usersBefore);
  assert.equal(await db.systemSetting.count(), settingsBefore);
  assert.equal(await db.loginSession.count(), sessionsBefore);
  const saved = await db.deletedItem.findUniqueOrThrow({ where: { id: reset.backupSnapshotId } });
  assert(saved.snapshot.tables.person.length === operationalBefore);
  assert(saved.snapshot.tables.dailyNote.length === notesBefore);
  assert.equal((await api('/api/admin/reset-system', confirm)).status, 409);
  const emptyDashboard = await success('/api/dashboard', undefined, 'GET');
  assert.equal(emptyDashboard.people, 0);
  assert.equal(emptyDashboard.inventory.receivedCards, 0);
  pass(
    'successful reset backs up full data, zeroes counters, preserves users/settings/auth and rejects token replay',
  );
  for (let i = 0; i < 3; i++)
    await api('/api/admin/reset-system', { step: 'verify', resetPassword: 'wrong' });
  assert.equal(
    (await api('/api/admin/reset-system', { step: 'verify', resetPassword: 'wrong' })).status,
    429,
  );
  pass('persistent reset password rate limiting');
  // Leave useful, explicitly labelled test data for local review.
  const review = await success('/api/people', {
    fullName: 'زبون تجريبي للمراجعة',
    phone: '0910000001',
    phoneSecondary: '0920000001',
    notes: 'بيانات محلية تجريبية فقط',
  });
  await success('/api/inventory/received-cards', {
    personId: review.id,
    cardCount: 4,
    agreedAmountPerCard: 1800,
    cards: ['4354', '4355', '4356', '4357'].map((last4, i) => ({
      cardLast4: last4,
      valueUsd: 2000,
      agreedAmount: 1800,
      currencyId: i % 2 ? lyd.id : usd.id,
      status: ['RECEIVED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE', 'CANCELLED'][i],
    })),
  });
  await success('/api/daily-notes', {
    title: 'متابعة بطاقات اليوم',
    content: 'هذه مذكرة تجريبية للمراجعة المحلية. يمكنك تعديلها وحفظها.',
  });
  await db.auditLog.deleteMany({ where: { action: 'RESET_PASSWORD_CHECK' } });
  require('node:fs').writeFileSync(
    '.tmp/customer-workflow-results.json',
    JSON.stringify({ passed: results, reviewPersonId: review.id }, null, 2),
  );
  console.log(`Integration scenarios passed: ${results.length}`);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
