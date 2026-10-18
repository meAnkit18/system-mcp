const DEFAULTS = { daemonUrl: 'http://127.0.0.1:8787', token: '' };

async function getConfig() {
  const cfg = await chrome.storage.local.get(['daemonUrl', 'token']);
  return { ...DEFAULTS, ...cfg };
}

async function apiFetch(path, options = {}) {
  const cfg = await getConfig();
  const url = cfg.daemonUrl.replace(/\/$/, '') + path;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (cfg.token) headers['X-System-MCP-Token'] = cfg.token;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'getConfig') {
        sendResponse({ ok: true, config: await getConfig() });
      } else if (msg.type === 'setConfig') {
        await chrome.storage.local.set(msg.config || {});
        sendResponse({ ok: true });
      } else if (msg.type === 'status') {
        const s = await apiFetch('/api/status');
        sendResponse({ ok: true, result: s });
      } else if (msg.type === 'getPrompt') {
        const p = await apiFetch('/api/prompt');
        sendResponse({ ok: true, result: p });
      } else if (msg.type === 'executeToolCall') {
        const r = await apiFetch('/api/tool-call', {
          method: 'POST',
          body: JSON.stringify(msg.call || {}),
        });
        sendResponse({ ok: true, result: r });
      } else if (msg.type === 'executeToolCalls') {
        const r = await apiFetch('/api/tool-calls', {
          method: 'POST',
          body: JSON.stringify({ calls: msg.calls || [] }),
        });
        sendResponse({ ok: true, result: r });
      } else {
        sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // async
});