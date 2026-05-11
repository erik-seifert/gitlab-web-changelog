(async () => {
  const statusEl = document.getElementById('status');
  const data = await chrome.storage.sync.get({ instances: [] });
  const instances = data.instances || [];

  if (!instances.length) {
    statusEl.textContent = 'No GitLab instances configured yet. Click below to add one.';
    statusEl.className = 'status warn';
  } else {
    statusEl.innerHTML = `<strong>${instances.length}</strong> instance${
      instances.length === 1 ? '' : 's'
    } configured.`;
    statusEl.className = 'status';
  }

  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
})();
