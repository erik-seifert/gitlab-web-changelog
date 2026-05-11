---
layout: default
title: GitLab Changelog Generator
---

# GitLab Changelog Generator

A Chrome extension that adds a **Generate Changelog** button next to every tag on a GitLab project's tags page. Pick two tags, and the extension fetches all commits between them, resolves the linked issues, and produces a structured changelog — ready to copy, export as Markdown, or publish directly to a GitLab wiki page.

Works with **gitlab.com** and any **self-hosted GitLab** instance. No API tokens needed — it uses your existing browser session.

---

## Installation

1. Go to `chrome://extensions` and enable **Developer mode** (top-right toggle).
2. Click **Load unpacked** and select the extension folder.
3. The GitLab icon appears in your browser toolbar.

> A Chrome Web Store release is coming. Once published, installation will be a single click.

---

## Setup

### Add a GitLab instance

1. Click the extension icon in the toolbar, then **Manage GitLab Instances** — or right-click the icon and choose **Options**.
2. Enter the base URL of your GitLab instance, e.g. `https://gitlab.example.com`.
3. Optionally add a label (e.g. "Work GitLab") to tell instances apart.
4. Click **Add & Grant Permission** and accept the Chrome permission prompt.

You can add as many instances as you need. The extension only runs on hosts you have explicitly granted.

### Branch issue regex (optional)

In **Options → Advanced Settings** you can set a regex that extracts an issue number from a branch name when no closed issue can be found via the GitLab API.

| Regex | Matches branch |
|---|---|
| `^(\d+)[-_]` | `757-fix-graphql-field` |
| `(?:^\/\/)(\d+)[-_]` | `feature/757-fix-graphql-field` |

The regex must contain exactly one capture group for the issue number. Leave blank to disable.

---

## Generating a Changelog

1. Navigate to any project's **Tags** page (`/-/tags`).
2. A small icon (🏷) appears next to each tag name. Click it.
3. A modal opens with the selected tag as the **From** tag (older).
4. Choose the **To** tag (newer) from the dropdown — it defaults to the next tag above.
5. If your project's issues live in a **separate GitLab project**, set the **Issue project** field (supports autocomplete after 3 characters). The extension remembers your choice per project.
6. Click **Generate Changelog**.

The extension then:
- Fetches all commits between the two tags
- Resolves every MR linked to those commits
- Finds all issues closed by those MRs
- Falls back to branch-name regex if no issues are found via the API
- Resolves cross-project issue references (e.g. `group/other-project#77`)

---

## Changelog Output

### Issues section

Lists all linked issues grouped by state:

- **Closed** — issues resolved in this range
- **Open** — issues referenced but still open
- **Other** / **Referenced** — issues mentioned but not fully resolved

Each entry is a direct link to the issue in GitLab.

**Copy Issues** copies the section as Markdown to the clipboard.

### Commits section

Lists every commit with:
- Short SHA linked to the commit in GitLab
- Commit title
- Chips for each linked issue (click to open the issue)

**Copy Commits** copies the section as Markdown to the clipboard.

### Export as Markdown

Downloads a `changelog_<fromTag>_to_<toTag>.md` file containing both sections in the format below.

```markdown
# Changelog: v1.0.0 → v1.1.0

## Issues (5) — v1.0.0 → v1.1.0

### Closed (3)
- [#42 Login fails on Firefox](https://gitlab.example.com/group/project/-/issues/42)
- [#48 Add dark mode](https://...)

### Open (2)
- ...

## Commits (12) — v1.0.0 → v1.1.0

- [`abc12345`](https://.../commit/abc12345) Fix login validation [#42](https://.../issues/42)
- [`def67890`](https://.../commit/def67890) Add dark-mode toggle [#48](https://.../issues/48)
```

---

## Publish to Wiki

After generating a changelog you can publish it directly to a GitLab wiki page.

1. Click **Publish to Wiki** in the changelog header.
2. A panel expands with two fields:
   - **Project** — the GitLab project whose wiki should receive the page. Supports autocomplete (type 3+ characters). Defaults to the last project you used and is remembered per code project.
   - **Wiki path** — `[parent] / [page slug]`. The parent (e.g. `releases`) is remembered per project. The page slug defaults to the "to" tag name.
3. The **Full path** preview updates live (e.g. `releases/v1.1.0`).
4. Click **Publish**.
   - If the page does not exist yet it is created.
   - If it already exists it is updated.
5. An **Open page →** link appears on success.

> The Wiki feature must be enabled on the target project (**Settings → General → Visibility → Wiki**), otherwise the API returns 404.

---

## Dark Mode

The changelog modal fully supports dark mode and respects your OS setting automatically.

---

## Privacy

The extension communicates exclusively with the GitLab instance(s) you configure. No data leaves your browser to any third-party service. All API calls use your existing logged-in session (same-origin cookies) — no API tokens or credentials are stored.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No changelog icon on the tags page | Check that you added and granted permission for this instance in Options |
| Issues section is empty | Try setting the **Issue project** field to the project where issues live |
| Wiki publish returns 404 | Enable the Wiki feature in the target project's Settings → General → Visibility |
| Icon appears but clicks do nothing | Reload the tab after installing or updating the extension |

---

## Version History

| Version | Highlights |
|---|---|
| 1.5.0 | Issue project selector with autocomplete; wiki publish; cross-project issue resolution; npm publish script |
| 1.4.0 | Issues and Commits sections with per-section copy buttons; commit SHAs linked |
| 1.3.0 | Commit→MR API for thorough issue resolution; bounded concurrency |
| 1.2.0 | Export as Markdown |
| 1.1.0 | Configurable GitLab instances with per-host permissions |
| 1.0.0 | Initial release |
