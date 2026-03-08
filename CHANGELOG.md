# Changelog

All notable changes to the "rmc-push" extension will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
