const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  googleAuth: () => ipcRenderer.invoke('google-auth'),
  signOut: () => ipcRenderer.invoke('sign-out'),

  // Folder
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getSyncFolder: () => ipcRenderer.invoke('get-sync-folder'),
  openSyncFolder: () => ipcRenderer.invoke('open-sync-folder'),

  // Drive
  listFiles: (folderId) => ipcRenderer.invoke('list-files', folderId),
  searchFiles: (query) => ipcRenderer.invoke('search-files', query),
  fetchByUrl: (url) => ipcRenderer.invoke('fetch-by-url', url),

  // Download
  downloadFiles: (files) => ipcRenderer.invoke('download-files', files),

  // Events from main
  onAuthStatus: (cb) => ipcRenderer.on('auth-status', (_, data) => cb(data)),
  onFolderSelected: (cb) => ipcRenderer.on('folder-selected', (_, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),
});
