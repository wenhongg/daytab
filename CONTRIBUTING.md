# Developing and releasing Day Tab

## Repo structure

```
src/        the extension itself — this folder is what gets zipped
  calendar/   day view, week strip, month overlay, picker, Google Calendar API
  todo/       checklist
  scratchpad/ autosaving notes
  weather/    Open-Meteo forecast line
  shared/     chrome.storage helpers
docs/       the website (GitHub Pages → daytab.wenhongl.com)
pack.sh     builds release.zip from src/
release.sh  thin wrapper that starts the release workflow
```

No build step and no dependencies — load `src/` unpacked, edit, hit reload
in `chrome://extensions`. Each feature folder splits UI from data access
(`<feature>.js` touches the DOM, `store.js` / `api.js` never do), and
features talk to each other through `document` CustomEvents
(`viewdatechange`, `calendarschange`, `signedout`) rather than imports.

## Branches

| Ref | Meaning |
| --- | --- |
| `main` | Development. |
| `release` | What's live on the Chrome Web Store. Only ever fast-forwarded from `main`, never committed to directly. |
| `v1.2` (tag) | Permanent marker for the commit that shipped as 1.2. |

## Releasing

**Actions → Release → Run workflow**, pick a bump, click. Or `./release.sh`
(`minor` by default; also `patch`, `major`, or an exact version like `2.0`)
— that just starts the same workflow, nothing runs locally.

`src/manifest.json`'s `version` is the only place a version lives, and the
workflow is the only thing that should write it. Chrome versions are 1–4
dot-separated integers, and every upload must be strictly higher than the
published one.

The workflow then:

1. Checks it's on `main`, that `release` isn't already at this commit, and
   that no check on the commit has failed.
2. Works out the next version and rejects it if it isn't valid and strictly
   higher.
3. Bumps `src/manifest.json`, commits, pushes `main`.
4. Tags `v1.2` and fast-forwards `release`.
5. Runs `pack.sh`, uploads to the Chrome Web Store, waits for the upload to
   settle, publishes.

Publishing submits to Google's review; it reaches users after that passes.
There's no rollback on the store — recovery is always a higher version.

Pushing `main` to `release` by hand also publishes, skipping steps 1–4 and
re-checking that the version changed.

## Gotchas

- Adding a *required* permission disables the extension for existing users
  until they re-accept; a new OAuth scope needs re-consent and Google
  re-verification. Prefer `optional_permissions` requested at runtime.
  When scopes change, update `src/manifest.json`, `SETUP.md`,
  `docs/privacy/index.html` and the Cloud Console consent screen together.
- `docs/privacy/` and `docs/terms/` are referenced by the store listing and
  Google's OAuth verification — if a page moves, leave a redirect behind.
- Releases authenticate with the `CWS_*` repo secrets. Their refresh token
  comes from a separate Cloud project, kept apart from the user-facing
  OAuth client so publishing can never disturb its verification.
