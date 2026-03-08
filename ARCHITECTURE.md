# Architecture Guide — rmc-push

Onboarding reference for engineers new to this codebase.

---

## 1. Purpose and Scope

**rmc-push** is a VS Code extension that lets developers push a single key-value pair to Firebase Remote Config without leaving the editor. It handles authentication, fetches the current config template, merges the new parameter, and pushes the full template back.

**Out of scope (planned, not yet built)**:
- Editing multiple parameters in one operation
- Creating/editing conditions or condition expressions
- Parameter group management
- Multi-project support

See `src/requirements.todo` for the planned feature list.

---

## 2. Module Map

```
src/
├── extension.ts                   # activate() + deactivate() — ~15 lines
├── types/index.ts                 # Interfaces, error classes, type guards
├── logger.ts                      # OutputChannel-based logger
├── auth/
│   ├── serviceAccount.ts          # File picker, readFile, isServiceAccount validation
│   └── googleAuth.ts              # RS256 JWT generation, OAuth2 token exchange
├── firebase/
│   └── remoteConfig.ts            # fetchRemoteConfig(), mergeParameter() (pure), pushRemoteConfig()
├── webview/
│   ├── panel.ts                   # Panel creation, message wiring
│   └── content.ts                 # getWebviewContent(projectId) → HTML string
├── commands/
│   ├── pushRemoteConfig.ts        # Orchestration: auth → firebase → webview; owns AuthContext
│   └── resetServiceAccount.ts    # One-liner: clears rmcPush.serviceAccountPath
└── test/
    ├── extension.test.ts          # Smoke test: both command IDs registered
    └── suite/
        ├── auth.test.ts           # JWT payload correctness (no network)
        ├── firebase.test.ts       # mergeParameter pure function
        └── validation.test.ts     # isServiceAccount, key regex, value-by-type
```

---

## 3. Data Flow

```
Command triggered
      │
      ▼
resolveServiceAccountPath()     reads rmcPush.serviceAccountPath workspace setting
      │                         (prompts file picker on first run, then returns undefined — user must re-run)
      ▼
readServiceAccount(path)        fs.promises.readFile + JSON.parse + isServiceAccount() guard
      │                         throws ServiceAccountValidationError on failure
      ▼
getAuthContext(serviceAccount)  builds RS256 JWT → POST oauth2.googleapis.com/token
      │                         returns AuthContext { accessToken, projectId, expiresAt }
      ▼
fetchRemoteConfig(auth)         GET firebaseremoteconfig.googleapis.com (connectivity check)
      │
      ▼
createOrRevealPanel(...)        opens WebviewPanel, wires onDidReceiveMessage
      │
  [user fills form and submits]
      │
      ▼
handlePushMessage(panel, auth, msg)
  ├── isTokenExpired(auth)?      if yes → post 'error', ask user to re-run
  ├── fetchRemoteConfig(auth)    GET with fresh ETag
  ├── mergeParameter(template, key, value, type)   pure function, no side effects
  └── pushRemoteConfig(auth, updated, etag)        PUT with If-Match header
      │
      ▼
postMessage(panel, { status })  webview shows success / error
```

---

## 4. Coding Conventions

**Naming**
- `camelCase` for variables and functions, `PascalCase` for types/classes/interfaces
- Filenames match their primary export (e.g. `googleAuth.ts` exports `getAuthContext`)

**Error handling pattern**
- Leaf modules (`auth/`, `firebase/`) throw typed errors: `AuthError`, `FirebaseApiError`, `ServiceAccountValidationError`
- Command handlers (`commands/`) catch with `instanceof` and call `vscode.window.showErrorMessage`
- Never use `throw "string"` — always `throw new SomeError(...)`

**Async patterns**
- All I/O is `async/await`; no `fs.readFileSync` or blocking calls
- Functions that call VS Code APIs or the network are `async` and return `Promise<T>`

**Import order**
1. Node built-ins (`fs`, `path`, `crypto`)
2. Third-party (`jsonwebtoken`, `node-fetch`)
3. VS Code API (`vscode`)
4. Internal (`../types/index`, `../logger`)

---

## 5. Extension Lifecycle

**Activation event**: `onCommand:rmc-push.pushRemoteConfig`

The extension activates lazily when the push command is first invoked.

