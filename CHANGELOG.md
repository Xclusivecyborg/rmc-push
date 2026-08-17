# Changelog

All notable changes to the "rmc-push" extension will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.5] — 2026-08-17

### Added
- **Dedicated sidebar view.** The extension now has its own activity bar icon and a docked panel, instead of opening a webview in an editor tab.
- **Browse existing configuration.** The panel lists every root parameter and parameter group already in the project, with type and current value, and a filter box to search by key.
- **Click to edit.** Selecting a parameter opens it pre-filled for editing. Keys and groups are read-only in edit mode, since renaming through the merge API would create a duplicate rather than move the original.
- `RMC Push: Select Service Account` and `RMC Push: Reload Remote Config` commands.
- Refresh button in the view's title bar.
- New extension artwork for the Marketplace listing and README.
- Service account can be chosen or changed from inside the panel, not only from the Command Palette.

### Fixed
- **Parameter group names now accept spaces.** Groups are display labels in the Firebase console, not code identifiers, so `Feature Flags` is a legitimate name — the old rule applied the parameter-key regex to them and rejected it. Keys themselves are unchanged and still reject spaces.
- **Expired tokens no longer interrupt you.** The session keeps the service account, so it silently re-authenticates when the access token ages out. Previously a push after ~1 hour failed with "Session expired. Please re-run the Push command."
- Selecting a service account no longer fails when no workspace folder is open — the path falls back to global scope instead of erroring on an unavailable workspace target.
- Upgraded `@vscode/test-electron` and `@vscode/test-cli`; the previous versions could not launch VS Code ≥ 1.13x, which renamed the macOS binary from `Electron` to `Code`.

### Changed
- **New parameter** now sits above the filter and the list, rather than below a list that could push it off-screen.
- `Push to Firebase Remote Config` now opens the sidebar rather than running the whole flow itself. Its command id is unchanged, so existing keybindings still work.
- Webview styling now uses VS Code theme variables throughout, replacing hard-coded colours that looked wrong in light and high-contrast themes.
- Webview CSP tightened from `script-src 'unsafe-inline'` to a per-load nonce; assets moved to `media/` and served via `localResourceRoots`.
- State moved out of the command closure into `RmcPushSession`, so the view can be disposed and recreated (which VS Code does whenever the sidebar is hidden) without losing the connection.
- Push input is now validated on the extension host as well as in the webview.
- Replaced self-referential validation tests that re-implemented the rules inside the assertions with tests against the real `validatePush` and `toSections` functions.

---

## [0.0.4] — 2026-03-08

### Added
- Support for pushing parameters into named **parameter groups** (`parameterGroups`)
- Optional group field in the webview UI — leave blank to push to root parameters

### Fixed
- Service account file selection no longer requires re-running the command — the push UI now opens immediately after the file is picked

### Changed
- Refactored monolithic `extension.ts` into well-structured modules (`auth/`, `firebase/`, `webview/`, `commands/`)
- Replaced `any` types with typed interfaces and error classes (`AuthError`, `FirebaseApiError`, `ServiceAccountValidationError`)
- Replaced `fs.readFileSync` with async `fs.promises.readFile`
- Replaced `console.log`/`console.error` with OutputChannel-based `logger`
- Added CSP header, `retainContextWhenHidden`, and `localResourceRoots: []` to webview panel
- Loading state: submit button disabled while push is in progress
- Stricter TypeScript options: `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedParameters`, `noUnusedLocals`

---

## [0.0.3] — 2025

### Changed
- Simplified project display name to "Firebase Push"
- Updated icon path; bumped version

### Added
- Revised README with comprehensive setup instructions and feature descriptions

---

## [0.0.2] — 2025

### Added
- Extension icon (`icon.png`)
- MIT license
- `src/requirements.todo` with planned features

---

## [0.0.1] — 2025

### Added
- Initial release: Firebase Remote Config Push extension
- RS256 JWT authentication via service account JSON
- OAuth2 token exchange with Google
- Webview UI with key/value/type form
- Value type selection: `STRING`, `NUMBER`, `BOOLEAN`, `JSON`
- Client-side input validation (key regex, type-specific value checks)
- GET-then-PUT with ETag concurrency control
- `rmc-push.pushRemoteConfig` command
- `rmc-push.resetServiceAccountPath` command (workspace-scoped)
- Project name displayed in webview heading
- Inline validation error display (no alerts)
