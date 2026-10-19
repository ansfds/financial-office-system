import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForJson, openCdpSocket } from './browser-cdp.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const local = ['127.0.0.1', 'localhost'].includes(new URL(base).hostname);
const suppliedPort = Number(process.env.VERIFY_CDP_PORT || 0);
assert(local || suppliedPort, 'Production verification requires a browser session signed in by the user');
const port = suppliedPort || 9900 + Math.floor(Math.random() * 100);
const output = path.resolve('.tmp/data-loading-smoke', `${new URL(base).hostname}-${Date.now()}`);
await mkdir(output, { recursive: true });
const sections = [
  ['/customers', 'الزبائن'], ['/cards', 'البطاقات'], ['/finance', 'لنا وعلينا'],
  ['/daily-notes', 'الملاحظات اليومية'], ['/settings', 'الإعدادات'], ['/audit', 'سجل العمليات'], ['/', 'الرئيسية'],
];
const apiPaths = ['/api/people', '/api/cards', '/api/daily-notes', '/api/settings', '/api/dashboard'];
const report = { base, sections: [], apis: [], networkFailures: [], exceptions: [], reloads: 0 };
let chrome, cdp, cookie;
if (!suppliedPort) {
  const executable = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    .find(value => value && existsSync(value));
  assert(executable);
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    `--user-data-dir=${path.join(output, 'browser-profile')}`, 'about:blank'], { windowsHide: true });
}
try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const target = pages.find(page => page.type === 'page' && page.url.startsWith(base)) || pages.find(page => page.type === 'page');
  cdp = openCdpSocket(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  // React streaming completion needs an active tab when verifying a user-owned browser.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const requests = new Map();
  let recordFailures = false;
  cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, event.request.url));
  cdp.on('Network.responseReceived', event => {
    if (recordFailures && event.response.url.startsWith(base) && event.response.status >= 400)
      report.networkFailures.push({ url: new URL(event.response.url).pathname, method: 'GET', status: event.response.status });
  });
  cdp.on('Network.loadingFailed', event => {
    if (recordFailures && !event.canceled && requests.get(event.requestId)?.startsWith(base))
      report.networkFailures.push({ url: new URL(requests.get(event.requestId)).pathname, error: event.errorText });
  });
  cdp.on('Runtime.exceptionThrown', event => {
    if (recordFailures) report.exceptions.push({ text: event.exceptionDetails.text,
      name: event.exceptionDetails.exception?.className,
      reactCode: event.exceptionDetails.exception?.description?.match(/Minified React error #(\d+)/)?.[1] });
  });
  cdp.on('Runtime.consoleAPICalled', event => {
    if (recordFailures && event.type === 'error') report.exceptions.push({ text: 'Browser console.error' });
  });
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Browser readiness check timed out');
  }
  async function visibleHeading(heading) {
    await until(`[...document.querySelectorAll('h1')].some(h => h.getBoundingClientRect().height > 0 && h.textContent.trim() === ${JSON.stringify(heading)})`);
  }
  if (local) {
    const require = createRequire(import.meta.url);
    const env = require('./local-review-env.cjs');
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ANS', password: env.USER_ANS_PASSWORD }) });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie()[0].split(';')[0];
    const separator = cookie.indexOf('=');
    await cdp.send('Network.setCookie', { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base, httpOnly: true, sameSite: 'Lax' });
    await cdp.send('Page.navigate', { url: base + '/customers' });
  } else {
    await cdp.send('Page.navigate', { url: base + '/customers' });
  }
  await visibleHeading('الزبائن');
  const sessionStatus = await evaluate(`fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.status)`);
  assert.equal(sessionStatus, 200, 'The verification browser must have a valid user session');
  report.sessionStatus = sessionStatus;
  recordFailures = true;
  for (const [route, heading] of sections) {
    await cdp.send('Page.navigate', { url: base + route });
    await visibleHeading(heading);
    const response = await evaluate(`(async()=>{
      const r=await fetch(${JSON.stringify(route)},{cache:'no-store'});
      return {url:r.url,method:'GET',status:r.status,contentType:r.headers.get('content-type')?.split(';')[0]};
    })()`);
    assert.equal(response.status, 200);
    await cdp.send('Page.reload', { ignoreCache: true });
    await visibleHeading(heading);
    report.reloads++;
    await new Promise(resolve => setTimeout(resolve, 350));
    const errorVisible = await evaluate(`[...document.querySelectorAll('h1')].some(h=>h.textContent.includes('تعذر تحميل الصفحة'))`);
    assert(!errorVisible, route + ' rendered the error boundary');
    if (local) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(output, (route.slice(1) || 'dashboard') + '.png'), Buffer.from(screenshot.data, 'base64'));
    }
    report.sections.push({ ...response, route, heading, rendered: true, reloaded: true });
  }
  for (const route of apiPaths) {
    const response = await evaluate(`(async()=>{
      const r=await fetch(${JSON.stringify(route)},{cache:'no-store'});const type=r.headers.get('content-type')||'';
      let data,jsonParsed=false;try{data=await r.json();jsonParsed=true;}catch{}
      return {url:r.url,method:'GET',status:r.status,contentType:type.split(';')[0],error:data?.error,errorId:data?.errorId,
        jsonParsed,
        bodySummary:Array.isArray(data)?{type:'array',rows:data.length}:{type:typeof data,keys:data&&typeof data==='object'?Object.keys(data):[]}};
    })()`);
    assert.equal(response.status, 200, route + ' failed');
    assert.equal(response.contentType, 'application/json');
    assert(response.jsonParsed, route + ' returned invalid JSON');
    assert(!response.error);
    report.apis.push(response);
  }
  const health = await evaluate(`fetch('/api/health',{cache:'no-store'}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.deepEqual(health, { status: 200, body: { app: 'ok', database: 'ok' } });
  report.health = health;
  for (const href of ['/cards', '/finance', '/daily-notes', '/customers']) {
    const selector = JSON.stringify(`nav a[href="${href}"]`);
    await until(`Boolean(document.querySelector(${selector}))`);
    await evaluate(`document.querySelector(${selector}).click()`);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  await visibleHeading('الزبائن');
  assert.equal(await evaluate(`location.pathname`), '/customers');
  report.rapidNavigation = true;
  if (process.env.VERIFY_MIGRATION_BACKUP_ID) {
    await cdp.send('Page.navigate', { url: base + '/settings' });
    await visibleHeading('الإعدادات');
    const selector = `a[href="/api/admin/backup/${process.env.VERIFY_MIGRATION_BACKUP_ID}"]`;
    report.migrationBackupVisible = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    assert(report.migrationBackupVisible, 'The deployed app must see the migration backup in the same database');
  }
  assert.equal(report.networkFailures.length, 0, JSON.stringify(report.networkFailures));
  assert.equal(report.exceptions.length, 0, JSON.stringify(report.exceptions));
  report.ok = true;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, base, sections: report.sections.length, apis: report.apis.length,
    reloads: report.reloads, health: report.health, networkFailures: report.networkFailures.length,
    exceptions: report.exceptions.length, output }, null, 2));
} finally {
  if (cdp) {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
    await cdp.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
  }
  cdp?.close();
  chrome?.kill();
  if (cookie) await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
}
