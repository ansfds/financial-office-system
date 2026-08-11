import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';

const { loadEnvConfig } = nextEnv;
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const OUTPUT_DIR = path.resolve('.tmp', 'visual-smoke');
const prisma = new PrismaClient();
let temporarySessionId = null;

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\151.0.4129.59\\msedge.exe',
].filter(Boolean);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packSessionCookie(id, expiresAt, secret) {
  const expires = expiresAt.getTime();
  const payload = `${id}.${expires}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

async function createTemporarySession() {
  loadEnvConfig(process.cwd());
  const secret = process.env.SESSION_SECRET;
  assert(secret, 'SESSION_SECRET is required for visual smoke');

  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { username: 'asc' },
  });
  assert(user, 'No active user found for visual smoke');

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await prisma.loginSession.create({
    data: {
      id,
      userId: user.id,
      username: user.username,
      expiresAt,
      ip: 'visual-smoke',
      userAgent: 'codex-visual-smoke',
    },
  });
  temporarySessionId = id;

  return {
    username: user.username,
    value: packSessionCookie(id, expiresAt, secret),
  };
}

async function waitForJson(url, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function openCdpSocket(wsUrl) {
  let nextId = 1;
  const pending = new Map();
  const events = new Map();
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('message', (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
      return;
    }

    const listeners = events.get(data.method) || [];
    for (const listener of listeners) listener(data.params || {});
  });

  function waitOpen() {
    if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
  }

  async function send(method, params = {}) {
    await waitOpen();
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10_000);
    });
  }

  function once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        events.set(
          method,
          (events.get(method) || []).filter((item) => item !== listener),
        );
        resolve(params);
      };
      events.set(method, [...(events.get(method) || []), listener]);
    });
  }

  return {
    send,
    once,
    close: () => ws.close(),
  };
}

async function main() {
  const chromePath = chromeCandidates.find((candidate) => candidate && existsSync(candidate));
  assert(chromePath, 'Chrome or Edge executable was not found');

  const session = await createTemporarySession();
  const userDataDir = path.resolve('.tmp', `chrome-${Date.now()}`);
  const remotePort = 9333 + Math.floor(Math.random() * 200);
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ]);

  try {
    await waitForJson(`http://127.0.0.1:${remotePort}/json/version`, 30_000);
    const targets = await waitForJson(`http://127.0.0.1:${remotePort}/json/list`, 30_000);
    const target = targets.find((item) => item.type === 'page') || targets[0];
    assert(target?.webSocketDebuggerUrl, 'Chrome DevTools page target was not available');
    const cdp = openCdpSocket(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCookie', {
      name: 'fos_session',
      value: session.value,
      url: BASE_URL,
      path: '/',
      httpOnly: true,
    });

    async function setViewport(scenario) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: 1,
        mobile: scenario.mobile,
      });
    }

    async function navigateAndTheme(scenario) {
      await setViewport(scenario);
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${BASE_URL}${scenario.route}` });
      await loaded;
      await cdp.send('Runtime.evaluate', {
        expression:
          scenario.theme === 'dark'
            ? "localStorage.setItem('fos-theme','dark'); document.documentElement.classList.add('dark'); document.documentElement.classList.remove('theme-bright');"
            : "localStorage.setItem('fos-theme','light'); document.documentElement.classList.remove('dark','theme-bright');",
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
      }
      return result.result.value;
    }

    async function assertDialogScenario(scenario) {
      await navigateAndTheme(scenario);
      const positions = ['top', 'middle', 'bottom'];

      for (const position of positions) {
        await evaluate(`
          (() => {
            const y = '${position}' === 'top'
              ? 0
              : '${position}' === 'middle'
                ? Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) / 2)
                : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo(0, y);
            window.__dialogSmokeScrollY = window.scrollY;
          })()
        `);
        await new Promise((resolve) => setTimeout(resolve, 120));
        await evaluate(scenario.openExpression);
        await new Promise((resolve) => setTimeout(resolve, 280));

        const audit = await evaluate(`
          (() => {
            const root = document.querySelector('[data-modal-layer="root"][data-modal-name="${scenario.modalName}"]');
            const panel = root?.querySelector('.modal-panel');
            const backdrop = root?.querySelector('.modal-backdrop');
            if (!root || !panel || !backdrop) return { ok: false, reason: 'missing modal layer, panel, or backdrop' };
            const rect = panel.getBoundingClientRect();
            const viewport = window.visualViewport || { offsetTop: 0, height: window.innerHeight };
            const panelZ = Number.parseInt(getComputedStyle(panel).zIndex || '0', 10);
            const backdropZ = Number.parseInt(getComputedStyle(backdrop).zIndex || '0', 10);
            const bodyStyle = getComputedStyle(document.body);
            return {
              ok:
                rect.top >= viewport.offsetTop - 1 &&
                rect.bottom <= viewport.offsetTop + viewport.height + 2 &&
                panelZ > backdropZ &&
                bodyStyle.position === 'fixed' &&
                bodyStyle.overflow === 'hidden' &&
                document.documentElement.scrollWidth <= window.innerWidth + 2,
              rectTop: rect.top,
              rectBottom: rect.bottom,
              viewportTop: viewport.offsetTop,
              viewportBottom: viewport.offsetTop + viewport.height,
              panelZ,
              backdropZ,
              bodyPosition: bodyStyle.position,
              bodyOverflow: bodyStyle.overflow,
              horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
            };
          })()
        `);
        assert(audit.ok, `${scenario.name}-${position} dialog audit failed: ${JSON.stringify(audit)}`);

        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(OUTPUT_DIR, `${scenario.name}-${position}.png`);
        const buffer = Buffer.from(screenshot.data, 'base64');
        assert(buffer.length > 10_000, `${scenario.name}-${position} screenshot is unexpectedly small`);
        await writeFile(file, buffer);

        await evaluate(`
          (() => {
            const root = document.querySelector('[data-modal-layer="root"][data-modal-name="${scenario.modalName}"]');
            const closeButton = root?.querySelector('button[aria-label*="إغلاق"]') || root?.querySelector('.modal-backdrop');
            if (!closeButton) throw new Error('close button not found');
            closeButton.click();
          })()
        `);
        await new Promise((resolve) => setTimeout(resolve, 320));
        const cleanup = await evaluate(`
          (() => ({
            roots: document.querySelectorAll('[data-modal-layer="root"]').length,
            bodyPosition: document.body.style.position,
            bodyOverflow: document.body.style.overflow,
            scrollDelta: Math.abs(window.scrollY - (window.__dialogSmokeScrollY || 0)),
            horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          }))()
        `);
        assert(
          cleanup.roots === 0 &&
            cleanup.bodyPosition !== 'fixed' &&
            cleanup.bodyOverflow !== 'hidden' &&
            cleanup.scrollDelta <= 2 &&
            cleanup.horizontalOverflow <= 2,
          `${scenario.name}-${position} cleanup failed: ${JSON.stringify(cleanup)}`,
        );
        results.push({ ...scenario, position, file, bytes: buffer.length, audit });
      }
    }

    const scenarios = [
      { name: 'desktop-dashboard-light', route: '/dashboard', width: 1440, height: 900, mobile: false, theme: 'light' },
      { name: 'desktop-people-dark', route: '/people', width: 1440, height: 900, mobile: false, theme: 'dark' },
      { name: 'mobile-accounts-light', route: '/accounts', width: 390, height: 844, mobile: true, theme: 'light' },
      { name: 'mobile-settings-dark', route: '/settings', width: 390, height: 844, mobile: true, theme: 'dark' },
    ];

    const results = [];
    for (const scenario of scenarios) {
      await navigateAndTheme(scenario);
      const text = await cdp.send('Runtime.evaluate', {
        expression: 'document.body.innerText',
        returnByValue: true,
      });
      assert(String(text.result.value || '').trim().length > 20, `${scenario.name} rendered almost empty`);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUTPUT_DIR, `${scenario.name}.png`);
      const buffer = Buffer.from(screenshot.data, 'base64');
      assert(buffer.length > 10_000, `${scenario.name} screenshot is unexpectedly small`);
      await writeFile(file, buffer);
      results.push({ ...scenario, file, bytes: buffer.length });
    }

    const dialogScenarios = [
      {
        name: 'mobile-accounts-add-dialog',
        route: '/accounts',
        modalName: 'wallet-movement',
        width: 390,
        height: 844,
        mobile: true,
        theme: 'light',
        openExpression: `
          (() => {
            const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('إضافة حركة'));
            if (!button) throw new Error('accounts add button not found');
            button.click();
          })()
        `,
      },
      {
        name: 'mobile-people-fast-card-dialog',
        route: '/people',
        modalName: 'fast-card-entry',
        width: 390,
        height: 844,
        mobile: true,
        theme: 'dark',
        openExpression: `
          (() => {
            const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('إضافة معاملة بطاقات'));
            if (!button) throw new Error('fast card entry button not found');
            button.click();
          })()
        `,
      },
      {
        name: 'mobile-new-transaction-customer-dialog',
        route: '/new-transaction',
        modalName: 'new-transaction-customer',
        width: 390,
        height: 844,
        mobile: true,
        theme: 'light',
        openExpression: `
          (() => {
            const select = [...document.querySelectorAll('select')].find((item) =>
              [...item.options].some((option) => option.value === '__add_customer__')
            );
            if (!select) throw new Error('add customer select not found');
            select.value = '__add_customer__';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `,
      },
    ];

    for (const scenario of dialogScenarios) {
      await assertDialogScenario(scenario);
    }

    cdp.close();
    console.log(JSON.stringify({ ok: true, username: session.username, screenshots: results }, null, 2));
  } finally {
    chrome.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => null);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (temporarySessionId) {
    await prisma.loginSession.delete({
      where: { id: temporarySessionId },
    }).catch(() => null);
  }
  await prisma.$disconnect();
});
