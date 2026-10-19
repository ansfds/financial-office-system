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
    on: (method, listener) => events.set(method, [...(events.get(method) || []), listener]),
    close: () => ws.close(),
  };
}

export { waitForJson, waitForOk, openCdpSocket };
