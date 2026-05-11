# GitLab Changelog Generator – Chrome Extension

Adds a small icon next to each tag on a GitLab project's tag page. Click it to generate a changelog between that tag and another tag, including **all linked issues** found in the commit messages (and in any referenced merge requests).

Uses your **existing GitLab session** (cookies) — no API tokens needed. Works with **self-hosted GitLab instances** via a configurable list.

## Features

- ⚙️ **Configurable instances** — add one or more GitLab URLs in the options page
- 🔐 **Per-host permissions** — Chrome only grants access to instances you explicitly approve
- 🏷️ Small icon injected next to every tag on `/-/tags`
- 🔍 Select a second tag to compare against (auto-defaults to the next-newer tag)
- 🔄 Swap from/to direction with one click
- 📋 Lists all commits between the two tags
- 🐛 Extracts issue references (`#123`) from commit messages
- 🔗 Resolves issues closed by merge requests referenced in commits (`!456`)
- 🏷️ Groups issues by state (Closed / Open) with labels
- 📄 Copy results as Markdown or HTML

## Installation (Development Mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder
5. **Click the extension icon → Manage GitLab Instances** (or right-click → Options)
6. Add each GitLab instance URL (e.g. `https://gitlab.example.com`)
7. Chrome will prompt for permission to run on that host — accept it

After that, the icon appears next to each tag on any project's tag page on the configured instance(s).

## Why per-host permissions?

The extension uses Chrome's `optional_host_permissions`. This means:
- It does **not** request access to all websites at install time
- It only runs on the specific GitLab instances you add in the options page
- You can revoke permission at any time from the options page or `chrome://extensions`

When you add an instance, the background service worker dynamically registers the content script for that origin only. No instance URL = no script injection anywhere.

## How It Works

1. Content script watches the tags page DOM and injects a button next to each tag link.
2. When clicked, it opens a modal and fetches the list of all tags via the GitLab API (`/api/v4/projects/:id/repository/tags`).
3. After you pick a second tag, it calls the compare endpoint (`/api/v4/projects/:id/repository/compare`) to get all commits.
4. It parses each commit message for `#NNN` issue references and `!NNN` MR references.
5. For each MR, it fetches `closes_issues` to find additional linked issues.
6. Each unique issue is fetched to get its title, state, labels, and URL.

All API calls use `credentials: 'same-origin'` so they ride on your existing session cookie.

## Files

- `manifest.json` – Extension manifest (V3)
- `background.js` – Service worker; dynamically registers content scripts per configured instance
- `content.js` – Injects the icon, opens the modal, calls the API
- `content.css` – Styles for icon + modal
- `options.html` / `options.css` / `options.js` – Settings page for managing instances
- `popup.html` / `popup.js` – Toolbar popup with quick status & link to options
- `icons/` – Extension icons

## Permissions Explained

- `storage` – stores your list of configured instances
- `scripting` – needed to register content scripts dynamically for the instances you add
- `optional_host_permissions: http://*/*, https://*/*` – Chrome only grants the specific origins you approve, one at a time, when you add an instance

## Limitations

- Cross-project issue references like `group/project#123` are only resolved against the *current* project.
- Tags page DOM selectors target the common GitLab layouts but may need tweaking if GitLab changes its markup significantly.
- The extension's optional host permissions cover all `http(s)` URLs in principle, but actual access is gated per-origin by Chrome's permission system — adding a new instance always triggers a permission prompt.
