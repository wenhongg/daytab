# Developing and releasing Day Tab

## Development

There is no build step and there are no dependencies — `src/` *is* the
extension. Load `src/` unpacked (see [README](README.md#local-setup)), edit
files, then click the reload icon on the extension's card in
`chrome://extensions` and open a new tab.

Layout is one folder per feature (`calendar/`, `todo/`, `scratchpad/`,
`weather/`), each splitting UI from data access: `<feature>.js` touches the
DOM, `store.js` / `api.js` never do. Cross-feature communication goes
through `document` CustomEvents (`viewdatechange`, `calendarschange`,
`signedout`) so features don't import each other's internals.

Repo layout outside `src/`: `docs/` is the public website (GitHub Pages),
`pack.sh` builds the store zip, `release.sh` ships a version.

## Versioning

`src/manifest.json`'s `version` is the **single source of truth** — nothing
else stores a version number. The release workflow is the only thing that
should write it; bumping it inside a feature commit silently breaks the
version-bump guard in CI.

Rules imposed by Chrome:

- 1–4 dot-separated integers (`1`, `1.1`, `1.1.2`). No `-beta` suffixes.
- Each upload must be **strictly higher** than the published version, or
  the store rejects it. The workflow enforces this before it commits
  anything, and re-checks on manual promotions.

Convention: `MAJOR.MINOR` — bump MINOR for features and fixes, MAJOR for a
redesign or a breaking permission change.

## Branch model

| Ref | Meaning |
| --- | --- |
| `main` | Development. Always deployable, not necessarily deployed. |
| `release` | What has been shipped to the Chrome Web Store. Only ever fast-forwarded from `main`. |
| `v1.1` (tag) | Permanent marker for the commit that shipped as 1.1. |

`release` never receives direct commits or pull requests. Because it is
always an ancestor of `main`, the fast-forward cannot conflict; if it ever
does, something is wrong — investigate rather than force-push.

## Releasing

Land your work on `main` as usual — never edit the version by hand — then
go to **Actions → Release → Run workflow**, pick a bump type, and click the
green button. That's the whole release.

The `bump` dropdown (`minor` by default) is resolved against the current
manifest, so you don't need to look the version up: `minor` takes 1.1 to
1.2, `patch` takes 1.1 to 1.1.1, `major` takes 1.1 to 2.0. The optional
**exact version** field overrides it when you want a specific number.

From a terminal instead, if you prefer:

```sh
./release.sh          # minor bump
./release.sh patch
./release.sh 2.0      # exact version
```

That script only asks GitHub to start the workflow (`gh workflow run`) —
nothing is built, tagged, or published locally.

[`release.yml`](.github/workflows/release.yml) then, on a clean checkout:

1. Refuses to run unless it's on `main`, there's something to ship
   (`release` isn't already at this commit), and no check on the commit has
   failed. Then works out the next version and rejects it if it isn't a
   valid Chrome version strictly above the current one.
2. Bumps `src/manifest.json`, commits `Release 1.2`, and pushes `main`.
3. Tags `v1.2` (only after `main` lands, so a rejected push leaves nothing
   behind) and fast-forwards `release`.
4. Runs `./pack.sh` to build `release.zip` from `src/`.
5. Uploads it to the Chrome Web Store API, polls until the upload settles
   (the store processes asynchronously), then publishes.

Publishing submits the new version to Google's review; it reaches users
after that review passes, typically within hours to a couple of days.

Promoting `main` to `release` by hand still publishes — the same workflow
also triggers on a push to `release`, skipping steps 1–3 and re-checking
that the version actually changed.

> Step 3 pushes to `release`, which the workflow also triggers on. That
> isn't a loop only because pushes authenticated with `GITHUB_TOKEN` don't
> trigger workflows. If the checkout is ever given a PAT or GitHub App
> token instead, the release push *will* re-enter the workflow and publish
> twice — the version-bump guard won't catch it, since the version really
> did change.

### One-time bootstrapping

The automated path can't perform the **first** upload — the workflow needs
a `CWS_ITEM_ID`, which doesn't exist until the extension has been created
in the dashboard. So release 1.0 is manual:

1. `./pack.sh --with-key` — includes the private signing key so the store
   adopts our existing extension ID, and with it the existing OAuth client.
   Every later build uses plain `./pack.sh`.
2. Upload that zip by hand in the
   [dashboard](https://chrome.google.com/webstore/devconsole), fill in the
   listing, submit.
3. Add repo secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, `CWS_ITEM_ID` (setup steps are in the header
   comment of `release.yml`).
4. Delete the key-bearing zip. The key lives outside the repo
   (`~/projects/newtab-key.pem`), `.gitignore` blocks `*.pem`, and
   `pack.sh` refuses to pack if key material is found in `src/` — but don't
   leave a copy lying around.

## When something goes wrong

**"nothing new to ship" / "main is not green".** Pre-flight guards, not
failures of the release itself: the first means `release` already points at
this commit (nothing merged since the last release), the second means a
check on the commit concluded failure/cancelled/timed-out. Only definitive
failures block — a repo with no checks, or checks still running, passes.

**The release failed partway.** The steps are ordered so a failure leaves a
clean retry: nothing is tagged or promoted until the `main` push lands.
Check which step failed in the run log.

- Failed *before* the bump commit — nothing happened; fix and re-run.
- Failed *after* `main` was pushed — the version is already bumped and
  committed, so don't run a fresh bump. Push `main` to `release` by hand
  (`git push origin main:release`, never force); that re-enters the
  workflow at the publish steps.
- Failed during upload/publish — fix the cause (usually an expired
  `CWS_REFRESH_TOKEN`) and re-promote as above.

**A bad version reached users.** There is no unpublish or rollback on the
Chrome Web Store. Recovery is forward-only: fix on `main` and release a
higher version. Chrome auto-updates users within a few hours of publish.

**A fix is needed while `main` has unreleased work in flight.** There is no
patch-an-old-release path — `release` only fast-forwards, so shipping means
shipping `main`. Either land the fix and release everything on `main`, or
revert the unready work first. (The tags exist as markers for
inspection/diffing, not as a parallel release line.)

## Changing permissions or OAuth scopes

Adding a *required* permission disables the extension for existing users
until they re-accept it, and a new OAuth scope requires re-consent plus
another Google verification round. Prefer `optional_permissions` requested
at runtime when the user enables the feature. Whenever scopes change,
update in the same release: `src/manifest.json`, `SETUP.md`, `PRIVACY.md`,
`docs/privacy/index.html`, and the Cloud Console consent screen.

## Website

`docs/` is served by GitHub Pages at
[daytab.wenhongl.com](https://daytab.wenhongl.com) — the homepage, privacy
policy, and terms. Those URLs are referenced by the Chrome Web Store
listing and Google's OAuth verification, so treat them as load-bearing: if
a page moves, keep a redirect at the old path.
