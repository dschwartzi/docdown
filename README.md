# Docdown

Pull your Google Docs down as Markdown. A lightweight Electron desktop app that lets you browse Google Drive, select docs, and save them as `.md` files to a local folder — ready for VS Code to read.

## Setup

### 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable these APIs:
   - **Google Drive API**
   - **Google Docs API**
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth 2.0 Client ID**
6. Application type: **Desktop app**
7. Download the JSON file (save as `credentials.json`)

> **Important:** Add `http://localhost:48521/callback` as an authorized redirect URI in your OAuth client settings.

### 2. Install & Run

```bash
cd docdown
npm install
npm start
```

### 3. First Launch

1. Click **Select credentials.json** → pick your downloaded OAuth file
2. Click **Choose Folder** → pick where `.md` files will be saved
3. Click **Sign In with Google** → authorize in browser
4. Browse your Drive and download docs!

## Usage

- **Single-click** a folder to navigate into it
- **Single-click** a file to select/deselect it
- **Double-click** a file to instantly download it
- **Search** by typing in the search box
- Use **breadcrumbs** to navigate back
- Selected files show a blue **Download as Markdown** button
- Downloaded files get a green `✓ saved` indicator

## Supported File Types

| Type | Export Format |
|------|-------------|
| Google Docs | HTML → Markdown (via Turndown) |
| Google Sheets | CSV wrapped in markdown code block |
| Google Slides | Plain text with title |
| Text files | Direct download |
| Markdown files | Direct download |

## Architecture

```
main.js        → Electron main process (OAuth, Drive API, file I/O)
preload.js     → Secure IPC bridge (contextIsolation)
renderer/
  index.html   → UI shell
  styles.css   → Dark theme styling
  app.js       → File browser, selection, download logic
```

No data leaves your machine except Google API calls. Tokens are stored locally via `electron-store`.
