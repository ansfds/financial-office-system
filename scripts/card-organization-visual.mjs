import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { waitForJson, openCdpSocket } from './browser-cdp.mjs';
const require = createRequire(import.meta.url),
  env = require('./local-review-env.cjs');
const fixture = JSON.parse(await readFile('.tmp/card-organization-results.json', 'utf8'));
const base = 'http://127.0.0.1:3000',
  port = 9788,
  output = path.resolve('.tmp/card-organization-visual');
const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\151.0.4129.59\\msedge.exe',
].find(existsSync);
assert(chromePath);
await mkdir(output, { recursive: true });
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${path.join(output, 'profile-' + Date.now())}`,
    'about:blank',
  ],
  { windowsHide: true },
);
const clients = [],
  results = {};
async function page(client) {
  clients.push(client);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  async function evaluate(expression) {
    const r = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Browser condition timed out: ' + expression);
  }
  async function navigate(route) {
    const loaded = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url: base + route });
    await loaded;
    await new Promise((r) => setTimeout(r, 700));
  }
  async function viewport(width, height) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 800,
    });
  }
  async function screenshot(name) {
    const r = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  return { evaluate, until, navigate, viewport, screenshot };
}
try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const client = openCdpSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  const main = await page(client);
  await main.navigate('/login');
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ANS', password: env.USER_ANS_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0],
    separator = cookie.indexOf('=');
  await client.send('Network.enable');
  await client.send('Network.setCookie', {
    name: cookie.slice(0, separator),
    value: decodeURIComponent(cookie.slice(separator + 1)),
    url: base,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await main.viewport(1440, 900);
  await main.navigate('/');
  await main.until(`!!document.querySelector('[data-card-statistics]')`);
  results.dashboard = await main.evaluate(
    `(() => { const main = document.querySelector('main'); const text = main.innerText; return { states: [...main.querySelectorAll('[data-card-state]')].map(r => r.dataset.cardState), statisticsPanels: main.querySelectorAll('[data-card-statistics]').length, financial: !!main.querySelector('[data-recent-financial]'), removedAbsent: !['آخر تحديث','الحسابات','مجاميع البطاقات حسب العملة','آخر البطاقات المعدلة','آخر عمليات البطاقات'].some(label => text.includes(label)) }; })()`,
  );
  assert(
    results.dashboard.removedAbsent &&
      results.dashboard.financial &&
      results.dashboard.statisticsPanels === 1,
  );
  assert.deepEqual(results.dashboard.states, [
    'NEW',
    'IN_PROGRESS',
    'CLEARED',
    'CANCELLED',
    'PAYMENT_FAILED',
    'INSUFFICIENT_BALANCE',
    'total',
  ]);
  await main.screenshot('dashboard-desktop');
  await main.navigate('/customers');
  await main.until(`!!document.querySelector('input[aria-label="بحث الزبائن"]')`);
  await main.evaluate(
    `(() => { const input = document.querySelector('input[aria-label="بحث الزبائن"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(fixture.phone)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await main.until(`!!document.querySelector('[data-person-row="${fixture.personId}"]')`);
  results.table = await main.evaluate(
    `(() => { const table = document.querySelector('.people-directory-table table'), headers = [...table.querySelectorAll('th')], cells = [...table.querySelector('[data-person-row="${fixture.personId}"]').cells]; return { headers: headers.map(h => h.textContent), phone: cells[1].textContent.trim(), secondary: cells[2].textContent.trim(), aligned: headers.every((h,i) => Math.abs(h.getBoundingClientRect().right - cells[i].getBoundingClientRect().right) < 2), layout: getComputedStyle(table).tableLayout, direction: getComputedStyle(table).direction }; })()`,
  );
  assert.equal(results.table.phone, fixture.phone);
  assert.equal(results.table.secondary, fixture.phoneSecondary);
  assert(results.table.aligned && results.table.layout === 'fixed' && results.table.direction === 'rtl');
  await main.screenshot('customers-desktop');
  await main.viewport(390, 844);
  assert(await main.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'));
  await main.screenshot('customers-mobile');
  await main.viewport(1440, 900);
  await main.navigate('/cards');
  await main.until(`!!document.querySelector('[data-card-owner="${fixture.personId}"]')`);
  assert.equal(
    await main.evaluate(`!!document.querySelector('[data-card-owner="${fixture.olderPersonId}"]')`),
    false,
  );
  await main.evaluate(`document.querySelector('[data-card-owner="${fixture.personId}"]').click()`);
  await main.until(`!!document.querySelector('[data-customer-card="${fixture.cardId}"]')`);
  results.cardsOnly = await main.evaluate(
    `(() => { const main = document.querySelector('main'); return !main.querySelector('[data-customer-wallet]') && !main.querySelector('[data-card-statistics]') && !main.innerText.includes('معلومات الزبون'); })()`,
  );
  assert(results.cardsOnly);
  const cardSelector = `[data-customer-card="${fixture.cardId}"]`;
  async function setSlot(index, checked) {
    const expression = `document.querySelector('${cardSelector} [role="checkbox"]:nth-child(${index})')`;
    const current = await main.evaluate(`${expression}.getAttribute('aria-checked') === 'true'`);
    if (current === checked) return;
    await main.until(`!${expression}.disabled`);
    await main.evaluate(`${expression}.click()`);
    await main.until(
      `${expression}.getAttribute('aria-checked') === '${checked}' && !${expression}.disabled`,
    );
  }
  // Start from a saved 0/5 and check three via real UI clicks.
  for (let slot = 1; slot <= 5; slot++) await setSlot(slot, false);
  for (let slot = 1; slot <= 3; slot++) await setSlot(slot, true);
  await main.until(`document.querySelector('${cardSelector} [data-withdrawal-count]').textContent === '3/5'`);
  await main.navigate('/cards/' + fixture.personId);
  await main.until(
    `document.querySelector('${cardSelector} [data-withdrawal-count]')?.textContent === '3/5'`,
  );
  results.persistence = true;
  await main.screenshot('cards-three-withdrawals');
  await setSlot(4, true);
  async function extra(route) {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const target = await response.json();
    const extraPage = await page(openCdpSocket(target.webSocketDebuggerUrl));
    await extraPage.viewport(1280, 800);
    await extraPage.navigate(route);
    return extraPage;
  }
  const dashboard = await extra('/'),
    profile = await extra('/customers/' + fixture.personId);
  const cleared = `Number(document.querySelector('[data-card-state="CLEARED"] dd').dataset.count)`;
  await dashboard.until(`!!document.querySelector('[data-card-state="CLEARED"] dd')`);
  await profile.until(`!!document.querySelector('[data-card-state="CLEARED"] dd')`);
  const beforeDashboard = await dashboard.evaluate(cleared),
    beforeProfile = await profile.evaluate(cleared);
  await setSlot(5, true);
  await main.until(
    `document.querySelector('${cardSelector} [data-card-status]')?.dataset.cardStatus === 'CLEARED'`,
  );
  await dashboard.until(`${cleared} === ${beforeDashboard + 1}`);
  await profile.until(`${cleared} === ${beforeProfile + 1}`);
  results.liveCountersInOtherTabs = true;
  await dashboard.screenshot('dashboard-after-fifth');
  await profile.screenshot('customer-full-profile');
  results.viewports = [];
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['laptop', 1280, 800],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ]) {
    await main.viewport(width, height);
    assert(await main.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'));
    await main.screenshot('cards-' + name);
    results.viewports.push({ name, fits: true });
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(
    'PASS simplified dashboard; RTL phone columns; distinct cards/profile pages; saved 3/5 after reload; fifth checkbox refreshes dashboard and full profile in other tabs; four screen sizes',
  );
} catch (error) {
  const client = clients[0];
  if (client) {
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const client of clients) client.close();
  chrome.kill();
}
