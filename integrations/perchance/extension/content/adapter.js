(function () {
  'use strict';

  const executed = new Set();

  function createPanel() {
    if (document.getElementById('pc-bridge-panel')) return document.getElementById('pc-bridge-panel');
    const panel = document.createElement('div');
    panel.id = 'pc-bridge-panel';
    panel.style.cssText = 'position:fixed;bottom:12px;right:12px;width:360px;max-height:50vh;overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;font-family:system-ui,sans-serif;font-size:12px;z-index:2147483647;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:8px">Perchance Code Bridge</div><div id="pc-bridge-status">Waiting for tool calls...</div><div id="pc-bridge-log" style="margin-top:8px;white-space:pre-wrap"></div>';
    document.body.appendChild(panel);
    return panel;
  }

  function log(msg) {
    const p = createPanel();
    const el = p.querySelector('#pc-bridge-log');
    if (el) {
      const line = document.createElement('div');
      line.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
      el.prepend(line);
    }
  }

  function setStatus(msg) {
    const p = createPanel();
    const el = p.querySelector('#pc-bridge-status');
    if (el) el.textContent = msg;
  }

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getConfig' }, (resp) => resolve(resp?.config || {}));
    });
  }

  async function runCall(call) {
    if (!call || !call.id || !call.tool) return;
    if (executed.has(call.id)) {
      log(`Skipping duplicate call ${call.id}`);
      return;
    }
    executed.add(call.id);
    setStatus(`Running ${call.tool} (${call.id})...`);
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'executeToolCall', call }, (r) => resolve(r));
    });
    if (resp?.ok) {
      log(`Result ${call.id}: ${JSON.stringify(resp.result).slice(0, 500)}`);
      setStatus(`Done ${call.id}`);
    } else {
      log(`Error ${call.id}: ${resp?.error}`);
      setStatus(`Failed ${call.id}`);
    }
  }

  function extractCalls(root) {
    const calls = [];
    // scan text content for fenced JSON or raw tool_call objects
    const text = root?.innerText || root?.textContent || '';
    // find JSON objects containing "type":"tool_call"
    const re = /\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj && obj.type === 'tool_call') calls.push(obj);
      } catch (e) {
        // ignore
      }
    }
    return calls;
  }

  let debounce = null;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const calls = extractCalls(document.body);
      for (const c of calls) runCall(c);
    }, 500);
  });

  function init() {
    createPanel();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    getConfig().then((cfg) => {
      log(`Daemon: ${cfg.daemonUrl}`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();