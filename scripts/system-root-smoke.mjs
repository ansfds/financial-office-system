import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForJson, openCdpSocket } from './browser-cdp.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const local = ['127.0.0.1', 'localhost'].includes(new URL(base).hostname);
const routes = ['/', '/customers', '/cards', '/finance', '/daily-notes', '/settings'];
const output = path.resolve('.tmp/system-root-smoke', `${new URL(base).hostname}-${Date.now()}`);
await mkdir(output, { recursive: true });
const results = { base, local, protectedRoutes: [], legacyRoutes: [], removedAssets: [], authenticatedRoutes: [], browser: [] };
const cookieHeader = { Cookie: 'fos_session=invalid.invalid.signature' };
let sessionCookie = '';

for (const route of routes) {
  const response = await fetch(base + route, { redirect: 'manual' });
  assert.equal(response.status, 307, `${route} must require login`);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/login');
  results.protectedRoutes.push({ route, status: response.status });
}
const invalidRoot = await fetch(base + '/', { redirect: 'manual', headers: cookieHeader });
if (invalidRoot.status === 200) {
  // Next.js can send a streaming redirect after the outer layout has started.
  const html = await invalidRoot.text();
  assert(html.includes('NEXT_REDIRECT') && html.includes('/login') && !/data-card-statistics=/.test(html),
    'An invalid session must redirect without rendering the dashboard');
} else {
  assert.equal(invalidRoot.status, 307, 'The root must reject invalid sessions');
  assert.equal(new URL(invalidRoot.headers.get('location'), base).pathname, '/login');
}
for (const [route, destination] of [
  ['/dashboard', '/'], ['/admin', '/'], ['/admin/dashboard', '/'],
  ['/people', '/customers'], ['/people/customer-id?tab=history', '/customers/customer-id?tab=history'],
  ['/accounts', '/finance'], ['/gift-cards', '/'], ['/minecraft', '/'],
  ['/subscriptions', '/'], ['/products', '/'], ['/about', '/'], ['/contact', '/'],
  ['/services', '/'], ['/transfers', '/'], ['/pc-parts', '/'], ['/store', '/'], ['/cart', '/'],
]) {
  const response = await fetch(base + route, { redirect: 'manual' });
  assert.equal(response.status, 308, `Legacy path ${route} must permanently redirect`);
  const target = new URL(response.headers.get('location'), base);
  assert.equal(target.pathname + target.search, destination);
  results.legacyRoutes.push({ route, destination, status: response.status });
}
for (const name of ['china-payments.png', 'commerce-cards-service.png', 'global-payments-hero.png', 'usdt-service.png']) {
  const response = await fetch(base + '/brand/' + name);
  assert.equal(response.status, 404, `Unused marketing image ${name} must be removed`);
  results.removedAssets.push({ name, status: response.status });
}
const removedApi = await fetch(base + '/api/settings/public-site', { headers: cookieHeader });
assert.equal(removedApi.status, 404, 'The website settings API must be deleted');
const manifest = await (await fetch(base + '/manifest.webmanifest')).json();
assert.equal(manifest.name, 'منظومة الوسيط');
assert.equal(manifest.start_url, '/');
for (const route of ['/api/people', '/api/cards', '/api/settings', '/api/daily-notes']) {
  for (const headers of [{}, cookieHeader]) {
    const response = await fetch(base + route, { headers });
    assert.equal(response.status, 401, `${route} must reject missing or forged sessions`);
  }
}

