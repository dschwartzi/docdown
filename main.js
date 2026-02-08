const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const Store = require('electron-store');
const TurndownService = require('turndown');

const store = new Store();
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Google OAuth config — credentials loaded from local credentials.json (gitignored)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];
const REDIRECT_PORT = 48521;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

let mainWindow;
let oauth2Client;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: 'Docdown',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // Restore saved state
  const savedFolder = store.get('syncFolder');
  const savedCreds = store.get('googleCredentials');
  if (savedFolder) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('folder-selected', savedFolder);
      if (savedCreds) {
        mainWindow.webContents.send('auth-status', { authenticated: true });
      }
    });
  }
});

app.on('window-all-closed', () => app.quit());

// ─── Google OAuth ───────────────────────────────────────────────

function getOAuth2Client() {
  if (!oauth2Client) {
    const credsPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credsPath)) {
      console.error('credentials.json not found in app directory');
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    const creds = raw.installed || raw.web || raw;
    oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);
  }
  return oauth2Client;
}

ipcMain.handle('google-auth', async () => {
  const client = getOAuth2Client();

  // Check for saved tokens
  const savedTokens = store.get('googleTokens');
  if (savedTokens) {
    client.setCredentials(savedTokens);
    // Check if token is still valid
    try {
      const drive = google.drive({ version: 'v3', auth: client });
      await drive.files.list({ pageSize: 1 });
      store.set('googleCredentials', true);
      return { success: true };
    } catch (e) {
      // Token expired, re-auth
      store.delete('googleTokens');
    }
  }

  // Start OAuth flow with local HTTP server
  return new Promise((resolve) => {
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/callback') {
        const code = parsedUrl.query.code;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to Docdown.</p></body></html>');
        server.close();

        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          store.set('googleTokens', tokens);
          store.set('googleCredentials', true);
          mainWindow.webContents.send('auth-status', { authenticated: true });
          resolve({ success: true });
        } catch (err) {
          resolve({ error: `Auth failed: ${err.message}` });
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      shell.openExternal(authUrl);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      resolve({ error: 'Authentication timed out. Please try again.' });
    }, 120000);
  });
});

ipcMain.handle('sign-out', async () => {
  store.delete('googleTokens');
  store.delete('googleCredentials');
  oauth2Client = null;
  return { success: true };
});

// ─── Folder Selection ───────────────────────────────────────────

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select sync folder for Markdown files',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0];
  store.set('syncFolder', folder);
  return folder;
});

ipcMain.handle('get-sync-folder', () => {
  return store.get('syncFolder') || null;
});

ipcMain.handle('open-sync-folder', () => {
  const folder = store.get('syncFolder');
  if (folder && fs.existsSync(folder)) {
    shell.openPath(folder);
    return true;
  }
  return false;
});

// ─── Google Drive Browsing ──────────────────────────────────────

ipcMain.handle('list-files', async (event, folderId) => {
  const client = getOAuth2Client();
  if (!client) return { error: 'Not authenticated' };

  const savedTokens = store.get('googleTokens');
  if (savedTokens) client.setCredentials(savedTokens);

  const drive = google.drive({ version: 'v3', auth: client });

  try {
    let query;
    let orderBy = 'folder,name';
    if (folderId === '__shared__') {
      query = 'sharedWithMe = true and trashed = false';
      orderBy = 'folder,modifiedTime desc';
    } else if (folderId === '__starred__') {
      query = 'starred = true and trashed = false';
      orderBy = 'folder,modifiedTime desc';
    } else if (folderId === '__recent__') {
      query = 'trashed = false';
      orderBy = 'folder,viewedByMeTime desc';
    } else if (folderId) {
      query = `'${folderId}' in parents and trashed = false`;
    } else {
      query = `'root' in parents and trashed = false`;
    }

    const res = await drive.files.list({
      q: query,
      pageSize: 200,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name, mimeType, modifiedTime, size, iconLink, driveId)',
      orderBy,
    });

    return { files: res.data.files || [] };
  } catch (err) {
    if (err.code === 401) {
      store.delete('googleTokens');
      store.delete('googleCredentials');
      return { error: 'Session expired. Please sign in again.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('search-files', async (event, query) => {
  const client = getOAuth2Client();
  if (!client) return { error: 'Not authenticated' };

  const savedTokens = store.get('googleTokens');
  if (savedTokens) client.setCredentials(savedTokens);

  const drive = google.drive({ version: 'v3', auth: client });

  try {
    const res = await drive.files.list({
      q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
      pageSize: 50,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name, mimeType, modifiedTime, size, iconLink, driveId)',
      orderBy: 'folder,modifiedTime desc',
    });

    return { files: res.data.files || [] };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Download as Markdown ───────────────────────────────────────

ipcMain.handle('download-files', async (event, fileIds) => {
  const client = getOAuth2Client();
  if (!client) return { error: 'Not authenticated' };

  const savedTokens = store.get('googleTokens');
  if (savedTokens) client.setCredentials(savedTokens);

  const syncFolder = store.get('syncFolder');
  if (!syncFolder) return { error: 'No sync folder selected' };

  const drive = google.drive({ version: 'v3', auth: client });
  const results = [];

  for (const file of fileIds) {
    try {
      mainWindow.webContents.send('download-progress', {
        fileId: file.id,
        status: 'downloading',
        name: file.name,
      });

      let content;
      const isGoogleDoc = file.mimeType === 'application/vnd.google-apps.document';
      const isGoogleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
      const isGoogleSlides = file.mimeType === 'application/vnd.google-apps.presentation';

      if (isGoogleDoc) {
        // Export Google Doc as HTML, convert to Markdown
        const res = await drive.files.export({
          fileId: file.id,
          mimeType: 'text/html',
        });
        content = turndown.turndown(res.data);
      } else if (isGoogleSheet) {
        // Export as CSV
        const res = await drive.files.export({
          fileId: file.id,
          mimeType: 'text/csv',
        });
        content = `# ${file.name}\n\n\`\`\`csv\n${res.data}\n\`\`\``;
      } else if (isGoogleSlides) {
        // Export as plain text
        const res = await drive.files.export({
          fileId: file.id,
          mimeType: 'text/plain',
        });
        content = `# ${file.name}\n\n${res.data}`;
      } else if (file.mimeType === 'text/plain' || file.mimeType === 'text/markdown') {
        // Download text files directly
        const res = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'text' }
        );
        content = res.data;
      } else {
        results.push({ id: file.id, name: file.name, status: 'skipped', reason: 'Unsupported file type' });
        continue;
      }

      // Sanitize filename and write
      const safeName = file.name.replace(/[/\\?%*:|"<>]/g, '-');
      const fileName = safeName.endsWith('.md') ? safeName : `${safeName}.md`;
      const filePath = path.join(syncFolder, fileName);

      fs.writeFileSync(filePath, content, 'utf-8');
      results.push({ id: file.id, name: file.name, status: 'success', path: filePath });

      mainWindow.webContents.send('download-progress', {
        fileId: file.id,
        status: 'done',
        name: file.name,
        path: filePath,
      });
    } catch (err) {
      results.push({ id: file.id, name: file.name, status: 'error', error: err.message });
      mainWindow.webContents.send('download-progress', {
        fileId: file.id,
        status: 'error',
        name: file.name,
        error: err.message,
      });
    }
  }

  return { results };
});
