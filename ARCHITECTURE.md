# Architecture Guide — rmc-push

Onboarding reference for engineers new to this codebase.

---

## 1. Purpose and Scope

**rmc-push** is a VS Code extension that lets developers browse and edit Firebase Remote Config without leaving the editor. It lives in its own activity bar container as a docked sidebar: it authenticates with a service account, lists the project's existing parameters and parameter groups, and pushes edits back one parameter at a time.

**Out of scope (planned, not yet built)**:
- Editing multiple parameters in one operation
- Creating/editing conditions or condition expressions (existing conditions are shown as a count and preserved on write, but not editable here)
- Deleting parameters or groups
- Remote Config version history and rollback
- Multi-project support (one service account at a time)

See `src/requirements.todo` for the planned feature list.

---

## 2. Module Map

```
media/                             # Shipped verbatim; never bundled by esbuild
├── rmc-push.svg                   # Activity bar icon (monochrome, currentColor)
├── main.css                       # Sidebar styles, VS Code theme variables only
└── main.js                        # Sidebar app: renders ViewState, posts intent

src/
├── extension.ts                   # activate(): builds session + provider, wires both
├── types/index.ts                 # Interfaces, ViewState, message protocol, guards
├── validation.ts                  # validatePush()/normalizeValue() — pure, shared with tests
├── logger.ts                      # OutputChannel-based logger
├── session.ts                     # RmcPushSession — owns all state that outlives the view
├── auth/
│   ├── serviceAccount.ts          # readFile + isServiceAccount validation (no vscode import)
│   └── googleAuth.ts              # RS256 JWT generation, OAuth2 token exchange
├── firebase/
│   └── remoteConfig.ts            # fetch/push + pure toSections(), mergeParameter()
├── webview/
│   ├── view.ts                    # RmcPushViewProvider — WebviewViewProvider for the sidebar
│   └── content.ts                 # getWebviewContent(webview, uri) → HTML shell with nonce CSP
├── commands/
│   └── index.ts                   # Thin palette commands; none run the push flow themselves
└── test/
    ├── extension.test.ts          # Activation, command registration, view contribution
    └── suite/
        ├── auth.test.ts           # JWT payload correctness (no network)
        ├── firebase.test.ts       # mergeParameter / mergeParameterInGroup pure functions
        ├── sections.test.ts       # toSections() flattening, sorting, edge cases
        └── validation.test.ts     # isServiceAccount, validatePush, normalizeValue
```

**The central split**: `session.ts` holds state, `webview/view.ts` holds none. VS Code disposes a `WebviewView` whenever it is hidden, so anything stored in the view would be lost. The view renders whatever `session.getState()` returns and forwards user intent back; the session emits `onDidChangeState` and every live view re-renders.

---

## 3. Data Flow

**Startup** — `activate()` calls `session.connect()` in the background, so the sidebar is populated before the user first opens it.

```
session.connect()
      │
      ▼
reads rmcPush.serviceAccountPath   empty → state = { kind: 'no-account' }
      │
      ▼
readServiceAccount(path)           fs.promises.readFile + JSON.parse + isServiceAccount()
      │                            throws ServiceAccountValidationError → state = error
      ▼
getAuthContext(serviceAccount)     RS256 JWT → POST oauth2.googleapis.com/token
      │
      ▼
fetchRemoteConfig(auth)            GET firebaseremoteconfig.googleapis.com
      │
      ▼
toSections(template)               pure: flattens root params + groups, sorted
      │
      ▼
state = { kind: 'ready', projectId, accountPath, sections }
      │
      ▼
onDidChangeState  ──▶  provider.render(state)  ──▶  postMessage({ type: 'state' })
```

**Push** — the webview validates for instant feedback, then the host re-validates before any network call:

```
webview posts { type: 'push', key, value, valueType, group? }
      │
      ▼
session.push(input)
  ├── validatePush(input)          throws PushValidationError → reported on the field
  ├── ensureAuth()                 silently re-authenticates if the token is near expiry
  ├── fetchRemoteConfig(auth)      GET for a *fresh* ETag immediately before the write
  ├── mergeParameter[InGroup](…)   pure function, no side effects
  └── pushRemoteConfig(auth, …)    PUT with If-Match
      │
      ▼
state = ready(updated)             list reflects Firebase without a second round trip
      │
      ▼
provider posts { type: 'pushResult', ok, message }
```

**Concurrency**: `connect()` and `refresh()` bump a `generation` counter and discard their result if a newer call has started. Without it a slow first connect could overwrite the state produced by a faster later one.

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

**Activation events**: `[]` — VS Code ≥ 1.74 generates them implicitly from `contributes.commands` and `contributes.views`, so the extension activates when the sidebar is opened or any command is run.

