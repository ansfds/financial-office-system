import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const OUTPUT_DIR = path.resolve('.tmp', 'public-site-visual-smoke', `${new URL(BASE_URL).hostname}-${Date.now()}`);

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\151.0.4129.59\\msedge.exe',
].filter(Boolean);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForJson(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser or dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForOk(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Dev server is still starting.
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

  const userDataDir = path.resolve('.tmp', `chrome-public-${Date.now()}`);
  const remotePort = 9555 + Math.floor(Math.random() * 200);
  await mkdir(OUTPUT_DIR, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { windowsHide: true });

  try {
    await waitForOk(`${BASE_URL}/`, 30_000);
    await waitForJson(`http://127.0.0.1:${remotePort}/json/version`, 30_000);
    const targets = await waitForJson(`http://127.0.0.1:${remotePort}/json/list`, 30_000);
    const target = targets.find((item) => item.type === 'page') || targets[0];
    assert(target?.webSocketDebuggerUrl, 'Chrome DevTools page target was not available');

    const cdp = openCdpSocket(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
      return result.result.value;
    }

    async function setViewport(scenario) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: 1,
        mobile: scenario.mobile,
      });
    }

    async function capture(name) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUTPUT_DIR, `${name}.png`);
      const buffer = Buffer.from(screenshot.data, 'base64');
      assert(buffer.length > 10_000, `${name} screenshot is unexpectedly small`);
      await writeFile(file, buffer);
      return { file, bytes: buffer.length };
    }

    const scenarios = [
      { name: 'mobile-home', width: 390, height: 844, mobile: true },
      { name: 'tablet-home', width: 768, height: 1024, mobile: true },
      { name: 'desktop-home', width: 1440, height: 900, mobile: false },
    ];

    const screenshots = [];
    for (const scenario of scenarios) {
      await setViewport(scenario);
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
      await loaded;
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const audit = await evaluate(`
        (async () => {
          const requiredText = ['الوسيط العالمي', 'تحديثات السوق', 'خدماتنا', 'حسابات التحويل', 'تواصل معنا'];
          const text = document.body.innerText || '';
          const images = [...document.querySelectorAll('.public-site img')];
          const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 0).length;
          const qrImage = [...images].find((image) => image.alt.includes('QR'));
          return {
            hasText: requiredText.every((item) => text.includes(item)),
            imageCount: images.length,
            loadedImages,
            hasQr: Boolean(qrImage),
            hasWhatsApp: Boolean(document.querySelector('a[href^="https://wa.me/218935095091"]')),
            hasFacebook: Boolean(document.querySelector('a[href*="facebook.com/profile.php?id=61560408535771"]')),
            hasMaps: Boolean(document.querySelector('a[href="https://maps.app.goo.gl/K1AXMq7voiRBfzTb6"]')),
            horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
            heroHeight: document.querySelector('.public-hero')?.getBoundingClientRect().height || 0,
            publicHome: location.pathname === '/' && Boolean(document.querySelector('.public-site')),
            hasManagementText: /إدار|\\b(?:admin|management|dashboard)\\b/i.test(text),
            internalLinks: [...document.querySelectorAll('.public-site a[href]')]
              .filter((link) => link.origin === location.origin && link.pathname !== '/')
              .map((link) => ({ href: link.getAttribute('href'), text: link.textContent.trim() })),
            giftCards: [...document.querySelectorAll('#services a[href]')]
              .some((link) => link.getAttribute('href') === '#contact' && document.querySelector('#contact'))
              && document.querySelector('#services')?.textContent.includes('Gift Cards'),
          };
        })()
      `);
      assert(audit.hasText, `${scenario.name} is missing required public copy`);
      assert(audit.publicHome, `${scenario.name} redirected away from the public homepage`);
      assert(!audit.hasManagementText, `${scenario.name} exposes management copy`);
      assert(audit.internalLinks.length === 0, `${scenario.name} exposes internal links: ${JSON.stringify(audit.internalLinks)}`);
      assert(audit.giftCards, `${scenario.name} Gift Cards service or contact link is missing`);
      assert(audit.imageCount >= 6 && audit.loadedImages >= 3, `${scenario.name} image audit failed: ${JSON.stringify(audit)}`);
      assert(audit.hasQr, `${scenario.name} QR image is missing`);
      assert(audit.hasWhatsApp, `${scenario.name} WhatsApp link is missing`);
      assert(audit.hasFacebook, `${scenario.name} Facebook link is missing`);
      assert(audit.hasMaps, `${scenario.name} Maps link is missing`);
      assert(audit.horizontalOverflow <= 2, `${scenario.name} has horizontal overflow: ${JSON.stringify(audit)}`);
      assert(audit.heroHeight <= scenario.height * 0.92, `${scenario.name} hero hides the next section: ${JSON.stringify(audit)}`);

      screenshots.push({ ...scenario, ...(await capture(scenario.name)), audit });

      if (scenario.width < 1024) {
        await evaluate(`document.querySelector('button[aria-label="فتح القائمة"]').click()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const menuAudit = await evaluate(`({
          open: document.querySelector('button[aria-expanded="true"]') !== null,
          hasManagementText: /إدار|\\b(?:admin|management|dashboard)\\b/i.test(document.querySelector('.public-mobile-menu').innerText),
          internalLinks: [...document.querySelectorAll('.public-mobile-menu a[href]')]
            .filter((link) => link.origin === location.origin && link.pathname !== '/').map((link) => link.pathname)
        })`);
        assert(menuAudit.open && !menuAudit.hasManagementText && menuAudit.internalLinks.length === 0,
          `${scenario.name} mobile menu exposes management navigation: ${JSON.stringify(menuAudit)}`);
        screenshots.push({ name: `${scenario.name}-menu`, ...(await capture(`${scenario.name}-menu`)), audit: menuAudit });
        await evaluate(`document.querySelector('button[aria-label="إغلاق القائمة"]').click()`);
      }

      await evaluate('window.scrollTo(0, document.querySelector("#market").offsetTop - 80)');
      await new Promise((resolve) => setTimeout(resolve, 500));
      screenshots.push({ name: `${scenario.name}-market`, ...(await capture(`${scenario.name}-market`)) });

      await evaluate('window.scrollTo(0, document.querySelector("#services").offsetTop - 80)');
      await new Promise((resolve) => setTimeout(resolve, 500));
      screenshots.push({ name: `${scenario.name}-services`, ...(await capture(`${scenario.name}-services`)) });
    }

    const protectedRoutes = [];
    for (const pathname of ['/dashboard', '/people', '/cards', '/accounts', '/audit', '/settings']) {
      const response = await fetch(`${BASE_URL}${pathname}`, { redirect: 'manual' });
      assert([302, 303, 307, 308].includes(response.status) &&
        new URL(response.headers.get('location'), BASE_URL).pathname === '/login',
        `${pathname} must require login; got ${response.status}`);
      protectedRoutes.push({ pathname, status: response.status, location: response.headers.get('location') });
    }
    for (const pathname of ['/api/people', '/api/cards', '/api/settings', '/api/settings/public-site']) {
      for (const forgedCookie of [false, true]) {
        const response = await fetch(`${BASE_URL}${pathname}`, {
          headers: forgedCookie ? { Cookie: 'fos_session=forged.invalid.signature' } : {},
        });
        assert(response.status === 401, `${pathname} must reject ${forgedCookie ? 'forged' : 'missing'} sessions; got ${response.status}`);
        protectedRoutes.push({ pathname, forgedCookie, status: response.status });
      }
    }
    const loginResponse = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    assert(loginResponse.status === 200, 'The internal login page is unavailable');
    const report = { ok: true, baseUrl: BASE_URL, screenshots, protectedRoutes, loginStatus: loginResponse.status };
    await writeFile(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify(report, null, 2));
    cdp.close();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    chrome.kill();
    if (path.dirname(userDataDir) === path.resolve('.tmp') && path.basename(userDataDir).startsWith('chrome-public-')) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
