import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { waitForJson, openCdpSocket } from './browser-cdp.mjs';
const require = createRequire(import.meta.url);
const env = require('./local-review-env.cjs');
const base = 'http://127.0.0.1:3000';
const output = path.resolve('.tmp/customer-workflow-visual');
const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\151.0.4129.59\\msedge.exe',
].find(existsSync);
assert(chromePath, 'A local Chrome browser is required');
await mkdir(output, { recursive: true });
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9777',
    '--remote-allow-origins=*',
    `--user-data-dir=${path.join(output, 'chrome-profile-' + Date.now())}`,
    'about:blank',
  ],
  { windowsHide: true },
);
let cdp;
const audits = [];
try {
  await waitForJson('http://127.0.0.1:9777/json/version');
  const pages = await waitForJson('http://127.0.0.1:9777/json/list');
  cdp = openCdpSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  cdp.on('Runtime.consoleAPICalled', (event) => {
    if (event.type === 'trace' || event.type === 'error') console.log(JSON.stringify(event));
  });
  cdp.on('Runtime.exceptionThrown', (event) => console.log(JSON.stringify(event)));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Browser condition timed out: ' + expression);
  }
  async function navigate(route) {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: base + route });
    await loaded;
    await new Promise((r) => setTimeout(r, 600));
  }
  async function shot(name) {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, name + '.png'), Buffer.from(image.data, 'base64'));
  }
  await navigate('/login');
  // Login through HTTP, then install its real signed httpOnly cookie in the test browser.
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ANS', password: env.USER_ANS_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const separator = cookie.indexOf('=');
  await cdp.send('Network.setCookie', {
    name: cookie.slice(0, separator),
    value: decodeURIComponent(cookie.slice(separator + 1)),
    url: base,
    httpOnly: true,
    sameSite: 'Lax',
  });
  const results = JSON.parse(await readFile('.tmp/customer-workflow-results.json', 'utf8'));
  for (const view of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: view.width,
      height: view.height,
      deviceScaleFactor: 1,
      mobile: view.width < 800,
    });
    await navigate('/customers/' + results.reviewPersonId);
    await until(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('4 بطاقات'))`);
    await until(
      `[...document.querySelectorAll('button')].some(b => b.textContent.includes('4 بطاقات') && Object.keys(b).some(k => k.startsWith('__reactProps')))`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes('4 بطاقات')).scrollIntoView({ block: 'center', behavior: 'instant' })`,
    );
    await new Promise((r) => setTimeout(r, 350));
    const clickPoint = await evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('4 بطاقات')); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...clickPoint,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...clickPoint,
      button: 'left',
      clickCount: 1,
    });
    try {
      await until(`!!document.querySelector('[role="dialog"]')`);
    } catch (e) {
      const debug = await evaluate(
        `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('4 بطاقات')); const key = Object.keys(b).find(k => k.startsWith('__reactProps')); return { button: b.outerHTML, props: key ? String(b[key].onClick) : null, modals: document.querySelectorAll('[data-modal-layer]').length, bodyLocked: document.body.style.overflow, layerClass: document.querySelector('.centered-dialog-layer')?.outerHTML }; })()`,
      );
      console.log(JSON.stringify(debug));
      throw e;
    }
    const audit = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]'); const r = dialog.getBoundingClientRect();
      return { width: r.width, height: r.height, left: r.left, top: r.top, viewport: innerWidth,
        centered: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 3,
        fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        cards: dialog.querySelectorAll('article').length,
        images: dialog.querySelectorAll('img, input[type=file]').length,
        blurred: getComputedStyle(document.querySelector('.centered-dialog-layer .modal-backdrop')).backdropFilter,
        overflow: document.documentElement.scrollWidth - innerWidth };
    })()`);
    assert(
      audit.centered && audit.fits && audit.cards === 4 && audit.images === 0 && audit.overflow <= 2,
      JSON.stringify({ view, audit }),
    );
    if (view.width >= 900) assert(audit.width >= 650 && audit.width <= 900);
    audits.push({ view: view.name, ...audit });
    await shot(view.name + '-cards');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await until(`!document.querySelector('[role="dialog"]')`);
    await navigate('/daily-notes');
    await until(`document.body.innerText.includes('متابعة بطاقات اليوم')`);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'));
    await shot(view.name + '-notes');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate('/customers');
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('إضافة بطاقات')).click()`,
  );
  await until(`!!document.querySelector('[role="dialog"] input[type="number"]')`);
  await evaluate(
    `(() => { const el = document.querySelector('[role="dialog"] input[type="number"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '4'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await until(`document.querySelectorAll('[role="dialog"] fieldset').length === 4`);
  assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"] input[type="file"]').length`), 0);
  await shot('batch-entry-four-cards');
  await navigate('/finance');
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('إضافة حركة')).click()`,
  );
  await until(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('زبون جديد'))`);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('زبون جديد')).click()`,
  );
  await until(`!!document.querySelector('[data-modal-name="edit-person"]')`);
  await shot('accounts-new-customer');
  const inlineName = 'زبون من لنا وعلينا ' + Date.now();
  await evaluate(`(() => {
    const fields = document.querySelectorAll('[data-modal-name="edit-person"] form input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(fields[0], ${JSON.stringify(inlineName)}); fields[0].dispatchEvent(new Event('input', { bubbles: true }));
    set.call(fields[1], ${JSON.stringify('093' + Date.now())}); fields[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('[data-modal-name="edit-person"] form button').click()`);
  await until(`!document.querySelector('[data-modal-name="edit-person"]')`);
  await until(
    `document.querySelector('select[aria-label="اختيار الزبون"]')?.selectedOptions[0]?.textContent.includes(${JSON.stringify(inlineName)})`,
  );
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const amount = document.querySelector('[data-modal-name="wallet-movement"] input[placeholder="القيمة"]');
    set.call(amount, '25'); amount.dispatchEvent(new Event('input', { bubbles: true }));
    const reason = document.querySelector('[data-modal-name="wallet-movement"] input[placeholder="سبب الحركة"]');
    set.call(reason, 'حركة تجريبية من واجهة لنا وعلينا'); reason.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(
    `[...document.querySelectorAll('[data-modal-name="wallet-movement"] button')].find(b => b.textContent.includes('حفظ الحركة')).click()`,
  );
  await until(`!document.querySelector('[data-modal-name="wallet-movement"]')`);
  await until(`document.body.innerText.includes(${JSON.stringify(inlineName)})`);
  await shot('accounts-saved-inline-customer');
  await navigate('/settings');
  await until(`document.body.innerText.includes('تصفير المنظومة')`);
  await shot('settings-reset');
  assert(!(await evaluate(`!!document.querySelector('a[href="/instant-registration"]')`)));
  await navigate('/');
  await until(`document.body.innerText.includes('إجمالي البطاقات') && document.body.innerText.includes('رصيد غير كافي')`);
  assert(!(await evaluate(`document.body.innerText.includes('حدث خطأ غير متوقع')`)));
  await shot('dashboard');
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      { audits, batchEntryRows: 4, accountsNewCustomerModal: true, accountsCreatedAndSelectedCustomer: true, accountsMovementSaved: true, instantNavigationRemoved: true },
      null,
      2,
    ),
  );
  console.log(
    'PASS centered card dialogs and notes on desktop/laptop/tablet/mobile; batch fields; inline customer modal; reset settings',
  );
} catch (error) {
  if (cdp) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, 'failure.png'), Buffer.from(shot.data, 'base64'));
    const state = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({ url: location.href, text: document.body.innerText, dialogs: document.querySelectorAll('[role="dialog"]').length })`,
      returnByValue: true,
    });
    await writeFile(path.join(output, 'failure.json'), state.result.value);
  }
  throw error;
} finally {
  cdp?.close();
  chrome.kill();
}
