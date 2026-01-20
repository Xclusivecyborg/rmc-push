# Firebase Remote Config Push (VS Code)

Push values to **Firebase Remote Config** directly from **VS Code**—no Firebase Console needed.

This extension is built for developers who want a **fast, safe, and simple** way to manage Remote Config while staying inside their editor.

![Icon](icon.png)

---

## 🚀 Features

- **Direct Push**: Update Remote Config parameters instantly from VS Code.
- **Smart Validation**:
  - **Key Check**: Prevents invalid key formats (e.g., no hyphens allow, only alphanumeric and underscores).
  - **Type Support**: Locally validates **JSON**, **Number**, **Boolean**, and **String** before pushing.
- **Interactive UI**: A simple, modern webview form for quick data entry.
- **Project Awareness**: Displays the active Firebase Project ID in the UI to prevent accidental pushes to the wrong environment.
- **Safe Merging**: Automatically fetches the current template and merges your changes—**never** overwrites your entire configuration.
- **Workspace Isolation**: Save your service account path per workspace for secure, project-specific workflows.

---

## ✅ Supported Value Types

- **String**
- **Number**
- **Boolean**
- **JSON**

---

## 📦 Requirements

Before using this extension, make sure you have:

- A **Firebase project**
- A **Firebase Service Account JSON file**
- The service account must have **Remote Config Admin** permissions

---

## 🛠️ Step-by-Step Setup & Configuration

### Step 1: Create a Firebase Service Account

1. Go to **Firebase Console**
2. Open your project
3. Navigate to:
   ```
   Project Settings → Service Accounts
   ```
4. Click **Generate new private key**
5. Download the `.json` file

> ⚠️ **Important:**  
> Never commit this file to Git.

---

### Step 3: Configure the Extension

1. Open **VS Code**
2. Open the **Command Palette**
   - `Cmd + Shift + P` (macOS)
   - `Ctrl + Shift + P` (Windows/Linux)
3. Run:
   ```
   Push to Firebase Remote Config
   ```
4. On first run, you’ll be prompted to:
   - Select your **service account JSON file**
   - Make sure you select the correct **service account** for your project that you just downloaded

✅ The path is saved **per workspace**, so you only do this once.

---

### Step 4: Push a Remote Config Value

1. Open the command again:
   ```
   Push to Firebase Remote Config
   ```
2. Fill in the form:
   - **Key** → e.g. `enable_new_checkout`
   - **Type** → Boolean / String / Number / JSON
   - **Value** → `true`
3. Confirm and push 🎉

The extension will:

- Fetch the existing Remote Config
- Merge your change safely
- Push only the updated values

---

## ⚙️ Extension Settings

This extension adds one setting:

```json
rmcPush.serviceAccountPath
```

**What it does**

- Stores the path to your Firebase service account
- Saved per workspace
- Recommended location: `.vscode/`

---

## 🔄 Switching Firebase Projects

If you need to change credentials:

1. Open the Command Palette
2. Run:
   ```
   Reset Service Account Path
   ```
3. Select a new service account file

---

## 🛡️ Best Practices

- ✅ Always `.gitignore` service account files
- ✅ Use separate service accounts for staging & production
- ❌ Never share service account keys publicly
- 🔍 Double-check the **Project ID** shown before pushing

---

## ❤️ Who This Is For

- Mobile developers
- Flutter engineers
- Backend engineers
- Anyone tired of opening Firebase Console just to change a flag

---

**Built with ❤️ for Flutter & Mobile Developers**
