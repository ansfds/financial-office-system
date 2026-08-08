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

    const scenarios = [
      { name: 'desktop-dashboard-light', route: '/dashboard', width: 1440, height: 900, mobile: false, theme: 'light' },
      { name: 'desktop-people-dark', route: '/people', width: 1440, height: 900, mobile: false, theme: 'dark' },
      { name: 'mobile-accounts-light', route: '/accounts', width: 390, height: 844, mobile: true, theme: 'light' },
      { name: 'mobile-settings-dark', route: '/settings', width: 390, height: 844, mobile: true, theme: 'dark' },
    ];

    const results = [];
    for (const scenario of scenarios) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: 1,
        mobile: scenario.mobile,
      });
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
    await prisma.loginSession.update({
      where: { id: temporarySessionId },
      data: { revokedAt: new Date() },
    }).catch(() => null);
  }
  await prisma.$disconnect();
});
