# Notes for Claude

Read `CONTRIBUTING.md` for repo structure, branches and the release flow.
This file is only the things that have bitten us.

## Check the repo before planning

The local folder is `newtab`; the GitHub repo is `daytab`. Work also lands
here between sessions, so `git log`/`ls` before designing anything — a
release pipeline was once documented from scratch that contradicted the
`release.sh` and workflow already sitting in the repo.

There is no test suite and no build step. Verification is: syntax-check
changed modules (`node --input-type=module --check < file.js`), and
`./pack.sh` to confirm the zip still builds.

## Load-bearing things not to break

- **`key` in `src/manifest.json`** pins the extension ID
  (`iobkbdlnjeijdpnokfgolaijmfffkdjo`). The published store item and the
  user-facing OAuth client are both bound to that ID. Never regenerate or
  drop it. `pack.sh` strips it from the zip — that's correct, the store
  rejects it.
- **Two Google Cloud projects, deliberately.** One holds the user-facing
  OAuth client (verified — adding a scope there risks re-review and the
  "unverified app" warning returning for users); a separate one holds the
  Chrome Web Store publishing client behind the `CWS_*` repo secrets.
  Publishing credentials never go in the verified project.
- **`docs/privacy/` and `docs/terms/`** are cited in the store listing and
  Google's OAuth verification. Moving them without a redirect breaks a live
  compliance dependency.
- **`.env`** in the repo root holds publishing credentials. Gitignored —
  keep it that way.

## GitHub Pages

Site is `docs/` on `main`, served at `daytab.wenhongl.com`. Changing the
Pages **source path does not trigger a rebuild** — the CDN keeps serving
the old build, so the homepage looks fine while subpaths 404. After any
source change, force one:

```sh
gh api -X POST repos/wenhongg/daytab/pages/builds
```

## Conventions

- Vanilla ES modules, no dependencies, no framework. Feature folders split
  UI from data (`<feature>.js` touches the DOM; `store.js`/`api.js` never
  do), and features communicate via `document` CustomEvents.
- Build DOM with `createElement`/`textContent` — never `innerHTML`. Event
  titles, calendar names and locations are untrusted third-party strings.
- Chrome version segments are integers, not decimals: 1.9 → 1.10.
- A release moves `main` (the workflow commits the version bump), so pull
  before committing after one.