**`activate(context)`**:
1. Logs activation to OutputChannel
2. Calls `registerPushRemoteConfig(context)` and `registerResetServiceAccount()`
3. Pushes both disposables to `context.subscriptions`

**`deactivate()`**:
- Calls `logger.dispose()` to close the OutputChannel

**Disposables**: all VS Code objects with a `.dispose()` method (commands, event listeners, the OutputChannel) must be pushed to `context.subscriptions` so VS Code can clean up on deactivation.

---

## 6. Webview Security Model

The webview panel is created with:
```ts
{
  enableScripts: true,          // required for the form submit handler
  retainContextWhenHidden: true, // don't re-render when switching tabs
  localResourceRoots: []        // no local file access from webview
}
```

The HTML template includes a strict CSP:
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
```

This blocks all external network requests from within the webview. All data exchange uses the typed `postMessage` / `onDidReceiveMessage` protocol.

**Message types**:
- Webview → extension: `PushConfigMessage { command, key, value, type }`
- Extension → webview: `WebviewStatusMessage` — `loading | success | error`

---

## 7. Authentication Flow

1. **Service account JSON** is read from the path stored in `rmcPush.serviceAccountPath` (workspace setting).
2. An **RS256 JWT** is created with `jsonwebtoken.sign()`:
   - `iss` / `sub` = `client_email`
   - `aud` = `https://oauth2.googleapis.com/token`
   - `scope` = `https://www.googleapis.com/auth/firebase.remoteconfig`
   - `iat` = now; `exp` = now + 3600
3. The JWT is exchanged for an OAuth2 access token via `POST https://oauth2.googleapis.com/token` (grant type: `jwt-bearer`).
4. The result is stored as `AuthContext { accessToken, projectId, expiresAt }` in `commands/pushRemoteConfig.ts`.
5. **The private key is not retained** after `generateJwt()` returns — it exists only within the call stack of `getAuthContext()`.
6. **Token expiry**: before each push, `isTokenExpired(auth)` checks `Date.now()/1000 > expiresAt - 60`. If expired, the user is asked to re-run the command. (Full re-auth would require re-reading the service account file, which is a future improvement.)
7. `authContext` is set to `null` when the webview panel is disposed.

---

## 8. Firebase ETag Concurrency

The Firebase Remote Config REST API uses **optimistic concurrency** via ETags:

- `GET /remoteConfig` returns the template body and an `ETag` header.
- `PUT /remoteConfig` requires `If-Match: <etag>` — the server rejects the update with `412 Precondition Failed` if another client has modified the template since the GET.

**Why GET before every PUT**: without this, concurrent edits would silently clobber each other. The GET-then-PUT sequence guarantees the merge is applied to the latest version.

**Merge strategy**: `mergeParameter()` is a pure function that spreads the existing `parameters` object and adds/overwrites only the targeted key. `conditions`, `parameterGroups`, and other top-level fields are preserved via object spread.

---

## 9. Testing Strategy

**Pure / unit-testable modules** (no VS Code host required):
- `firebase/remoteConfig.ts` → `mergeParameter()` — tested in `firebase.test.ts`
- `types/index.ts` → `isServiceAccount()` — tested in `validation.test.ts`
- `auth/googleAuth.ts` → JWT payload shape — tested in `auth.test.ts` using a generated RSA key pair

**VS Code host required**:
- `extension.test.ts` — smoke test that verifies both command IDs are registered; runs via `@vscode/test-electron`

**Network calls** (`oauth2.googleapis.com`, `firebaseremoteconfig.googleapis.com`) are **not mocked** — they are thin wrappers validated only by manual integration testing with real credentials.

**Running tests**:
```bash
npm run compile-tests   # tsc → out/
npm run test            # @vscode/test-cli spins up Electron + Mocha
```

---

## 10. Deployment Process

```bash
npm run check-types     # zero errors
npm run lint            # zero warnings
npm run package         # production esbuild (minified, treeshaken)
npx vsce package        # produces rmc-push-x.y.z.vsix
```

- Never commit `.vsix` artifacts — they are covered by `.gitignore`
- Publish to the VS Code Marketplace via `npx vsce publish` (requires PAT configured in `vsce`)
- Bump `version` in `package.json` and add a `CHANGELOG.md` entry before publishing
