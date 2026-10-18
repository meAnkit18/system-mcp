document.getElementById('save').addEventListener('click', () => {
  const config = {
    daemonUrl: document.getElementById('url').value.trim(),
    token: document.getElementById('token').value.trim(),
  };
  chrome.runtime.sendMessage({ type: 'setConfig', config }, (resp) => {
    document.getElementById('status').textContent = resp?.ok ? 'Saved' : (resp?.error || 'Error');
  });
});

document.getElementById('test').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'status' }, (resp) => {
    document.getElementById('status').textContent = resp?.ok ? JSON.stringify(resp.result) : (resp?.error || 'Error');
  });
});

chrome.runtime.sendMessage({ type: 'getConfig' }, (resp) => {
  if (resp?.ok && resp.config) {
    document.getElementById('url').value = resp.config.daemonUrl || '';
    document.getElementById('token').value = resp.config.token || '';
  }
});