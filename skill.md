# RMC Push — Project Context

## What This Is

<!-- AUTO-GENERATED: what-this-is -->
A VS Code extension that lets developers push key-value pairs directly to **Firebase Remote Config** from within VS Code, without opening the Firebase Console.

- **Extension ID**: `rmc-push`
- **Display Name**: Firebase Push
- **Publisher**: Xclusivecyborg
- **Version**: 0.0.3
- **Min VS Code**: 1.90.0
<!-- END AUTO-GENERATED: what-this-is -->

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict, ES2022, Node16 module) |
| Bundler | esbuild → `dist/extension.js` (CJS) |
| HTTP Client | `node-fetch` v2 |
| Auth | `jsonwebtoken` (RS256 JWT + Google OAuth2) |
| Testing | Mocha + `@vscode/test-electron` |
| Linting | ESLint + typescript-eslint |

---

## Project Structure

<!-- AUTO-GENERATED: project-structure -->
```
rmc-push/
├── src/
│   ├── auth/googleAuth.ts
│   ├── auth/serviceAccount.ts
│   ├── commands/pushRemoteConfig.ts
│   ├── commands/resetServiceAccount.ts
│   ├── extension.ts
│   ├── firebase/remoteConfig.ts
│   ├── logger.ts
│   ├── types/index.ts
│   ├── webview/content.ts
│   ├── webview/panel.ts
├── scripts/
│   └── update-skill.js
├── dist/extension.js
├── esbuild.js
├── tsconfig.json
├── package.json
└── .vscode/
```
<!-- END AUTO-GENERATED: project-structure -->

---

## Commands

<!-- AUTO-GENERATED: commands -->
| Command | ID | Description |
|---|---|---|
| Push to Firebase Remote Config | `rmc-push.pushRemoteConfig` | — |
| Reset Service Account Path | `rmc-push.resetServiceAccountPath` | — |

**Activation**: `onCommand:rmc-push.pushRemoteConfig`
<!-- END AUTO-GENERATED: commands -->

---

## Configuration

<!-- AUTO-GENERATED: configuration -->
- `rmcPush.serviceAccountPath` (string): Path to your Firebase service account JSON file.
- `rmcPush.authorName` (string): Your name to include in Remote Config version descriptions (e.g. 'Ayodeji').
<!-- END AUTO-GENERATED: configuration -->

---

## Build Scripts

<!-- AUTO-GENERATED: build-scripts -->
- `npm run vscode:prepublish`: `npm run package`
- `npm run compile`: `npm run check-types && npm run lint && node esbuild.js`
- `npm run watch`: `npm-run-all -p watch:*`
- `npm run watch:esbuild`: `node esbuild.js --watch`
- `npm run watch:tsc`: `tsc --noEmit --watch --project tsconfig.json`
- `npm run package`: `npm run check-types && npm run lint && node esbuild.js --production`
- `npm run compile-tests`: `tsc -p . --outDir out`
- `npm run watch-tests`: `tsc -p . -w --outDir out`
- `npm run pretest`: `npm run compile-tests && npm run compile && npm run lint`
- `npm run check-types`: `tsc --noEmit`
- `npm run lint`: `eslint src`
- `npm run test`: `vscode-test`
- `npm run update-skill`: `node scripts/update-skill.js`
- `npm run prepare`: `husky`
<!-- END AUTO-GENERATED: build-scripts -->

---

<!-- MANUAL: architecture -->
## Architecture

### Module Map

```
src/
├── extension.ts                   # ~15 lines: activate() + deactivate() only
├── types/index.ts                 # All interfaces, error classes, type guards
├── auth/
│   ├── serviceAccount.ts          # File selection, JSON reading, validation
│   └── googleAuth.ts              # JWT signing + OAuth2 token exchange
├── firebase/
│   └── remoteConfig.ts            # GET, mergeParameter (pure), PUT
├── webview/
│   ├── panel.ts                   # Panel lifecycle management
│   └── content.ts                 # getWebviewContent() HTML template
├── commands/
│   ├── pushRemoteConfig.ts        # Orchestration handler (owns AuthContext)
│   └── resetServiceAccount.ts     # Reset command handler
└── logger.ts                      # OutputChannel-based logger
```

