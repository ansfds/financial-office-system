import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import nextEnv from '@next/env';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const prisma = new PrismaClient();
let temporarySessionId = null;
const { loadEnvConfig } = nextEnv;

function parseEnv(content) {
  const entries = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    entries[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
  return entries;
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(env) {
  const candidates = [
    ['Mohammed', env.USER_MOHAMMED_PASSWORD],
    ['Hossam', env.USER_HOSSAM_PASSWORD],
    ['ANS', env.USER_ANS_PASSWORD],
  ].filter(([, password]) => Boolean(password));

  for (const [username, password] of candidates) {
    const { response, payload } = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) continue;

    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert(cookie, 'Login succeeded but did not return a session cookie');
    return { username: payload?.username || username, cookie };
  }

  throw new Error('Unable to login with configured local users');
}

function packSessionCookie(id, expiresAt, secret) {
  const expires = expiresAt.getTime();
  const payload = `${id}.${expires}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `fos_session=${payload}.${signature}`;
}

async function createTemporarySession(env) {
  const secret = env.SESSION_SECRET || process.env.SESSION_SECRET;
  assert(secret, 'SESSION_SECRET is required for temporary smoke session');

  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { username: 'asc' },
  });
  assert(user, 'No active user found for temporary smoke session');

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await prisma.loginSession.create({
    data: {
      id,
      userId: user.id,
      username: user.username,
      expiresAt,
      ip: 'smoke-test',
      userAgent: 'codex-smoke-test',
    },
  });
  temporarySessionId = id;

  return {
    username: user.username,
    cookie: packSessionCookie(id, expiresAt, secret),
    sessionId: id,
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const testName = `اختبار Codex ${stamp}`;
  const testPhone = `091${String(startedAt).slice(-7)}`;

  let session;
  try {
    session = await login(env);
  } catch {
    session = await createTemporarySession(env);
  }
  const cookie = session.cookie;
  const steps = [];
  const okStep = (name) => steps.push({ name, ok: true });

  for (const page of ['/dashboard', '/people', '/accounts', '/audit', '/settings']) {
    const { response } = await request(page, { cookie });
    assert(response.ok, `Page ${page} failed with ${response.status}`);
  }
  okStep('protected pages');

  const settings = await request('/api/settings', { cookie });
  assert(settings.response.ok, `Settings API failed ${settings.response.status}: ${String(settings.text).slice(0, 300)}`);
  const currency =
    settings.payload.currencies.find((item) => item.code === 'USD') ||
    settings.payload.currencies.find((item) => item.code === 'LYD') ||
    settings.payload.currencies[0];
  assert(currency?.id, 'No active currency found for smoke test');
  okStep('settings and currency lookup');

  const createdPerson = await request('/api/people', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      fullName: testName,
      phone: testPhone,
      address: 'سجل اختبار آلي',
      notes: 'يتم أرشفته بعد الاختبار',
      category: 'REGULAR',
    }),
  });
  assert(createdPerson.response.status === 201, `Create person failed: ${createdPerson.text}`);
  const person = createdPerson.payload;
  okStep('create customer');

  const searchPerson = await request(`/api/people?q=${encodeURIComponent(testPhone)}`, { cookie });
  assert(searchPerson.response.ok && searchPerson.payload.some((item) => item.id === person.id), 'Customer search failed');
  okStep('search customer');

  const updatedPerson = await request(`/api/people/${person.id}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify({
      fullName: `${testName} معدل`,
      phone: testPhone,
      address: 'سجل اختبار آلي',
      notes: 'تعديل اختبار آلي',
      category: 'VIP',
    }),
  });
  assert(updatedPerson.response.ok && updatedPerson.payload.category === 'VIP', 'Update customer failed');
  okStep('update customer');

  const bulkRows = Array.from({ length: 50 }, (_, index) => ({
    cardLast4: String(7000 + index).slice(-4),
    valueUsd: 100,
    agreedAmount: 90,
    currencyId: currency.id,
    notes: 'اختبار إدخال 50 بطاقة',
  }));
  const bulkBatch = await request('/api/inventory/received-cards', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      personId: person.id,
      currencyId: currency.id,
      cardCount: bulkRows.length,
      valueUsdPerCard: 100,
      agreedAmountPerCard: 90,
      commonBankName: 'اختبار سريع',
      notes: 'دفعة اختبار 50 بطاقة',
      cards: bulkRows,
    }),
  });
  assert(bulkBatch.response.status === 201, `Create 50-card batch failed: ${bulkBatch.text}`);
  assert(bulkBatch.payload.cards?.length === 50, '50-card batch did not return 50 cards');
  await Promise.all(
    bulkBatch.payload.cards.map((bulkCard) =>
      request(`/api/inventory/received-cards/${bulkCard.id}`, {
        method: 'DELETE',
        cookie,
      }),
    ),
  );
  okStep('create and soft-delete 50-card batch');

  const batchResponse = await request('/api/inventory/received-cards', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      personId: person.id,
      currencyId: currency.id,
      cardCount: 1,
      valueUsdPerCard: 500,
      agreedAmountPerCard: 480,
      commonBankName: 'اختبار',
      notes: 'دفعة اختبار آلي',
    }),
  });
  assert(batchResponse.response.status === 201, `Create card batch failed: ${batchResponse.text}`);
  const card = batchResponse.payload.cards[0];
  assert(card?.id, 'Created batch has no card');
  okStep('create card');

  const updatedCard = await request(`/api/inventory/received-cards/${card.id}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify({
      cardLast4: '1234',
      valueUsd: 500,
      agreedAmount: 480,
      receivedAmount: 0,
      status: 'RECEIVED',
      notes: 'تعديل بطاقة اختبار',
    }),
  });
  assert(updatedCard.response.ok && updatedCard.payload.cardLast4 === '1234', 'Update card failed');
  okStep('update card');

  const advancedCard = await request(`/api/inventory/received-cards/${card.id}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify({
      stageAction: 'NEXT',
      stageAmount: 25,
      stageNote: 'سحب اختبار',
    }),
  });
  assert(advancedCard.response.ok && advancedCard.payload.currentStage === 1, 'Advance card stage failed');
  assert(Number(advancedCard.payload.receivedAmount) === 25, 'Stage amount was not recorded');
  okStep('advance card stage');

  const giftCardOperation = await request(`/api/inventory/received-cards/${card.id}/operations`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      operationType: 'GIFT_CARD',
      categoryCode: '100',
      quantity: 1,
      note: 'اختبار خصم كرت 100',
    }),
  });
  assert(giftCardOperation.response.status === 201, `Create gift-card operation failed: ${giftCardOperation.text}`);
  assert(Number(giftCardOperation.payload.totalDeducted) === 126, 'Gift-card operation did not update deducted total');
  okStep('create card gift operation');

  const invoiceOperation = await request(`/api/inventory/received-cards/${card.id}/operations`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      operationType: 'INVOICE',
      amount: 50,
      note: 'اختبار فاتورة',
    }),
  });
  assert(invoiceOperation.response.status === 201, `Create invoice operation failed: ${invoiceOperation.text}`);
  const invoice = invoiceOperation.payload.operations?.find((operation) => operation.operationType === 'INVOICE');
  assert(invoice?.id, 'Invoice operation was not returned');
  okStep('create card invoice operation');

  const invoiceDeleted = await request(`/api/inventory/received-cards/${card.id}/operations/${invoice.id}`, {
    method: 'DELETE',
    cookie,
    body: JSON.stringify({ reason: 'تنظيف فاتورة اختبار' }),
  });
  assert(invoiceDeleted.response.ok && Number(invoiceDeleted.payload.totalDeducted) === 126, 'Delete invoice operation failed');
  okStep('delete card operation and recalculate');

  const finalSettlement = await request(`/api/inventory/received-cards/${card.id}/operations`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      operationType: 'FINAL_SETTLEMENT',
      note: 'اختبار تصفية نهائية',
    }),
  });
  assert(finalSettlement.response.status === 201, `Final settlement failed: ${finalSettlement.text}`);
  assert(Number(finalSettlement.payload.remainingAmount) === 0, 'Final settlement did not clear remaining amount');
  okStep('final card settlement');

  const delivery = await request(`/api/people/${person.id}/deliveries`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      currencyId: currency.id,
      amount: 100,
      paymentMethod: currency.code === 'LYD' ? 'LYD_CASH' : 'USD_CASH',
      note: 'اختبار تسليم مبلغ',
    }),
  });
  assert(delivery.response.status === 201, `Customer delivery failed: ${delivery.text}`);
  okStep('create customer card delivery');

  const cardSearch = await request('/api/people?q=1234', { cookie });
  assert(cardSearch.response.ok && cardSearch.payload.some((item) => item.id === person.id), 'Card last4 search failed');
  okStep('search by card last4');

  const walletCreated = await request(`/api/people/${person.id}/wallet-settlements`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      direction: 'ADD',
      accountType: 'DEBT',
      currencyId: currency.id,
      paymentMethod: currency.code === 'LYD' ? 'LYD_CASH' : 'USD_CASH',
      amount: 100,
      reason: 'حركة اختبار لنا',
      note: 'اختبار آلي',
    }),
  });
  assert(walletCreated.response.status === 201, `Create wallet movement failed: ${walletCreated.text}`);
  const settlement = walletCreated.payload;
  okStep('create wallet movement');

  const walletUpdated = await request(`/api/people/${person.id}/wallet-settlements/${settlement.id}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify({
      direction: 'ADD',
      accountType: 'DEBT',
      currencyId: currency.id,
      paymentMethod: settlement.paymentMethod,
      amount: 120,
      reason: 'حركة اختبار لنا معدلة',
      note: 'تعديل اختبار آلي',
    }),
  });
  assert(walletUpdated.response.ok && Number(walletUpdated.payload.amount) === 120, 'Update wallet movement failed');
  okStep('update wallet movement and recalculate');

  const repaymentCreated = await request(`/api/people/${person.id}/wallet-settlements`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      direction: 'SUBTRACT',
      accountType: 'DEBT',
      currencyId: currency.id,
      paymentMethod: settlement.paymentMethod,
      amount: 40,
      reason: 'تم سداد اختبار',
      note: 'سداد اختبار آلي',
      movementKind: 'REPAYMENT',
      settlementMethod: settlement.paymentMethod,
    }),
  });
  assert(repaymentCreated.response.status === 201, `Create repayment failed: ${repaymentCreated.text}`);
  assert(repaymentCreated.payload.movementKind === 'REPAYMENT', 'Repayment movement kind was not saved');
  okStep('create account repayment');

  const repaymentDeleted = await request(`/api/people/${person.id}/wallet-settlements/${repaymentCreated.payload.id}`, {
    method: 'DELETE',
    cookie,
    body: JSON.stringify({ reason: 'تنظيف سداد اختبار' }),
  });
  assert(repaymentDeleted.response.ok, 'Soft delete repayment failed');
  okStep('soft delete repayment');

  const walletDeleted = await request(`/api/people/${person.id}/wallet-settlements/${settlement.id}`, {
    method: 'DELETE',
    cookie,
    body: JSON.stringify({ reason: 'تنظيف اختبار آلي' }),
  });
  assert(walletDeleted.response.ok, 'Soft delete wallet movement failed');
  okStep('soft delete wallet movement');

  const cardDeleted = await request(`/api/inventory/received-cards/${card.id}`, {
    method: 'DELETE',
    cookie,
  });
  assert(cardDeleted.response.ok, 'Soft delete card failed');
  okStep('soft delete card');

  const personDeleted = await request(`/api/people/${person.id}`, {
    method: 'DELETE',
    cookie,
  });
  assert(personDeleted.response.ok, 'Archive test customer failed');
  okStep('archive test customer');

  const auditSearch = await request(`/audit?q=${encodeURIComponent(testName)}`, { cookie });
  assert(auditSearch.response.ok, 'Audit search page failed');
  okStep('audit page search');

  console.log(
    JSON.stringify(
      {
        ok: true,
        username: session.username,
        steps: steps.map((step) => step.name),
      },
      null,
      2,
    ),
  );

  if (session.sessionId) {
    await prisma.loginSession.update({
      where: { id: session.sessionId },
      data: { revokedAt: new Date() },
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (temporarySessionId) {
    await prisma.loginSession.update({
      where: { id: temporarySessionId },
      data: { revokedAt: new Date() },
    }).catch(() => null);
  }
  await prisma.$disconnect();
});