if (local) {
  // Production credentials are never read or submitted by this test.
  const require = createRequire(import.meta.url);
  const env = require('./local-review-env.cjs');
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ANS', password: env.USER_ANS_PASSWORD }),
  });
  assert.equal(login.status, 200, 'Local test user must be able to sign in');
  sessionCookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert(sessionCookie.startsWith('fos_session='));
  for (const route of routes) {
    const response = await fetch(base + route, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
    assert.equal(response.status, 200, `Authenticated page ${route} must work`);
    const html = await response.text();
    assert(!/PublicHomeClient|public-hero|public-site|ELWASEET ELALAMY/.test(html));
    results.authenticatedRoutes.push({ route, status: response.status });
  }
}

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\151.0.4129.59\\msedge.exe',
].find(candidate => candidate && existsSync(candidate));
assert(chromePath, 'A local Chrome or Edge browser is required');
const port = 9800 + Math.floor(Math.random() * 150);
const profile = path.join(output, 'browser-profile');
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true });
let cdp;
try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  cdp = openCdpSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function navigate(route, expected) {
    await cdp.send('Page.navigate', { url: base + route });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(`location.pathname === ${JSON.stringify(expected)} && document.readyState !== 'loading' &&
        [...document.querySelectorAll('h1')].some(heading => heading.getBoundingClientRect().height > 0)`)) {
        await new Promise(resolve => setTimeout(resolve, 400));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Browser did not reach ${expected}`);
  }
  async function capture(name) {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filename = path.join(output, name + '.png');
    await writeFile(filename, Buffer.from(screenshot.data, 'base64'));
    return filename;
  }
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    await cdp.send('Network.clearBrowserCookies');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
    await navigate('/', '/login');
    const loginAudit = await evaluate(`({
      title: document.title, path: location.pathname,
      hasLogin: Boolean(document.querySelector('input[type="password"]')),
      website: Boolean(document.querySelector('.public-site, .public-hero, .public-nav, .public-footer')),
      overflow: document.documentElement.scrollWidth - innerWidth,
      robots: document.querySelector('meta[name="robots"]')?.content,
      openGraph: Boolean(document.querySelector('meta[property^="og:"]'))
    })`);
    assert(loginAudit.hasLogin && !loginAudit.website && !loginAudit.openGraph);
    assert.equal(loginAudit.title, 'منظومة الوسيط');
    assert(loginAudit.robots.includes('noindex') && loginAudit.overflow <= 2);
    results.browser.push({ name: name + '-login', ...loginAudit, screenshot: await capture(name + '-login') });
    if (local) {
      const separator = sessionCookie.indexOf('=');
      await cdp.send('Network.setCookie', { name: sessionCookie.slice(0, separator), value: sessionCookie.slice(separator + 1), url: base, httpOnly: true, sameSite: 'Lax' });
      for (const route of routes) {
        await navigate(route, route);
        const audit = await evaluate(`({
          path: location.pathname, heading: document.querySelector('h1')?.textContent,
          website: Boolean(document.querySelector('.public-site, .public-hero, .public-nav, .public-footer')),
          oldLinks: [...document.querySelectorAll('nav a[href]')].filter(a => /^\\/(dashboard|people|accounts)(\\/|$)/.test(a.pathname)).map(a => a.pathname),
          rootIsActive: location.pathname !== '/' || Boolean(document.querySelector('[data-card-statistics]')),
          overflow: document.documentElement.scrollWidth - innerWidth
        })`);
        assert(!audit.website && audit.oldLinks.length === 0 && audit.rootIsActive && audit.overflow <= 2);
        results.browser.push({ name: name + route, ...audit, screenshot: await capture(name + '-' + (route.slice(1) || 'dashboard')) });
      }
    }
  }
  const sourceAudit = await evaluate(`(async () => {
    const urls = [...document.scripts].map(s => s.src).filter(Boolean);
    const matches = await Promise.all(urls.map(async (url) => {
      const text = await (await fetch(url)).text();
      return /PublicHomeClient|public-hero|public-floating-whatsapp/.test(text);
    }));
    return { scripts: urls.length, forbidden: matches.some(Boolean) };
  })()`);
  assert(!sourceAudit.forbidden, 'The browser must not load the old website code');
  results.sourceAudit = sourceAudit;
  results.ok = true;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: results.ok, base, output, protectedRoutes: results.protectedRoutes.length,
    legacyRoutes: results.legacyRoutes.length, removedAssets: results.removedAssets.length,
    authenticatedRoutes: results.authenticatedRoutes.length, screenshots: results.browser.length,
    sourceAudit: results.sourceAudit }, null, 2));
} finally {
  cdp?.close();
  chrome.kill();
  if (sessionCookie) await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: sessionCookie } });
}
