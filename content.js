// GitLab Changelog Generator - Content Script

(function () {
  'use strict';

  // ---------- GitLab API helpers ----------
  // Uses the logged-in user's session via credentials: 'same-origin'

  const getGitLabBase = () => `${window.location.origin}`;

  const getProjectPath = () => {
    // URL pattern: /<namespace>/<project>/-/tags
    const match = window.location.pathname.match(/^\/(.+?)\/-\/tags/);
    return match ? match[1] : null;
  };

  const getProjectInfo = async () => {
    const projectPath = getProjectPath();
    if (!projectPath) return null;
    const encoded = encodeURIComponent(projectPath);
    const resp = await fetch(`${getGitLabBase()}/api/v4/projects/${encoded}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Project lookup failed: ${resp.status}`);
    return resp.json();
  };

  const getProjectId = async () => {
    const info = await getProjectInfo();
    return info ? info.id : null;
  };

  const fetchBranches = async (projectId) => {
    const resp = await fetch(
      `${getGitLabBase()}/api/v4/projects/${projectId}/repository/branches?per_page=100`,
      { credentials: 'same-origin', headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) throw new Error(`Branches fetch failed: ${resp.status}`);
    return resp.json();
  };

  const fetchCommitBranches = async (projectId, sha) => {
    const resp = await fetch(
      `${getGitLabBase()}/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(sha)}/refs?type=branch`,
      { credentials: 'same-origin', headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) return [];
    return resp.json();
  };

  const fetchAllTags = async (projectId) => {
    const tags = [];
    let page = 1;
    while (true) {
      const resp = await fetch(
        `${getGitLabBase()}/api/v4/projects/${projectId}/repository/tags?per_page=100&page=${page}`,
        { credentials: 'same-origin', headers: { Accept: 'application/json' } }
      );
      if (!resp.ok) throw new Error(`Tags fetch failed: ${resp.status}`);
      const batch = await resp.json();
      tags.push(...batch);
      if (batch.length < 100) break;
      page += 1;
      if (page > 20) break; // safety stop
    }
    return tags;
  };

  const fetchCompare = async (projectId, fromTag, toTag) => {
    // from = older, to = newer
    const url = `${getGitLabBase()}/api/v4/projects/${projectId}/repository/compare?from=${encodeURIComponent(
      fromTag
    )}&to=${encodeURIComponent(toTag)}`;
    const resp = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Compare failed: ${resp.status}`);
    return resp.json();
  };

  const fetchIssue = async (projectId, iid) => {
    const url = `${getGitLabBase()}/api/v4/projects/${projectId}/issues/${iid}`;
    const resp = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    return resp.json();
  };

  // Parse issue references from a commit message.
  // Handles: #123, project!ref#123, Closes #123, etc.
  // Also handles MR references like !456 to fetch related issues.
  const extractIssueRefs = (message) => {
    const refs = new Set();
    const issueRegex = /(?:^|[^&\w])#(\d+)/g;
    let m;
    while ((m = issueRegex.exec(message)) !== null) {
      refs.add(parseInt(m[1], 10));
    }
    return Array.from(refs);
  };

  // Extract explicit cross-project refs like "group/project#77" or "project#77".
  // Returns [{projectRef, iid}]. Plain "#77" refs are ignored here (handled by extractIssueRefs).
  const extractCrossProjectRefs = (text) => {
    const refs = [];
    const seen = new Set();
    const regex = /([\w.-]+(?:\/[\w.-]+)+)#(\d+)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const projectRef = m[1];
      const iid = parseInt(m[2], 10);
      const key = `${projectRef}#${iid}`;
      if (!seen.has(key)) { seen.add(key); refs.push({ projectRef, iid }); }
    }
    return refs;
  };

  // Extract an issue number from a branch name using the user-configured regex.
  // The regex must have one capture group for the issue number.
  const extractIssueFromBranch = (branchName, regex) => {
    if (!branchName || !regex) return null;
    const m = branchName.match(regex);
    return m && m[1] ? parseInt(m[1], 10) : null;
  };

  const extractMrRefs = (message) => {
    const refs = new Set();
    const mrRegex = /(?:^|[^&\w])!(\d+)/g;
    let m;
    while ((m = mrRegex.exec(message)) !== null) {
      refs.add(parseInt(m[1], 10));
    }
    return Array.from(refs);
  };

  const fetchMrClosedIssues = async (projectId, mrIid) => {
    const url = `${getGitLabBase()}/api/v4/projects/${projectId}/merge_requests/${mrIid}/closes_issues`;
    const resp = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return [];
    return resp.json();
  };

  // POST (create) or PUT (update) a wiki page. Returns the page object (includes slug, not web_url).
  // GitLab requires X-CSRF-Token for POST/PUT requests that use session-cookie auth.
  // The token is injected into every page as <meta name="csrf-token">.
  const getCsrfToken = () =>
    document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';

  const publishWikiPage = async (projectId, title, content) => {
    const base = `${getGitLabBase()}/api/v4/projects/${projectId}/wikis`;
    const body = JSON.stringify({ title, content, format: 'markdown' });
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    };
    let resp = await fetch(base, { method: 'POST', credentials: 'same-origin', headers, body });
    if (resp.status === 409) {
      // Page already exists — update it. Slug uses the title with slashes encoded.
      const slug = title.split('/').map(encodeURIComponent).join('%2F');
      resp = await fetch(`${base}/${slug}`, { method: 'PUT', credentials: 'same-origin', headers, body });
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      let msg = `${resp.status}: ${text}`;
      if (resp.status === 404) {
        msg = 'Wiki not found (404). Make sure the Wiki feature is enabled for this project: Settings → General → Visibility → Wiki.';
      }
      throw new Error(msg);
    }
    return resp.json();
  };

  // GET /projects/:id/repository/commits/:sha/merge_requests
  // Returns all MRs that include this commit (open and merged).
  const fetchCommitMrs = async (projectId, sha) => {
    const url = `${getGitLabBase()}/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(
      sha
    )}/merge_requests`;
    const resp = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return [];
    return resp.json();
  };

  // Run async tasks with bounded concurrency.
  // tasks: array of () => Promise. onProgress(doneCount) optional.
  const runWithConcurrency = async (tasks, limit, onProgress) => {
    const results = new Array(tasks.length);
    let nextIndex = 0;
    let done = 0;
    const workers = new Array(Math.min(limit, tasks.length))
      .fill(null)
      .map(async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= tasks.length) return;
          try {
            results[i] = await tasks[i]();
          } catch (e) {
            results[i] = undefined;
          }
          done += 1;
          if (onProgress) onProgress(done);
        }
      });
    await Promise.all(workers);
    return results;
  };

  // ---------- Icon injection on tags page ----------

  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h5A1.5 1.5 0 0 1 9.56 1.44l5 5a1.5 1.5 0 0 1 0 2.12l-5 5a1.5 1.5 0 0 1-2.12 0l-5-5A1.5 1.5 0 0 1 2 7.5v-5zM3.5 2a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .146.354l5 5a.5.5 0 0 0 .708 0l5-5a.5.5 0 0 0 0-.708l-5-5A.5.5 0 0 0 8.5 2h-5zM5 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/><path d="M11.5 9.5a.5.5 0 0 1 .5.5v2.5a.5.5 0 0 1-.146.354l-1.5 1.5a.5.5 0 0 1-.708-.708L11 12.293V10a.5.5 0 0 1 .5-.5z" opacity=".5"/></svg>`;

  const findTagRows = () => {
    // Try multiple selectors as GitLab's DOM changes across versions.
    // We look for elements that contain a link to /-/tags/<name>
    const links = document.querySelectorAll(
      'a[href*="/-/tags/"]:not(.glcg-injected)'
    );
    const rows = [];
    const seen = new Set();
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      // Skip the index page itself
      if (/\/-\/tags\/?$/.test(href)) return;
      // Skip release/edit links
      if (/\/-\/tags\/[^/]+\/(edit|release)/.test(href)) return;
      const match = href.match(/\/-\/tags\/([^?#/]+)/);
      if (!match) return;
      const tagName = decodeURIComponent(match[1]);
      // Find a sensible container (the row/card holding this tag)
      const container =
        link.closest('li') ||
        link.closest('.gl-card') ||
        link.closest('.tag-row') ||
        link.parentElement;
      if (!container) return;
      const key = tagName + '::' + (container.dataset.glcgKey || '');
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ link, container, tagName });
    });
    return rows;
  };

  const injectIcons = () => {
    const rows = findTagRows();
    rows.forEach(({ link, tagName }) => {
      if (link.classList.contains('glcg-injected')) return;
      link.classList.add('glcg-injected');

      const btn = document.createElement('button');
      btn.className = 'glcg-icon-btn';
      btn.title = `Generate changelog from ${tagName}…`;
      btn.setAttribute('aria-label', `Generate changelog from ${tagName}`);
      btn.innerHTML = ICON_SVG;
      btn.dataset.tag = tagName;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(tagName);
      });

      // Insert right after the tag link
      link.insertAdjacentElement('afterend', btn);
    });
  };

  // Observe DOM changes (GitLab is a SPA; rows may render late)
  const observer = new MutationObserver(() => {
    if (!/\/-\/tags(\/|$|\?)/.test(window.location.pathname)) return;
    injectIcons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ---------- Project autocomplete ----------

  const searchProjects = async (query) => {
    const url = `${getGitLabBase()}/api/v4/projects?search=${encodeURIComponent(query)}&membership=true&simple=true&per_page=10`;
    const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!resp.ok) return [];
    return resp.json();
  };

  const relativeDate = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `vor ${minutes} Min.`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `vor ${months} Monat${months !== 1 ? 'en' : ''}`;
    return `vor ${Math.floor(months / 12)} Jahr${Math.floor(months / 12) !== 1 ? 'en' : ''}`;
  };

  // Wire up local branch autocomplete (client-side filtering, no API calls).
  const setupBranchAutocomplete = (input, listEl, branches) => {
    const show = (list) => {
      if (!list.length) { listEl.hidden = true; return; }
      listEl.innerHTML = list.map((b) =>
        `<div class="glcg-ac-item" role="option" data-name="${escapeHtml(b.name)}">
          <span class="glcg-ac-name">${escapeHtml(b.name)}</span>
          <span class="glcg-ac-path">${relativeDate(b.commit.committed_date)}</span>
        </div>`
      ).join('');
      listEl.querySelectorAll('.glcg-ac-item').forEach((item) => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = item.dataset.name;
          listEl.hidden = true;
        });
      });
      listEl.hidden = false;
    };
    const filter = () => {
      const q = input.value.trim().toLowerCase();
      const matches = q
        ? branches.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 10)
        : branches.slice(0, 10);
      show(matches);
    };
    input.addEventListener('input', filter);
    input.addEventListener('focus', filter);
    input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 150));
  };

  // Wire up project autocomplete on an input + its adjacent .glcg-ac-list element.
  // onSelect(path) is called when the user picks a suggestion.
  const setupAutocomplete = (input, listEl, onSelect) => {
    const show = (projects) => {
      if (!projects.length) { listEl.hidden = true; return; }
      listEl.innerHTML = projects.map((p) =>
        `<div class="glcg-ac-item" role="option" data-path="${escapeHtml(p.path_with_namespace)}">
          <span class="glcg-ac-name">${escapeHtml(p.name_with_namespace)}</span>
          <span class="glcg-ac-path">${escapeHtml(p.path_with_namespace)}</span>
        </div>`
      ).join('');
      listEl.querySelectorAll('.glcg-ac-item').forEach((item) => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = item.dataset.path;
          listEl.hidden = true;
          if (onSelect) onSelect(item.dataset.path);
        });
      });
      listEl.hidden = false;
    };
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { listEl.hidden = true; return; }
      timer = setTimeout(async () => show(await searchProjects(q)), 300);
    });
    input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 150));
    input.addEventListener('focus', () => { if (listEl.children.length) listEl.hidden = false; });
  };

  // ---------- Modal ----------

  let modalEl = null;

  const openModal = async (fromTag) => {
    if (modalEl) modalEl.remove();
    modalEl = document.createElement('div');
    modalEl.className = 'glcg-modal-backdrop';
    modalEl.innerHTML = `
      <div class="glcg-modal" role="dialog" aria-modal="true" aria-labelledby="glcg-title">
        <div class="glcg-modal-header">
          <h2 id="glcg-title">Changelog Generator</h2>
          <button class="glcg-close" aria-label="Close">×</button>
        </div>
        <div class="glcg-modal-body">
          <div class="glcg-row">
            <label>From tag (older):</label>
            <div class="glcg-from-tag"><strong>${escapeHtml(fromTag)}</strong></div>
          </div>
          <div class="glcg-row" id="glcg-to-tag-row">
            <label for="glcg-to-tag">To tag (newer):</label>
            <select id="glcg-to-tag"><option>Loading tags…</option></select>
          </div>
          <div class="glcg-row" id="glcg-to-branch-row" hidden>
            <label for="glcg-to-branch">Branch:</label>
            <div class="glcg-ac-wrap">
              <input type="text" id="glcg-to-branch" autocomplete="off" spellcheck="false" placeholder="Branch suchen…" />
              <div class="glcg-ac-list" role="listbox"></div>
            </div>
          </div>
          <div class="glcg-row">
            <label for="glcg-issue-project">Issue project:</label>
            <div class="glcg-ac-wrap">
              <input
                type="text"
                id="glcg-issue-project"
                autocomplete="off"
                spellcheck="false"
                placeholder="group/project (type 3+ chars to search)"
              />
              <div class="glcg-ac-list" role="listbox" aria-label="Project suggestions"></div>
            </div>
          </div>
          <div class="glcg-row">
            <button class="glcg-generate" disabled>Generate Changelog</button>
            <button class="glcg-swap" title="Swap from/to">⇄ Swap</button>
          </div>
          <div class="glcg-status"></div>
          <div class="glcg-output"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('.glcg-close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    const select = modalEl.querySelector('#glcg-to-tag');
    const branchInput = modalEl.querySelector('#glcg-to-branch');
    const toTagRow = modalEl.querySelector('#glcg-to-tag-row');
    const toBranchRow = modalEl.querySelector('#glcg-to-branch-row');
    const branchListEl = toBranchRow.querySelector('.glcg-ac-list');
    const generateBtn = modalEl.querySelector('.glcg-generate');
    const swapBtn = modalEl.querySelector('.glcg-swap');
    const status = modalEl.querySelector('.glcg-status');

    let currentFrom = fromTag;
    let projectId;
    let tags = [];
    let compareMode = 'tag'; // 'tag' | 'branch'

    const issueProjectInput = modalEl.querySelector('#glcg-issue-project');
    setupAutocomplete(issueProjectInput, issueProjectInput.closest('.glcg-ac-wrap').querySelector('.glcg-ac-list'));

    // ---------- Load project info + saved issue project ----------
    const currentProjectPath = getProjectPath();
    const storageKey = `issueProject:${currentProjectPath}`;

    try {
      status.textContent = 'Loading project info…';
      const projectInfo = await getProjectInfo();
      projectId = projectInfo.id;
      const defaultBranchName = projectInfo.default_branch || 'main';
      const stored = await chrome.storage.sync.get({ [storageKey]: '' });
      const savedIssueProject = stored[storageKey];
      issueProjectInput.value = (savedIssueProject && savedIssueProject !== currentProjectPath) ? savedIssueProject : '';
      issueProjectInput.placeholder = currentProjectPath || 'group/project (type 3+ chars to search)';
      status.textContent = 'Loading tags…';
      tags = await fetchAllTags(projectId);

      // Populate tag dropdown
      const otherTags = tags.filter((t) => t.name !== currentFrom);
      select.innerHTML = otherTags
        .map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`)
        .join('');
      const idx = tags.findIndex((t) => t.name === currentFrom);
      if (idx > 0) {
        select.value = tags[idx - 1].name;
      }

      // If this is the newest tag (idx === 0), switch to branch comparison mode
      if (idx === 0) {
        toTagRow.hidden = true;
        toBranchRow.hidden = false;
        swapBtn.style.display = 'none';
        compareMode = 'branch';

        status.textContent = 'Loading branches…';
        try {
          const tagCommitSha = tags[0].commit.id;
          const [branches, commitRefs] = await Promise.all([
            fetchBranches(projectId),
            fetchCommitBranches(projectId, tagCommitSha),
          ]);
          // Sort by most recently committed
          branches.sort((a, b) =>
            new Date(b.commit.committed_date) - new Date(a.commit.committed_date)
          );
          setupBranchAutocomplete(branchInput, branchListEl, branches);
          // Pre-select the branch the tag was created on:
          // 1. Branch whose HEAD is exactly the tag commit (tag was created at branch tip)
          // 2. Default branch if it contains the tag commit
          // 3. First branch that contains the tag commit
          // 4. Default branch as last resort
          const refNames = new Set(commitRefs.map((r) => r.name));
          const exactMatch = branches.find((b) => b.commit.id === tagCommitSha && refNames.has(b.name));
          const best = exactMatch
            ? exactMatch.name
            : refNames.has(defaultBranchName)
              ? defaultBranchName
              : (commitRefs[0] ? commitRefs[0].name : defaultBranchName);
          branchInput.value = best;
        } catch (e) {
          branchInput.placeholder = 'Branches konnten nicht geladen werden';
        }
      }

      generateBtn.disabled = false;
      status.textContent = '';
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      return;
    }

    swapBtn.addEventListener('click', () => {
      const toTag = select.value;
      if (!toTag) return;
      const newFrom = toTag;
      const newTo = currentFrom;
      currentFrom = newFrom;
      modalEl.querySelector('.glcg-from-tag').innerHTML =
        `<strong>${escapeHtml(newFrom)}</strong>`;
      const otherTags = tags.filter((t) => t.name !== newFrom);
      select.innerHTML = otherTags
        .map((t) =>
          `<option value="${escapeHtml(t.name)}" ${
            t.name === newTo ? 'selected' : ''
          }>${escapeHtml(t.name)}</option>`
        )
        .join('');
    });

    generateBtn.addEventListener('click', async () => {
      const toRef = compareMode === 'branch' ? branchInput.value.trim() : select.value;
      if (!toRef) return;
      const issueProjectPath = issueProjectInput.value.trim() || currentProjectPath;
      await chrome.storage.sync.set({ [storageKey]: issueProjectPath });
      await generateChangelog(projectId, currentFrom, toRef, modalEl, issueProjectPath);
    });
  };

  const closeModal = () => {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  };

  // ---------- Changelog generation ----------

  // Resolve a project path to its numeric ID, with caching across calls.
  const projectIdCache = new Map();
  const resolveProjectId = async (path) => {
    if (projectIdCache.has(path)) return projectIdCache.get(path);
    const resp = await fetch(
      `${getGitLabBase()}/api/v4/projects/${encodeURIComponent(path)}`,
      { credentials: 'same-origin', headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) return null;
    const { id } = await resp.json();
    projectIdCache.set(path, id);
    return id;
  };

  const generateChangelog = async (projectId, fromTag, toTag, modal, issueProjectPath) => {
    const status = modal.querySelector('.glcg-status');
    const output = modal.querySelector('.glcg-output');
    output.innerHTML = '';
    status.textContent = 'Fetching commits…';

    try {
      // Load settings.
      const { branchRegex: branchRegexStr = '^(\\d+)[-_]' } =
        await chrome.storage.sync.get({ branchRegex: '^(\\d+)[-_]' });
      const projectPath = getProjectPath();
      const base = getGitLabBase();

      // Resolve issue project ID (may differ from the code project).
      // Used for commit-message #NNN refs and branch-regex fallback.
      let issueProjectId = projectId;
      if (issueProjectPath && issueProjectPath !== projectPath) {
        status.textContent = 'Resolving issue project…';
        const resolved = await resolveProjectId(issueProjectPath);
        if (resolved) {
          issueProjectId = resolved;
        } else {
          status.textContent = `Warning: could not resolve issue project "${issueProjectPath}", falling back to current project.`;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      const compare = await fetchCompare(projectId, fromTag, toTag);
      const commits = compare.commits || [];
      status.textContent = `Found ${commits.length} commits.`;

      const CONCURRENCY = 5;
      const issueIids = new Set();
      const commitIssueMap = new Map(); // commit.id -> Set of iids
      const mrIssueCache = new Map(); // mrIid -> Array of issue iids

      // Step 1: For every commit, find all MRs that include it.
      status.textContent = `Looking up MRs for ${commits.length} commits…`;
      const commitMrTasks = commits.map((c) => async () => {
        const mrs = await fetchCommitMrs(projectId, c.id);
        return { commit: c, mrs };
      });
      let progress = 0;
      const commitMrResults = await runWithConcurrency(
        commitMrTasks,
        CONCURRENCY,
        (done) => {
          progress = done;
          status.textContent = `Looking up MRs (${done}/${commits.length})…`;
        }
      );

      // Collect unique MRs (keyed by mrProjectId:iid) and build commit→MRs map.
      // We must track project_id per MR so closes_issues is called against the
      // correct project — otherwise cross-project MRs return 404 and no issues.
      const uniqueMrs = new Map(); // `${mrProjectId}:${iid}` -> {mrProjectId, iid}
      const commitMrs = new Map(); // commit.id -> Array of mr objects
      for (const result of commitMrResults) {
        if (!result) continue;
        const { commit, mrs } = result;
        commitMrs.set(commit.id, mrs);
        for (const mr of mrs) {
          const mrProjectId = mr.project_id || projectId;
          uniqueMrs.set(`${mrProjectId}:${mr.iid}`, { mrProjectId, iid: mr.iid });
        }
      }

      // Also pick up bare #NNN references from commit messages (sometimes
      // people reference an issue directly without a MR).
      for (const c of commits) {
        const msg = c.message || c.title || '';
        const direct = extractIssueRefs(msg);
        if (direct.length) {
          if (!commitIssueMap.has(c.id)) commitIssueMap.set(c.id, new Set());
          direct.forEach((iid) => {
            commitIssueMap.get(c.id).add(iid);
            issueIids.add(iid);
          });
        }
      }

      // Step 2: For each unique MR, fetch its closes_issues.
      // Use mrProjectId (from mr.project_id) — not always the same as projectId.
      // Cross-project MRs have their own project_id; using the wrong one returns 404.
      status.textContent = `Resolving issues for ${uniqueMrs.size} MRs…`;
      const mrList = Array.from(uniqueMrs.values());
      const mrIssueTasks = mrList.map(({ mrProjectId, iid: mrIid }) => async () => {
        const issues = await fetchMrClosedIssues(mrProjectId, mrIid);
        return { mrKey: `${mrProjectId}:${mrIid}`, mrIid, issues };
      });
      const mrIssueResults = await runWithConcurrency(
        mrIssueTasks,
        CONCURRENCY,
        (done) => {
          status.textContent = `Resolving MR issues (${done}/${mrList.length})…`;
        }
      );

      // Use issue objects from closes_issues directly — avoids a redundant fetch
      // and works correctly even when the issue is from another project.
      const prefetchedIssues = new Map(); // iid -> full issue object

      for (const r of mrIssueResults) {
        if (!r) continue;
        const iids = [...new Set(r.issues.map((i) => {
          prefetchedIssues.set(i.iid, i);
          return i.iid;
        }))];
        mrIssueCache.set(r.mrKey, iids);
        iids.forEach((iid) => issueIids.add(iid));
      }

      // Fallback: for MRs that still have no linked issues, try the branch name regex.
      let branchRegex = null;
      if (branchRegexStr) {
        try { branchRegex = new RegExp(branchRegexStr); } catch (e) { /* invalid, skip */ }
      }
      if (branchRegex) {
        const seenMrs = new Set();
        for (const [, mrs] of commitMrs.entries()) {
          for (const mr of mrs) {
            const mrProjectId = mr.project_id || projectId;
            const mrKey = `${mrProjectId}:${mr.iid}`;
            if (seenMrs.has(mrKey)) continue;
            seenMrs.add(mrKey);
            const cached = mrIssueCache.get(mrKey);
            if (!cached || cached.length === 0) {
              const iid = extractIssueFromBranch(mr.source_branch, branchRegex);
              if (iid !== null) {
                mrIssueCache.set(mrKey, [iid]);
                issueIids.add(iid);
              }
            }
          }
        }
      }

      // Attribute issues back to commits via their MRs
      for (const [commitId, mrs] of commitMrs.entries()) {
        if (!commitIssueMap.has(commitId)) commitIssueMap.set(commitId, new Set());
        for (const mr of mrs) {
          const mrProjectId = mr.project_id || projectId;
          const mrKey = `${mrProjectId}:${mr.iid}`;
          const iids = mrIssueCache.get(mrKey) || [];
          iids.forEach((iid) => commitIssueMap.get(commitId).add(iid));
        }
      }

      // Step 3: Resolve explicit cross-project refs (e.g. "group/other#77").
      // These are authoritative — an explicit project path in the text is always
      // preferred over any configured fallback project.
      const issuesByIid = new Map(prefetchedIssues);

      // Collect all cross-project refs and build iid → projectRef index.
      const crossRefByIid = new Map(); // iid -> projectRef (for URL construction even on API failure)
      const byProject = new Map();     // projectRef -> [iid, …]
      const collectCrossRefs = (text) => {
        for (const { projectRef, iid } of extractCrossProjectRefs(text)) {
          if (!crossRefByIid.has(iid)) crossRefByIid.set(iid, projectRef);
          if (!byProject.has(projectRef)) byProject.set(projectRef, []);
          if (!byProject.get(projectRef).includes(iid)) byProject.get(projectRef).push(iid);
        }
      };
      for (const [, mrs] of commitMrs.entries()) {
        for (const mr of mrs) collectCrossRefs(mr.description || '');
      }
      for (const c of commits) collectCrossRefs(c.message || '');

      if (byProject.size > 0) {
        status.textContent = `Resolving cross-project issues…`;
        for (const [projectRef, iids] of byProject.entries()) {
          const pid = await resolveProjectId(projectRef);
          if (!pid) continue;
          const tasks = iids.map((iid) => async () => {
            const issue = await fetchIssue(pid, iid);
            return issue ? { iid, issue } : null;
          });
          const results = await runWithConcurrency(tasks, CONCURRENCY, null);
          for (const r of results) {
            if (r) issuesByIid.set(r.iid, r.issue);
          }
        }
      }

      // Step 4: Fetch remaining iids (branch regex, commit-message refs) from the
      // issue project. Iids covered by a cross-project ref are excluded —
      // if the API call above failed for them, they get a placeholder with the correct URL.
      const toFetch = Array.from(issueIids)
        .filter((iid) => !issuesByIid.has(iid) && !crossRefByIid.has(iid));
      if (toFetch.length > 0) {
        status.textContent = `Fetching ${toFetch.length} issues…`;
        const issueTasks = toFetch.map((iid) => async () => {
          const issue = await fetchIssue(issueProjectId, iid);
          return { iid, issue };
        });
        const issueResults = await runWithConcurrency(
          issueTasks,
          CONCURRENCY,
          (done) => {
            status.textContent = `Fetching issues (${done}/${toFetch.length})…`;
          }
        );
        for (const r of issueResults) {
          if (r && r.issue) issuesByIid.set(r.iid, r.issue);
        }
      }

      // Placeholder for any iid that still couldn't be resolved.
      // Use the cross-project ref's path if known, otherwise the user-selected issue project.
      const issueFallbackPath = issueProjectPath || projectPath;
      for (const iidSet of commitIssueMap.values()) {
        for (const iid of iidSet) {
          if (!issuesByIid.has(iid)) {
            const refPath = crossRefByIid.get(iid) || issueFallbackPath;
            issuesByIid.set(iid, {
              iid,
              title: null,
              state: 'referenced',
              labels: [],
              web_url: `${base}/${refPath}/-/issues/${iid}`,
            });
          }
        }
      }

      status.textContent = `Done. ${commits.length} commits → ${issuesByIid.size} issues.`;
      renderChangelog(output, fromTag, toTag, commits, commitIssueMap, issuesByIid, projectId);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  };

  const renderChangelog = (
    container,
    fromTag,
    toTag,
    commits,
    commitIssueMap,
    issuesByIid,
    projectId
  ) => {
    const wrap = document.createElement('div');
    wrap.className = 'glcg-changelog';

    // Top header — title + global export
    const header = document.createElement('div');
    header.className = 'glcg-changelog-header';
    header.innerHTML = `
      <h3>Changelog: <code>${escapeHtml(fromTag)}</code> → <code>${escapeHtml(toTag)}</code></h3>
      <div class="glcg-actions">
        <button class="glcg-export-md primary">Export as Markdown</button>
        <button class="glcg-publish-wiki">Publish to Wiki</button>
      </div>
    `;
    wrap.appendChild(header);

    header.querySelector('.glcg-export-md').addEventListener('click', () => {
      const md = buildFullMarkdown(fromTag, toTag, commits, commitIssueMap, issuesByIid);
      downloadMarkdown(fromTag, toTag, md);
    });

    // -------- Wiki publish panel --------
    const wikiPanel = document.createElement('div');
    wikiPanel.className = 'glcg-wiki-panel';
    wikiPanel.hidden = true;
    wikiPanel.innerHTML = `
      <div class="glcg-wiki-row">
        <label>Project:</label>
        <div class="glcg-ac-wrap">
          <input class="glcg-wiki-project" type="text" autocomplete="off" spellcheck="false"
            placeholder="group/project (type 3+ chars to search)" />
          <div class="glcg-ac-list" role="listbox"></div>
        </div>
      </div>
      <div class="glcg-wiki-row">
        <label>Wiki path:</label>
        <input class="glcg-wiki-parent" type="text" placeholder="releases" autocomplete="off" spellcheck="false" />
        <span class="glcg-wiki-sep">/</span>
        <input class="glcg-wiki-slug" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(toTag)}" />
      </div>
      <div class="glcg-wiki-preview">Full path: <code class="glcg-wiki-path"></code></div>
      <div class="glcg-wiki-footer">
        <button class="glcg-wiki-confirm primary" disabled>Publish</button>
        <button class="glcg-wiki-cancel">Cancel</button>
        <span class="glcg-wiki-status"></span>
      </div>
    `;
    wrap.appendChild(wikiPanel);

    const wikiProjectInput = wikiPanel.querySelector('.glcg-wiki-project');
    const wikiParentInput = wikiPanel.querySelector('.glcg-wiki-parent');
    const wikiSlugInput = wikiPanel.querySelector('.glcg-wiki-slug');
    const wikiPathPreview = wikiPanel.querySelector('.glcg-wiki-path');
    const wikiConfirmBtn = wikiPanel.querySelector('.glcg-wiki-confirm');
    const wikiStatus = wikiPanel.querySelector('.glcg-wiki-status');
    const codeProjectPath = getProjectPath();
    const wikiProjectStorageKey = `wikiProject:${codeProjectPath}`;
    const wikiParentStorageKey = `wikiParent:${codeProjectPath}`;

    setupAutocomplete(wikiProjectInput, wikiPanel.querySelector('.glcg-ac-list'));

    const updateWikiPath = () => {
      const parent = wikiParentInput.value.trim();
      const slug = wikiSlugInput.value.trim();
      const full = parent ? `${parent}/${slug}` : slug;
      wikiPathPreview.textContent = full || '—';
      wikiConfirmBtn.disabled = !slug || !wikiProjectInput.value.trim();
    };
    wikiProjectInput.addEventListener('input', updateWikiPath);
    wikiParentInput.addEventListener('input', updateWikiPath);
    wikiSlugInput.addEventListener('input', updateWikiPath);

    header.querySelector('.glcg-publish-wiki').addEventListener('click', async () => {
      if (!wikiPanel.hidden) { wikiPanel.hidden = true; return; }
      const stored = await chrome.storage.sync.get({
        [wikiProjectStorageKey]: '',
        [wikiParentStorageKey]: '',
      });
      const savedWikiProject = stored[wikiProjectStorageKey];
      wikiProjectInput.value = (savedWikiProject && savedWikiProject !== codeProjectPath) ? savedWikiProject : '';
      wikiProjectInput.placeholder = codeProjectPath || 'group/project (type 3+ chars to search)';
      wikiParentInput.value = stored[wikiParentStorageKey];
      updateWikiPath();
      wikiPanel.hidden = false;
      wikiProjectInput.focus();
    });

    wikiPanel.querySelector('.glcg-wiki-cancel').addEventListener('click', () => {
      wikiPanel.hidden = true;
      wikiStatus.textContent = '';
    });

    wikiConfirmBtn.addEventListener('click', async () => {
      const wikiProjectPath = wikiProjectInput.value.trim();
      const parent = wikiParentInput.value.trim();
      const slug = wikiSlugInput.value.trim();
      if (!slug || !wikiProjectPath) return;
      const title = parent ? `${parent}/${slug}` : slug;

      wikiConfirmBtn.disabled = true;
      wikiStatus.textContent = 'Resolving project…';
      let wikiPid;
      try {
        wikiPid = await resolveProjectId(wikiProjectPath);
        if (!wikiPid) throw new Error(`Project not found: ${wikiProjectPath}`);
      } catch (e) {
        wikiStatus.textContent = `Error: ${e.message}`;
        wikiConfirmBtn.disabled = false;
        return;
      }

      await chrome.storage.sync.set({
        [wikiProjectStorageKey]: wikiProjectPath,
        [wikiParentStorageKey]: parent,
      });

      const md = buildFullMarkdown(fromTag, toTag, commits, commitIssueMap, issuesByIid);
      wikiStatus.textContent = 'Publishing…';
      try {
        const page = await publishWikiPage(wikiPid, title, md);
        // The wiki API response doesn't include web_url — build it from the project path
        // and the slug the API returns (which may differ from the title due to encoding).
        const pageSlug = page.slug || title;
        const wikiUrl = `${getGitLabBase()}/${wikiProjectPath}/-/wikis/${pageSlug}`;
        wikiStatus.innerHTML = `Published! <a href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener">Open page →</a>`;
      } catch (e) {
        wikiStatus.textContent = `Error: ${e.message}`;
      }
      wikiConfirmBtn.disabled = false;
    });

    // -------- Issues section --------
    const issuesSection = document.createElement('div');
    issuesSection.className = 'glcg-section';
    const issuesHeader = document.createElement('div');
    issuesHeader.className = 'glcg-section-header';
    issuesHeader.innerHTML = `
      <h4>Issues (${issuesByIid.size})</h4>
      <button class="glcg-copy-issues">Copy Issues</button>
    `;
    issuesSection.appendChild(issuesHeader);

    if (issuesByIid.size > 0) {
      const issuesByState = { opened: [], closed: [], other: [], referenced: [] };
      issuesByIid.forEach((iss) => {
        if (iss.state === 'closed') issuesByState.closed.push(iss);
        else if (iss.state === 'opened') issuesByState.opened.push(iss);
        else if (iss.state === 'referenced') issuesByState.referenced.push(iss);
        else issuesByState.other.push(iss);
      });

      const renderIssueGroup = (title, list) => {
        if (!list.length) return;
        const group = document.createElement('div');
        group.className = 'glcg-issue-group';
        group.innerHTML = `<h5>${escapeHtml(title)} (${list.length})</h5>`;
        const ul = document.createElement('ul');
        list
          .sort((a, b) => a.iid - b.iid)
          .forEach((iss) => {
            const li = document.createElement('li');
            const linkText = iss.title
              ? `#${iss.iid} ${escapeHtml(iss.title)}`
              : `#${iss.iid}`;
            li.innerHTML = `<a href="${escapeHtml(iss.web_url)}" target="_blank" rel="noopener">${linkText}</a>`;
            ul.appendChild(li);
          });
        group.appendChild(ul);
        issuesSection.appendChild(group);
      };

      renderIssueGroup('Closed', issuesByState.closed);
      renderIssueGroup('Open', issuesByState.opened);
      renderIssueGroup('Other', issuesByState.other);
      renderIssueGroup('Referenced', issuesByState.referenced);
    } else {
      const empty = document.createElement('p');
      empty.innerHTML = '<em>No linked issues found.</em>';
      issuesSection.appendChild(empty);
    }

    issuesHeader.querySelector('.glcg-copy-issues').addEventListener('click', () => {
      const md = buildIssuesMarkdown(fromTag, toTag, issuesByIid);
      navigator.clipboard.writeText(md);
      flashStatus(issuesHeader, 'Issues copied!');
    });

    wrap.appendChild(issuesSection);

    // -------- Commits section --------
    const commitsSection = document.createElement('div');
    commitsSection.className = 'glcg-section';
    const commitsHeader = document.createElement('div');
    commitsHeader.className = 'glcg-section-header';
    commitsHeader.innerHTML = `
      <h4>Commits (${commits.length})</h4>
      <button class="glcg-copy-commits">Copy Commits</button>
    `;
    commitsSection.appendChild(commitsHeader);

    if (commits.length > 0) {
      const cList = document.createElement('ul');
      cList.className = 'glcg-commits';
      commits.forEach((c) => {
        const li = document.createElement('li');
        const shortId = (c.id || '').substring(0, 8);
        const iids = Array.from(commitIssueMap.get(c.id) || []);
        const issueChips = iids
          .map((iid) => {
            const iss = issuesByIid.get(iid);
            if (!iss) return `<span class="glcg-chip">#${iid}</span>`;
            return `<a class="glcg-chip" href="${escapeHtml(iss.web_url)}" target="_blank" rel="noopener" title="${escapeHtml(iss.title)}">#${iid}</a>`;
          })
          .join(' ');
        const commitUrl = c.web_url || '';
        const commitLink = commitUrl
          ? `<a href="${escapeHtml(commitUrl)}" target="_blank" rel="noopener"><code>${escapeHtml(shortId)}</code></a>`
          : `<code>${escapeHtml(shortId)}</code>`;
        li.innerHTML = `
          ${commitLink}
          ${escapeHtml(c.title || '')}
          ${issueChips}
        `;
        cList.appendChild(li);
      });
      commitsSection.appendChild(cList);
    } else {
      const empty = document.createElement('p');
      empty.innerHTML = '<em>No commits in this range.</em>';
      commitsSection.appendChild(empty);
    }

    commitsHeader.querySelector('.glcg-copy-commits').addEventListener('click', () => {
      const md = buildCommitsMarkdown(fromTag, toTag, commits, commitIssueMap, issuesByIid);
      navigator.clipboard.writeText(md);
      flashStatus(commitsHeader, 'Commits copied!');
    });

    wrap.appendChild(commitsSection);
    container.appendChild(wrap);
  };

  const flashStatus = (el, text) => {
    let f = el.querySelector('.glcg-flash');
    if (!f) {
      f = document.createElement('span');
      f.className = 'glcg-flash';
      el.appendChild(f);
    }
    f.textContent = text;
    setTimeout(() => f && (f.textContent = ''), 2000);
  };

  const buildIssuesMarkdown = (fromTag, toTag, issuesByIid) => {
    const lines = [];
    lines.push(`## Issues (${issuesByIid.size}) — ${fromTag} → ${toTag}`);
    lines.push('');
    if (issuesByIid.size === 0) {
      lines.push('_No linked issues found._');
      return lines.join('\n');
    }
    const sorted = Array.from(issuesByIid.values()).sort((a, b) => a.iid - b.iid);
    const groups = [
      ['Closed', sorted.filter((i) => i.state === 'closed')],
      ['Open', sorted.filter((i) => i.state === 'opened')],
      ['Other', sorted.filter((i) => i.state !== 'closed' && i.state !== 'opened' && i.state !== 'referenced')],
      ['Referenced', sorted.filter((i) => i.state === 'referenced')],
    ];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      lines.push(`### ${label} (${list.length})`);
      list.forEach((iss) => {
        const linkText = iss.title ? `#${iss.iid} ${iss.title}` : `#${iss.iid}`;
        lines.push(`- [${linkText}](${iss.web_url})`);
      });
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  };

  const buildCommitsMarkdown = (fromTag, toTag, commits, commitIssueMap, issuesByIid) => {
    const lines = [];
    lines.push(`## Commits (${commits.length}) — ${fromTag} → ${toTag}`);
    lines.push('');
    if (commits.length === 0) {
      lines.push('_No commits in this range._');
      return lines.join('\n');
    }
    commits.forEach((c) => {
      const short = (c.id || '').substring(0, 8);
      const iids = Array.from(commitIssueMap.get(c.id) || []);
      const refs = iids.length
        ? ' ' +
          iids
            .map((iid) => {
              const iss = issuesByIid.get(iid);
              return iss ? `[#${iid}](${iss.web_url})` : `#${iid}`;
            })
            .join(' ')
        : '';
      const commitLink = c.web_url ? `[\`${short}\`](${c.web_url})` : `\`${short}\``;
      lines.push(`- ${commitLink} ${c.title || ''}${refs}`);
    });
    return lines.join('\n');
  };

  const buildFullMarkdown = (fromTag, toTag, commits, commitIssueMap, issuesByIid) => {
    const lines = [];
    lines.push(`# Changelog: ${fromTag} → ${toTag}`);
    lines.push('');
    lines.push(buildIssuesMarkdown(fromTag, toTag, issuesByIid));
    lines.push('');
    lines.push(buildCommitsMarkdown(fromTag, toTag, commits, commitIssueMap, issuesByIid));
    return lines.join('\n');
  };

  const downloadMarkdown = (fromTag, toTag, md) => {
    const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
    const filename = `changelog_${safe(fromTag)}_to_${safe(toTag)}.md`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- Utils ----------

  const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Helper to check we're on a tags listing page
  const isTagsPage = () => /\/-\/tags(\/|$|\?)/.test(window.location.pathname);

  // Initial inject pass (only if we're actually on a tags page)
  if (isTagsPage()) {
    injectIcons();
  }
})();
