# GitLab Changelog Generator — Chrome Extension

Compact spec & reference for the extension we built.

## Purpose

Chrome extension that adds a small icon next to each tag on a GitLab project's tags page (`/-/tags`). Clicking the icon opens a modal where the user picks a second tag; the extension then fetches all commits between the two tags, resolves the linked issues, and displays a changelog with copy/export/wiki-publish actions.

Works with **gitlab.com** and **self-hosted GitLab** instances. Uses the **logged-in user's session cookies** — no API tokens.

## Architecture

| Component | File | Role |
|---|---|---|
| Manifest | `manifest.json` | Manifest V3, `optional_host_permissions`, service worker, options page, popup |
| Background worker | `background.js` | Dynamically registers/unregisters content scripts for configured GitLab instances |
| Content script | `content.js` | Injects icons on tags pages, opens modal, calls GitLab API, renders changelog |
| Content styles | `content.css` | Icon button + modal + wiki panel styling, dark-mode aware |
| Options page | `options.html` / `options.css` / `options.js` | Add/remove GitLab instances; branch regex setting |
| Popup | `popup.html` / `popup.js` | Toolbar popup with status + link to options |
| Icons | `icons/icon16.png`, `icon48.png`, `icon128.png` | Extension icons |
| Publish script | `scripts/publish.mjs` | Bumps version, builds ZIP, uploads to Chrome Web Store, tags git |

## Permissions

- `storage` — stores configured instance list and per-project settings (`chrome.storage.sync`)
- `scripting` — needed for `chrome.scripting.registerContentScripts` at runtime
- `optional_host_permissions: http://*/*, https://*/*` — Chrome prompts per-origin when the user adds an instance; no broad access at install time

## Configurable Instances

Users add instances in the options page. Each entry:

```json
{ "url": "https://gitlab.example.com", "label": "Work GitLab" }
```

Flow on add:
1. URL normalized to origin only (`scheme://host`)
2. `chrome.permissions.request({ origins: ['https://gitlab.example.com/*'] })`
3. On grant: saved to storage → background worker re-syncs content script registrations
4. On revoke/remove: permission removed, script unregistered

The background worker listens on `chrome.storage.onChanged`, `onInstalled`, and `onStartup` to keep the registered scripts in sync with the user's configured (and permission-granted) instances. A promise queue (`syncQueue`) prevents race conditions when multiple events fire simultaneously.

## Icon Injection

`content.js` runs on configured instances. On every page it checks `isTagsPage()` (regex on `/-/tags(\/|$|\?)`). If true, `injectIcons()` walks all `a[href*="/-/tags/"]` links, skips the index/edit/release variants, and appends a small inline SVG button after each tag link.

A `MutationObserver` re-runs `injectIcons()` for the SPA case (GitLab loads tag rows asynchronously).

## Modal Flow

1. **Open** — User clicks icon next to tag X. Modal opens with X pre-filled as the "from" tag.
2. **Load tags** — Resolves project ID via `/api/v4/projects/<url-encoded path>`, then fetches all tags via `/api/v4/projects/:id/repository/tags?per_page=100&page=N` (paginated, capped at 20 pages).
3. **Choose "to" tag** — Dropdown of all tags except X. Defaults to the tag immediately newer than X.
4. **Issue project** — Text input with autocomplete (3+ chars → `GET /api/v4/projects?search=…&membership=true&simple=true`). Defaults to the saved value for this code project, or the current project path. Persisted per code project under `issueProject:<path>` in sync storage.
5. **Swap** — Button flips from/to.
6. **Generate** — Triggers the resolution pipeline.

## Issue Resolution Pipeline

Bounded concurrency: **5 parallel requests** via a `runWithConcurrency` helper. Status text updates throughout (`Looking up MRs (47/200)…` etc).

**Step 1 — Compare tags**
`GET /api/v4/projects/:id/repository/compare?from=<fromTag>&to=<toTag>` returns the list of commits.

**Step 2 — Commit → MRs**
For every commit: `GET /api/v4/projects/:id/repository/commits/:sha/merge_requests`.
Builds a `uniqueMrs` Map keyed by `${mr.project_id}:${mr.iid}` — MRs can belong to a different project than the code project (e.g. a separate issues project).

**Step 3 — Bare `#NNN` from commit messages**
Regex on each commit message picks up direct issue references not linked via an MR.

**Step 4 — MR → closed issues**
For each unique MR: `GET /api/v4/projects/${mr.project_id}/merge_requests/:iid/closes_issues`.
Uses `mr.project_id` (not the code project ID) so cross-project MRs resolve correctly.
Issue objects from this response are stored in `prefetchedIssues` (avoids a redundant fetch).

**Step 5 — Branch regex fallback**
For MRs that still have no linked issues, the source branch name is matched against the configured regex (e.g. `^(\d+)[-_]`) to extract an issue number. Configurable in Options → Advanced Settings. Falls back only when `closes_issues` returned nothing.

**Step 6 — Cross-project refs**
`extractCrossProjectRefs` scans MR descriptions and commit messages for `group/project#NNN` patterns. Each referenced project is resolved to a numeric ID via `resolveProjectId` (cached in `projectIdCache`), then issues are fetched from those projects.

**Step 7 — Remaining issues from issue project**
Any iids not yet resolved are fetched from the **user-selected issue project** (Step 4 in modal flow). Iids covered by a cross-project ref are excluded.