**`activate(context)`**:
1. Logs activation to the OutputChannel
2. Constructs `RmcPushSession` and `RmcPushViewProvider`
3. Registers the provider with `retainContextWhenHidden: true`, so a half-filled form survives the user switching sidebar views
4. Subscribes `provider.render` to `session.onDidChangeState`
5. Registers the palette commands
6. Kicks off `session.connect()` without awaiting it

**`deactivate()`**: closes the OutputChannel.

**Disposables**: the session, the state subscription, the provider registration, and every command go into `context.subscriptions`.

**Contribution points** (`package.json`):
- `viewsContainers.activitybar` → the `rmcPush` container and its icon
- `views.rmcPush` → one entry with `"type": "webview"`, id `rmcPush.configView`
- `menus.view/title` → the refresh button in the view's title bar

---

## 6. Webview Security Model

The view is resolved with:
```ts
webviewView.webview.options = {
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]  // media/ only
};
```

`retainContextWhenHidden` is set at *registration* time (it is not a webview option for views):
```ts
vscode.window.registerWebviewViewProvider(viewType, provider, {
  webviewOptions: { retainContextWhenHidden: true }
});
```

The HTML shell carries a nonce-based CSP:
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
```

`default-src 'none'` blocks every remote request. Styles come only from the extension directory, and the script must additionally match a per-load nonce — so even if markup were injected into the DOM it could not execute.

**Defence in depth in `media/main.js`**: every user- or Firebase-supplied string is written with `textContent` or `createElement`, never `innerHTML`. Remote Config values come from a remote service and must not be able to inject markup.

**Message protocol** (`src/types/index.ts`):
- Webview → host: `WebviewMessage` — `ready | selectAccount | refresh | push`, narrowed by the `isWebviewMessage` guard before use
- Host → webview: `HostMessage` — `{ type: 'state', state: ViewState }` and `{ type: 'pushResult', ok, message }`

The `ready` handshake matters: the script mounts *after* `webview.html` is assigned, so the host waits to be told the listener exists before sending the first state.

**Validation is duplicated deliberately.** `media/main.js` mirrors `src/validation.ts` for instant per-field feedback, but the host re-runs `validatePush()` in `session.push()` before touching Firebase. The webview copy is convenience; the host copy is the guarantee.

---

## 7. Authentication Flow

1. **Service account JSON** is read from the path stored in `rmcPush.serviceAccountPath` (workspace setting).
2. An **RS256 JWT** is created with `jsonwebtoken.sign()`:
   - `iss` / `sub` = `client_email`
   - `aud` = `https://oauth2.googleapis.com/token`
   - `scope` = `https://www.googleapis.com/auth/firebase.remoteconfig`
   - `iat` = now; `exp` = now + 3600
3. The JWT is exchanged for an OAuth2 access token via `POST https://oauth2.googleapis.com/token` (grant type: `jwt-bearer`).
4. The result is stored as `AuthContext { accessToken, projectId, expiresAt }` on `RmcPushSession`.
5. **The private key is not retained** after `generateJwt()` returns — it exists only within the call stack of `getAuthContext()`.
6. **Token expiry**: `ensureAuth()` checks `isTokenExpired(auth)` (`Date.now()/1000 > expiresAt - 60`) before every push and refresh. If the token has aged out it silently mints a new one from the retained service account — the user is never interrupted. (The previous design could not do this because the service account was not held anywhere, so it asked the user to re-run the command.)
7. The session holds the parsed `ServiceAccount` for its lifetime; it is cleared when the configured path is emptied via **Reset Service Account Path**.

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
- `firebase/remoteConfig.ts` → `mergeParameter()`, `mergeParameterInGroup()` — tested in `firebase.test.ts`
- `firebase/remoteConfig.ts` → `toSections()` — tested in `sections.test.ts` (sorting, empty groups, absent `valueType`, condition counts, `useInAppDefault`)
- `validation.ts` → `validatePush()`, `normalizeValue()` — tested in `validation.test.ts`
- `types/index.ts` → `isServiceAccount()` — tested in `validation.test.ts`
- `auth/googleAuth.ts` → JWT payload shape — tested in `auth.test.ts` using a generated RSA key pair

**VS Code host required**:
- `extension.test.ts` — activates the extension, asserts every contributed command is registered and that the sidebar view is contributed as a webview in its own container; runs via `@vscode/test-electron`

**The webview app** (`media/main.js`) has no automated coverage — it runs in a browser context the test host does not reach. It is verified by loading `media/` in a plain page with a stubbed `acquireVsCodeApi()` and driving each `ViewState` by hand.

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