### Data Flow

```
Command triggered
      │
      ▼
resolveServiceAccountPath()  ──→  user picks file (first run only)
      │
      ▼
readServiceAccount()          ──→  validates JSON + isServiceAccount()
      │
      ▼
getAuthContext()              ──→  RS256 JWT → oauth2.googleapis.com → AccessToken
      │
      ▼
fetchRemoteConfig()           ──→  GET firebaseremoteconfig.googleapis.com (verify + ETag)
      │
      ▼
createOrRevealPanel()         ──→  webview opens with projectId
      │
  [user submits form]
      │
      ▼
handlePushMessage()
  ├── fetchRemoteConfig()      ──→  GET (fresh ETag)
  ├── mergeParameter()         ──→  pure merge (no mutation)
  └── pushRemoteConfig()       ──→  PUT with If-Match
      │
      ▼
postMessage({ status })       ──→  webview shows success/error
```

### Firebase API

```
Base: https://firebaseremoteconfig.googleapis.com/v1/projects/{projectId}/remoteConfig
GET  → fetch current template + ETag
PUT  → update (requires If-Match: {etag} header)
```

### Merge Strategy

New param is shallow-merged into existing `parameters` object — no overwrites of unrelated keys:

```ts
parameters: {
  ...existingParameters,
  [key]: { defaultValue: { value }, valueType: type }
}
```

### Value Types

`STRING` | `NUMBER` | `BOOLEAN` | `JSON`

Client-side validation in the webview before message is sent:
- **NUMBER**: `Number()` must parse and input must not be empty
- **BOOLEAN**: must be `"true"` or `"false"` (case-insensitive, normalized to lowercase)
- **JSON**: `JSON.parse` must succeed
- **KEY**: `/^[a-zA-Z0-9_]+$/` — no hyphens
<!-- END MANUAL: architecture -->

---

<!-- MANUAL: key-patterns -->
## Key Patterns to Follow

- **Typed errors**: leaf modules throw `AuthError`, `FirebaseApiError`, `ServiceAccountValidationError`; command handlers catch and show user-facing messages
- **No `any`**: `serviceAccount` is typed `ServiceAccount`; `catch (err)` uses `instanceof` checks
- **Pure functions**: `mergeParameter` has no side effects — easy to unit test
- **AuthContext ownership**: `commands/pushRemoteConfig.ts` owns the `authContext` variable; nullified on panel dispose
- **Token expiry**: checked before each push (`expiresAt - 60` buffer)
- **Async file I/O**: `fs.promises.readFile` (not `fs.readFileSync`)
- **Workspace config**: use `vscode.workspace.getConfiguration('rmcPush')` for settings
- **Webview messaging**: extension → webview via `postMessage`, webview → extension via `onDidReceiveMessage`
- **No secrets in git**: service account path stored in workspace settings only
- **ETag concurrency**: always GET before PUT to avoid clobbering other changes
- **Bundler**: esbuild, not webpack; external: `['vscode']`
<!-- END MANUAL: key-patterns -->

---

<!-- MANUAL: eslint-rules -->
## ESLint Rules (Notable)

- Naming: camelCase/PascalCase for imports
- `curly` required
- `eqeqeq` (strict `===`)
- `no-throw-literal`
- Semicolons required
<!-- END MANUAL: eslint-rules -->

---

<!-- MANUAL: packaging -->
## Packaging

- `.vscodeignore` excludes: `src/`, `out/`, `node_modules/`, `*.map`, tests
- Icon: `icon.png`
- Never commit `.vsix` artifacts — covered by `.gitignore`
- Build: `npm run package` → `vsce package`
<!-- END MANUAL: packaging -->
