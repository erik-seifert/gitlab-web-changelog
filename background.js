// Background service worker for GitLab Changelog Generator
// Dynamically registers the content script for user-configured GitLab instances.

const SCRIPT_ID_PREFIX = 'glcg-instance-';

// Read configured instances from storage
const getInstances = async () => {
  const data = await chrome.storage.sync.get({ instances: [] });
  return data.instances || [];
};

// Build a match pattern for a base URL like "https://gitlab.example.com"
// We match anywhere under that origin (the content script itself decides
// whether the page is a tags page).
const buildMatchPattern = (baseUrl) => {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/*`;
  } catch (e) {
    return null;
  }
};

// Serialize all sync calls so concurrent triggers (onInstalled + onMessage)
// don't race and produce "Duplicate script ID" errors.
let syncQueue = Promise.resolve();
const syncContentScripts = () => {
  syncQueue = syncQueue.then(doSync).catch(console.error);
  return syncQueue;
};

const doSync = async () => {
  const instances = await getInstances();

  // Get currently registered scripts owned by us
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const existingIds = new Set(existing.map((s) => s.id));

  // Build desired registrations only for instances we have permission for
  const desired = [];
  for (const inst of instances) {
    const pattern = buildMatchPattern(inst.url);
    if (!pattern) continue;
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) continue;
    const id = SCRIPT_ID_PREFIX + sanitizeId(inst.url);
    desired.push({
      id,
      matches: [pattern],
      js: ['content.js'],
      css: ['content.css'],
      runAt: 'document_idle',
      allFrames: false,
    });
  }

  const desiredIds = new Set(desired.map((s) => s.id));

  // Unregister scripts that are no longer wanted
  const toRemove = [...existingIds].filter(
    (id) => id.startsWith(SCRIPT_ID_PREFIX) && !desiredIds.has(id)
  );
  if (toRemove.length) {
    await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  }

  // Register new scripts
  const toAdd = desired.filter((s) => !existingIds.has(s.id));
  if (toAdd.length) {
    try {
      await chrome.scripting.registerContentScripts(toAdd);
    } catch (err) {
      console.error('Failed to register content scripts:', err);
    }
  }

  // Update existing ones (in case match patterns changed for the same id)
  const toUpdate = desired.filter((s) => existingIds.has(s.id));
  if (toUpdate.length) {
    try {
      await chrome.scripting.updateContentScripts(toUpdate);
    } catch (err) {
      console.error('Failed to update content scripts:', err);
    }
  }
};

const sanitizeId = (s) => s.replace(/[^a-zA-Z0-9]/g, '_');

// Re-sync whenever the instance list changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.instances) {
    syncContentScripts();
  }
});

// Re-sync on install/update/startup
chrome.runtime.onInstalled.addListener(({ reason }) => {
  syncContentScripts();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  syncContentScripts();
});

// Allow the options page to ask us to re-sync (e.g. after granting permission)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'sync-content-scripts') {
    syncContentScripts().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});