**Step 8 — Attribute back**
Issues are attached to commits via `commitIssueMap`: populated from MR→issue cache (compound key `${mrProjectId}:${mrIid}`) plus direct `#NNN` commit-message refs.

All API calls use `credentials: 'same-origin'` to ride the session cookie. POST/PUT calls also send `X-CSRF-Token` read from `<meta name="csrf-token">` on the page.

## Rendered Output

### Top header
- Title `Changelog: <fromTag> → <toTag>`
- **Export as Markdown** button — downloads `changelog_<fromTag>_to_<toTag>.md`
- **Publish to Wiki** button — expands the wiki panel (see below)

### Wiki publish panel
Appears below the header when "Publish to Wiki" is clicked.
- **Project** — autocomplete input (same 3-char search as issue project). Persisted per code project under `wikiProject:<path>`.
- **Wiki path** — `[parent slug] / [page slug]`. Parent persisted under `wikiParent:<path>`. Page slug defaults to the "to" tag.
- Live path preview: `Full path: releases/v1.1.0`
- **Publish** button — resolves the wiki project to a numeric ID, then `POST /api/v4/projects/:id/wikis`. If the page already exists (409), switches to `PUT`. On success, shows an "Open page →" link built from `${origin}/${wikiProjectPath}/-/wikis/${page.slug}`.

### Issues section
- Heading `Issues (N)` + **Copy Issues** button (clipboard)
- Grouped by state: Closed / Open / Other / Referenced
- Each entry: `#IID Title` as a link to the issue's `web_url` (no labels shown)

### Commits section
- Heading `Commits (N)` + **Copy Commits** button (clipboard)
- Each entry: short SHA (linked to commit's `web_url`) + commit title + chips for linked issues

Both copy buttons flash a green "Copied!" confirmation next to themselves.

## Markdown Output Format

```markdown
# Changelog: v1.0.0 → v1.1.0

## Issues (5) — v1.0.0 → v1.1.0

### Closed (3)
- [#42 Login fails on Firefox](https://gitlab.example.com/group/project/-/issues/42)
- [#48 Add dark mode](https://...)
- ...

### Open (2)
- ...

## Commits (12) — v1.0.0 → v1.1.0

- [`abc12345`](https://.../commit/abc12345) Fix login validation [#42](https://.../issues/42)
- [`def67890`](https://.../commit/def67890) Add dark-mode toggle [#48](https://.../issues/48)
- ...
```

## Project Autocomplete

Shared helper `setupAutocomplete(input, listEl)` wires up debounced project search on any input + adjacent `.glcg-ac-list` element. Used by both the issue project field and the wiki project field. Triggers after 3 characters, debounced 300 ms. Uses `GET /api/v4/projects?search=…&membership=true&simple=true&per_page=10`.

## Publishing to Chrome Web Store

```bash
cp .env.example .env   # fill in the four credentials
source .env
npm run publish:patch  # 1.4.0 → 1.4.1
npm run publish:minor  # 1.4.0 → 1.5.0
npm run publish:major  # 1.4.0 → 2.0.0
```

`scripts/publish.mjs` (ESM):
1. Aborts if working tree is dirty or env vars are missing
2. Bumps version in `manifest.json`, commits `chore: release vX.Y.Z`
3. Builds a ZIP from exactly the 12 extension files using `archiver`
4. Uploads via `chrome-webstore-upload`, then publishes
5. Creates git tag `vX.Y.Z` and pushes commit + tag
6. Deletes the ZIP

Required env vars: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`.

## Installation (Development)

1. `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select extension folder
3. Click extension icon → **Manage GitLab Instances** (or right-click → Options)
4. Add each GitLab base URL (`https://gitlab.example.com`)
5. Accept the per-host permission prompt
6. Visit any project's `/-/tags` page → icons appear next to each tag

## Known Limitations

- Tags-page DOM selectors target common GitLab layouts; may need adjustment if GitLab markup changes significantly
- Large compare ranges (1000+ commits) trigger many API calls — bounded concurrency mitigates load but still takes time
- Wiki publish requires the Wiki feature to be enabled on the target project (Settings → General → Visibility → Wiki); GitLab returns 404 otherwise

## Version History

- **1.0.0** — Initial: hard-coded gitlab.com matcher, commits + issues, copy MD/HTML
- **1.1.0** — Configurable instances via `optional_host_permissions` + dynamic content-script registration
- **1.2.0** — Issues-only view, Export as Markdown button
- **1.3.0** — Always use commit→MR API for thorough issue resolution; bounded concurrency (5 parallel)
- **1.4.0** — Both Issues and Commits sections with per-section copy buttons; commit SHAs linked
- **1.5.0** — Issue project selector (autocomplete, persisted); branch regex fallback; cross-project ref resolution; `mr.project_id` used for closes_issues; wiki publish with project selector; npm publish script; labels removed from issue display

## Files Recap

```
gitlab-changelog-extension/
├── manifest.json
├── background.js
├── content.js
├── content.css
├── options.html
├── options.css
├── options.js
├── popup.html
├── popup.js
├── .env.example
├── .gitignore
├── package.json
├── scripts/
│   └── publish.mjs
├── test/
│   ├── content.test.js
│   ├── background.test.js
│   └── options.test.js
├── README.md
└── icons/
    ├── icon.svg
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
