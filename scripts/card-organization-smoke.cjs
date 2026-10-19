// Creates test fixtures only in the isolated local review DB. Never resets existing data.
const env = require('./local-review-env.cjs');
const { PrismaClient } = require('@prisma/client');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3000';
const passed = [];
let cookie;
function pass(name) {
  passed.push(name);
  console.log('PASS ' + name);
}
async function api(url, data, method = 'POST') {
  const response = await fetch(base + url, {
    method,
    headers: { cookie, Origin: base, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function success(url, data, method = 'POST') {
  const result = await api(url, data, method);
  assert(result.status < 300, `${url}: ${result.status} ${result.body?.error || ''}`);
  return result.body;
}
async function main() {
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).port, '55432');
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ANS', password: env.USER_ANS_PASSWORD }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const usd = await db.currency.findUniqueOrThrow({ where: { code: 'USD' } });
  const stamp = Date.now();
  const older = await success('/api/people', { fullName: 'زبون ترتيب قديم ' + stamp, phone: '094' + stamp });
  await db.person.update({ where: { id: older.id }, data: { createdAt: new Date('2026-01-01T12:00:00Z') } });
  const person = await success('/api/people', {
    fullName: 'مراجعة تنظيم البطاقات ' + stamp,
    phone: '091' + stamp,
    phoneSecondary: '092' + stamp,
  });
  const people = await success('/api/people', undefined, 'GET');
  assert.equal(people[0].id, person.id);
  assert(people.findIndex((p) => p.id === older.id) > 0);
  pass('customers default to newest entry first');
  const states = ['RECEIVED', 'RECEIVED', 'SETTLED', 'CANCELLED', 'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE'];
  const batch = await success('/api/inventory/received-cards', {
    personId: person.id,
    cardCount: states.length,
    agreedAmountPerCard: 1800,
    cards: states.map((status, i) => ({
      cardLast4: String(8100 + i),
      valueUsd: 2000,
      agreedAmount: 1800,
      currencyId: usd.id,
      status,
    })),
  });
  const owners = await success('/api/cards?q=' + encodeURIComponent(person.fullName), undefined, 'GET');
  assert.equal(owners.people.length, 1);
  assert.equal(owners.people[0].counts.total, 6);
  assert.equal(owners.people[0].counts.CLEARED, 1);
  assert.equal(
    (await success('/api/cards?q=' + encodeURIComponent(older.fullName), undefined, 'GET')).people.length,
    0,
  );
  assert.equal(
    (await success('/api/cards?q=8104&status=PAYMENT_FAILED', undefined, 'GET')).people.some(
      (p) => p.id === person.id,
    ),
    true,
  );
  pass('cards directory includes only card owners and supports last-four and status search');
  const detail = () => success('/api/people/' + person.id, undefined, 'GET');
  const findCard = async (id) =>
    (await detail()).cardBatches.flatMap((b) => b.cards).find((c) => c.id === id);
  async function set(card, slot, checked) {
    return success(`/api/inventory/received-cards/${card.id}/withdrawals`, {
      slot,
      checked,
      updatedAt: card.updatedAt,
    });
  }
  let card = await findCard(batch.cards[0].id);
  assert.equal(card.currentStage, 0);
  const monetaryBefore = [card.valueUsd, card.agreedAmount, card.receivedAmount, card.remainingAmount];
  for (let slot = 1; slot <= 3; slot++) card = await set(card, slot, true);
  assert.equal(card.currentStage, 3);
  assert.equal(card.status, 'IN_SETTLEMENT');
  card = await findCard(card.id);
  assert.equal(card.currentStage, 3);
  assert.deepEqual(
    [card.valueUsd, card.agreedAmount, card.receivedAmount, card.remainingAmount],
    monetaryBefore,
  );
  pass('three checked withdrawals persist across a fresh request without changing money');
  const before = (await success('/api/dashboard', undefined, 'GET')).cards;
  card = await set(card, 4, true);
  card = await set(card, 5, true);
  assert.equal(card.status, 'SETTLED');
  const after = (await success('/api/dashboard', undefined, 'GET')).cards;
  assert.equal(after.CLEARED, before.CLEARED + 1);
  assert.equal(after.IN_PROGRESS, before.IN_PROGRESS - 1);
  pass('fifth withdrawal clears the card and changes shared dashboard counts');
  const stale = await api(`/api/inventory/received-cards/${card.id}/withdrawals`, {
    slot: 1,
    checked: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(stale.status, 409);
  card = await set(card, 2, false);
  assert.equal(card.status, 'IN_SETTLEMENT');
  assert.equal(card.currentStage, 4);
  let reloaded = await findCard(card.id);
  const latestSecond = reloaded.stageLogs
    .filter((log) => log.stage === 2 && log.direction.startsWith('WITHDRAWAL_'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  assert.equal(latestSecond.direction, 'WITHDRAWAL_OFF');
  pass('unchecking is saved independently and stale updates are rejected');
  for (const index of [3, 4, 5]) {
    let special = await findCard(batch.cards[index].id);
    for (let slot = 1; slot <= 5; slot++) special = await set(special, slot, true);
    assert.equal(special.status, states[index]);
  }
  pass('cancelled, failed and insufficient cards retain priority at five withdrawals');
  await success(`/api/people/${person.id}/wallet-settlements`, {
    accountType: 'DEBT',
    direction: 'ADD',
    currencyId: usd.id,
    paymentMethod: 'USD_CASH',
    amount: 75,
    reason: 'حركة مراجعة التنظيم',
    effectMode: 'NORMAL',
  });
  const summary = (
    await success('/api/people?q=' + encodeURIComponent(person.fullName), undefined, 'GET')
  )[0];
  assert(summary.wallet.some((w) => w.debt === 75));
  const profile = await fetch(base + '/customers/' + person.id, { headers: { cookie } });
  const profileHtml = await profile.text();
  assert.equal(profile.status, 200);
  assert(profileHtml.includes('إحصائيات البطاقات'));
  assert(profileHtml.includes('تاريخ أول تعامل'));
  assert(profileHtml.includes('لنا وعلينا'));
  pass('full profile retains actual financial balances, dates and shared status statistics');
  const removed = batch.cards[1];
  const totalBefore = (await success('/api/dashboard', undefined, 'GET')).cards.total;
  await success(`/api/inventory/received-cards/${removed.id}`, undefined, 'DELETE');
  assert.equal((await success('/api/dashboard', undefined, 'GET')).cards.total, totalBefore - 1);
  assert.equal(
    (await success('/api/cards?q=' + encodeURIComponent(person.fullName), undefined, 'GET')).people[0].counts
      .total,
    5,
  );
  assert.equal((await detail()).cardBatches.flatMap((b) => b.cards).length, 5);
  pass('card deletion updates dashboard, owner list and full profile together');
  // Leave the normal card at 4/5 so browser QA can exercise the fifth checkbox.
  reloaded = await findCard(card.id);
  const result = {
    passed,
    personId: person.id,
    olderPersonId: older.id,
    phone: person.phone,
    phoneSecondary: person.phoneSecondary,
    cardId: card.id,
    cardLast4: card.cardLast4,
    stateAtEnd: reloaded.status,
    countAtEnd: reloaded.currentStage,
  };
  fs.writeFileSync('.tmp/card-organization-results.json', JSON.stringify(result, null, 2));
  console.log('Integration scenarios passed: ' + passed.length);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
