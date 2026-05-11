// Options page logic

const $ = (sel) => document.querySelector(sel);

const normalizeUrl = (raw) => {
  if (!raw) return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  // Add scheme if missing — default to https
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  try {
    const u = new URL(trimmed);
    // Drop path/query/hash — we only care about origin
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    return null;
  }
};

const matchPatternFor = (baseUrl) => {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}/*`;
};

const getInstances = async () => {
  const data = await chrome.storage.sync.get({ instances: [] });
  return data.instances || [];
};

const saveInstances = async (instances) => {
  await chrome.storage.sync.set({ instances });
};

const renderList = async () => {
  const listEl = $('#instance-list');
  const instances = await getInstances();
  if (!instances.length) {
    listEl.innerHTML = '<p class="empty-msg">No instances configured yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  for (const inst of instances) {
    const item = document.createElement('div');
    item.className = 'instance-item';

    const pattern = matchPatternFor(inst.url);
    const granted = await chrome.permissions.contains({ origins: [pattern] });

    item.innerHTML = `
      <div class="instance-info">
        ${inst.label ? `<span class="instance-label">${escapeHtml(inst.label)}</span>` : ''}
        <span class="instance-url">${escapeHtml(inst.url)}</span>
        <div class="instance-permission ${granted ? 'granted' : 'missing'}">
          ${granted ? '✓ Permission granted' : '⚠ Permission not granted — click "Grant" to enable'}
        </div>
      </div>
      <div class="instance-actions">
        ${
          granted
            ? '<button class="revoke-btn">Revoke Permission</button>'
            : '<button class="grant-btn primary">Grant Permission</button>'
        }
        <button class="remove-btn danger">Remove</button>
      </div>
    `;

    item.querySelector('.remove-btn').addEventListener('click', async () => {
      if (!confirm(`Remove ${inst.url}?\n\nThis will also revoke the host permission.`)) return;
      await removeInstance(inst.url);
    });

    const grantBtn = item.querySelector('.grant-btn');
    if (grantBtn) {
      grantBtn.addEventListener('click', async () => {
        const ok = await chrome.permissions.request({ origins: [pattern] });
        if (ok) {
          await notifyBackground();
          await renderList();
        } else {
          alert('Permission was not granted. The extension cannot run on this instance without it.');
        }
      });
    }

    const revokeBtn = item.querySelector('.revoke-btn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', async () => {
        if (!confirm(`Revoke permission for ${inst.url}?\n\nThe extension will no longer run there, but the entry stays in the list.`)) return;
        await chrome.permissions.remove({ origins: [pattern] });
        await notifyBackground();
        await renderList();
      });
    }

    listEl.appendChild(item);
  }
};

const addInstance = async () => {
  const urlInput = $('#new-instance-url');
  const labelInput = $('#new-instance-label');
  const statusEl = $('#add-status');
  statusEl.textContent = '';
  statusEl.className = 'status';

  const normalized = normalizeUrl(urlInput.value);
  if (!normalized) {
    statusEl.textContent = 'Please enter a valid URL.';
    statusEl.className = 'status error';
    return;
  }

  const instances = await getInstances();
  if (instances.some((i) => i.url === normalized)) {
    statusEl.textContent = 'This instance is already in the list.';
    statusEl.className = 'status error';
    return;
  }

  // Request host permission
  const pattern = matchPatternFor(normalized);
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    statusEl.textContent = `Permission request failed: ${e.message}`;
    statusEl.className = 'status error';
    return;
  }

  if (!granted) {
    statusEl.textContent =
      'Permission was not granted. The instance was NOT added — without permission the extension cannot run there.';
    statusEl.className = 'status error';
    return;
  }

  // Save
  instances.push({ url: normalized, label: labelInput.value.trim() || '' });
  await saveInstances(instances);
  urlInput.value = '';
  labelInput.value = '';
  statusEl.textContent = `Added ${normalized}.`;
  statusEl.className = 'status success';
  await notifyBackground();
  await renderList();
};

const removeInstance = async (url) => {
  const instances = await getInstances();
  const filtered = instances.filter((i) => i.url !== url);
  await saveInstances(filtered);
  try {
    await chrome.permissions.remove({ origins: [matchPatternFor(url)] });
  } catch (e) {
    // ignore
  }
  await notifyBackground();
  await renderList();
};

const notifyBackground = () =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'sync-content-scripts' }, () => resolve());
    } catch (e) {
      resolve();
    }
  });

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const DEFAULT_BRANCH_REGEX = '^(\\d+)[-_]';

const loadSettings = async () => {
  const data = await chrome.storage.sync.get({ branchRegex: DEFAULT_BRANCH_REGEX });
  $('#branch-regex').value = data.branchRegex;
};

const saveSettings = async () => {
  const statusEl = $('#settings-status');
  const branchRegexRaw = $('#branch-regex').value.trim();

  if (branchRegexRaw) {
    try {
      new RegExp(branchRegexRaw);
    } catch (e) {
      statusEl.textContent = `Invalid regex: ${e.message}`;
      statusEl.className = 'status error';
      return;
    }
  }

  await chrome.storage.sync.set({ branchRegex: branchRegexRaw });
  statusEl.textContent = 'Saved.';
  statusEl.className = 'status success';
  setTimeout(() => (statusEl.textContent = ''), 2000);
};

// Init
document.addEventListener('DOMContentLoaded', () => {
  $('#add-instance-btn').addEventListener('click', addInstance);
  $('#new-instance-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addInstance();
  });
  $('#new-instance-label').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addInstance();
  });
  $('#save-settings-btn').addEventListener('click', saveSettings);
  loadSettings();
  renderList();
});
