// ─── State ───
let authenticated = false;
let folderSelected = false;
let selectedFiles = new Map();
let folderStack = [];
let currentSource = '__mydrive__';
let isSearchMode = false;
let fileStatuses = new Map();
let currentFiles = []; // track rendered files for Select All

const SOURCE_LABELS = {
  '__mydrive__': 'My Drive',
  '__shared__': 'Shared with me',
  '__starred__': 'Starred',
  '__recent__': 'Recent',
};

// ─── DOM ───
const $ = (sel) => document.querySelector(sel);
const screenAuth = $('#screen-auth');
const screenBrowse = $('#screen-browse');
const btnChooseFolder = $('#btn-choose-folder');
const folderStatus = $('#folder-status');
const btnSignIn = $('#btn-sign-in');
const btnSignOut = $('#btn-sign-out');
const btnBack = $('#btn-back');
const breadcrumbs = $('#breadcrumbs');
const searchInput = $('#search-input');
const selectionBar = $('#selection-bar');
const selectionCount = $('#selection-count');
const btnDownloadSelected = $('#btn-download-selected');
const btnClearSelection = $('#btn-clear-selection');
const btnSelectAll = $('#btn-select-all');
const fileList = $('#file-list');
const fileCount = $('#file-count');
const downloadStatus = $('#download-status');
const syncFolderLabel = $('#sync-folder-label');
const btnSelectFolder = $('#btn-select-folder');

// ─── Init ───
async function init() {
  const folder = await window.api.getSyncFolder();
  if (folder) {
    folderSelected = true;
    syncFolderLabel.textContent = folder.split('/').pop();
    syncFolderLabel.title = folder;
  }
  updateAuthUI();
}

// ─── Auth ───
btnChooseFolder.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    folderSelected = true;
    folderStatus.textContent = '\u2713 ' + folder.split('/').pop();
    syncFolderLabel.textContent = folder.split('/').pop();
    syncFolderLabel.title = folder;
    updateAuthUI();
  }
});

btnSignIn.addEventListener('click', async () => {
  btnSignIn.textContent = 'Opening browser...';
  btnSignIn.disabled = true;
  const result = await window.api.googleAuth();
  if (result.error) {
    btnSignIn.textContent = 'Sign In with Google';
    btnSignIn.disabled = false;
    alert(result.error);
  } else {
    authenticated = true;
    showBrowseScreen();
  }
});

btnSignOut.addEventListener('click', async () => {
  await window.api.signOut();
  authenticated = false;
  showAuthScreen();
});

btnSelectFolder.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    folderSelected = true;
    syncFolderLabel.textContent = folder.split('/').pop();
    syncFolderLabel.title = folder;
  }
});

syncFolderLabel.addEventListener('click', () => window.api.openSyncFolder());

function updateAuthUI() { btnSignIn.disabled = !folderSelected; }

function showAuthScreen() {
  screenAuth.style.display = 'flex';
  screenBrowse.style.display = 'none';
}

function showBrowseScreen() {
  screenAuth.style.display = 'none';
  screenBrowse.style.display = 'flex';
  screenBrowse.style.flexDirection = 'column';
  screenBrowse.style.flex = '1';
  switchSource('__mydrive__');
}

// ─── Events from main ───
window.api.onAuthStatus((data) => {
  if (data.authenticated) { authenticated = true; showBrowseScreen(); }
});
window.api.onDownloadProgress((data) => {
  fileStatuses.set(data.fileId, data);
  updateFileStatus(data.fileId, data);
});

// ─── Sidebar Navigation ───
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const source = item.dataset.source;
    switchSource(source);
  });
});

function switchSource(source) {
  currentSource = source;
  folderStack = [];
  isSearchMode = false;
  searchInput.value = '';

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.source === source);
  });

  updateBreadcrumbs();
  const folderId = source === '__mydrive__' ? null : source;
  loadFiles(folderId);
}

// ─── File Browsing ───
async function loadFiles(folderId) {
  fileList.innerHTML = '<div class="loading">Loading...</div>';

  const result = await window.api.listFiles(folderId || null);
  if (result.error) {
    fileList.innerHTML = `<div class="empty-state"><div class="icon">\u26a0\ufe0f</div><p>${result.error}</p></div>`;
    return;
  }

  renderFiles(result.files);
}

async function searchFiles(query) {
  if (!query.trim()) return;
  fileList.innerHTML = '<div class="loading">Searching...</div>';
  isSearchMode = true;

  // Clear sidebar active
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  const result = await window.api.searchFiles(query);
  if (result.error) {
    fileList.innerHTML = `<div class="empty-state"><div class="icon">\u26a0\ufe0f</div><p>${result.error}</p></div>`;
    return;
  }

  folderStack = [];
  updateBreadcrumbs();
  breadcrumbs.innerHTML = `<span class="crumb active">Search: "${escapeHtml(query)}"</span>`;
  renderFiles(result.files);
}

function renderFiles(files) {
  currentFiles = files || [];
  if (!files || files.length === 0) {
    fileList.innerHTML = '<div class="empty-state"><div class="icon">\ud83d\udced</div><p>No files found</p></div>';
    fileCount.textContent = '0 items';
    return;
  }

  fileList.innerHTML = '';
  for (const file of files) {
    fileList.appendChild(createFileElement(file));
  }
  fileCount.textContent = `${files.length} items`;
}

function createFileElement(file) {
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  const isDownloadable = isDownloadableType(file.mimeType);

  const el = document.createElement('div');
  el.className = 'file-item';
  el.dataset.id = file.id;

  if (selectedFiles.has(file.id)) el.classList.add('selected');
  const status = fileStatuses.get(file.id);
  if (status?.status === 'done') el.classList.add('downloaded');
  if (status?.status === 'downloading') el.classList.add('downloading');

  el.innerHTML = `
    ${isDownloadable ? `<input type="checkbox" class="file-checkbox" ${selectedFiles.has(file.id) ? 'checked' : ''}>` : '<span style="width:16px"></span>'}
    <span class="file-icon">${getFileIcon(file.mimeType)}</span>
    <div class="file-info">
      <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
      <div class="file-meta">${getFileType(file.mimeType)}${file.modifiedTime ? ' \u00b7 ' + formatDate(file.modifiedTime) : ''}</div>
    </div>
    <span class="file-status ${status?.status === 'done' ? 'success' : status?.status === 'error' ? 'error' : ''}">${getStatusText(status)}</span>
  `;

  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('file-checkbox')) {
      toggleSelection(file, e.target.checked);
      return;
    }
    if (isFolder) {
      navigateToFolder(file.id, file.name);
    } else if (isDownloadable) {
      const cb = el.querySelector('.file-checkbox');
      cb.checked = !cb.checked;
      toggleSelection(file, cb.checked);
    }
  });

  if (isDownloadable) {
    el.addEventListener('dblclick', (e) => { e.preventDefault(); downloadSingle(file); });
  }

  return el;
}

// ─── Navigation ───
function navigateToFolder(folderId, folderName) {
  isSearchMode = false;
  folderStack.push({ id: folderId, name: folderName });
  updateBreadcrumbs();
  loadFiles(folderId);
}

function navigateBack() {
  if (folderStack.length === 0) return;
  folderStack.pop();
  const current = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  updateBreadcrumbs();
  loadFiles(current?.id || (currentSource === '__mydrive__' ? null : currentSource));
}

function navigateToCrumb(index) {
  if (index === -1) {
    folderStack = [];
  } else {
    folderStack = folderStack.slice(0, index + 1);
  }
  updateBreadcrumbs();
  const current = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  loadFiles(current?.id || (currentSource === '__mydrive__' ? null : currentSource));
}

function updateBreadcrumbs() {
  const rootLabel = SOURCE_LABELS[currentSource] || 'My Drive';
  btnBack.disabled = folderStack.length === 0 && !isSearchMode;

  let html = `<span class="crumb" data-index="-1">${rootLabel}</span>`;
  for (let i = 0; i < folderStack.length; i++) {
    html += `<span class="crumb-sep">\u203a</span><span class="crumb" data-index="${i}">${escapeHtml(folderStack[i].name)}</span>`;
  }
  breadcrumbs.innerHTML = html;

  breadcrumbs.querySelectorAll('.crumb').forEach((crumb) => {
    crumb.addEventListener('click', () => navigateToCrumb(parseInt(crumb.dataset.index)));
  });
}

btnBack.addEventListener('click', () => {
  if (isSearchMode) {
    isSearchMode = false;
    searchInput.value = '';
    switchSource(currentSource);
  } else {
    navigateBack();
  }
});

// ─── Search ───
const GDOC_URL_RE = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\//;
const FOLDER_URL_RE = /drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/;

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = searchInput.value.trim();
    const folderMatch = val.match(FOLDER_URL_RE);
    if (folderMatch) {
      openFolderUrl(folderMatch[1]);
    } else if (GDOC_URL_RE.test(val)) {
      fetchByUrl(val);
    } else {
      searchFiles(val);
    }
  }
  if (e.key === 'Escape') {
    searchInput.value = '';
    if (isSearchMode) switchSource(currentSource);
  }
});

async function openFolderUrl(folderId) {
  isSearchMode = false;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  folderStack = [{ id: folderId, name: 'Linked Folder' }];
  updateBreadcrumbs();
  loadFiles(folderId);
}

async function fetchByUrl(url) {
  fileList.innerHTML = '<div class="loading">Fetching document...</div>';
  isSearchMode = true;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  const result = await window.api.fetchByUrl(url);
  if (result.error) {
    fileList.innerHTML = `<div class="empty-state"><div class="icon">\u26a0\ufe0f</div><p>${result.error}</p></div>`;
    return;
  }

  folderStack = [];
  updateBreadcrumbs();
  breadcrumbs.innerHTML = '<span class="crumb active">URL Import</span>';
  renderFiles([result.file]);
}

// ─── Selection ───
function toggleSelection(file, checked) {
  if (checked) { selectedFiles.set(file.id, file); } else { selectedFiles.delete(file.id); }
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedFiles.size;
  selectionBar.style.display = count > 0 ? '' : 'none';
  selectionCount.textContent = `${count} selected`;
}

btnClearSelection.addEventListener('click', () => {
  selectedFiles.clear();
  updateSelectionUI();
  fileList.querySelectorAll('.file-checkbox').forEach((cb) => {
    cb.checked = false;
    cb.closest('.file-item')?.classList.remove('selected');
  });
});

btnSelectAll.addEventListener('click', () => {
  for (const file of currentFiles) {
    if (isDownloadableType(file.mimeType) && !selectedFiles.has(file.id)) {
      selectedFiles.set(file.id, file);
    }
  }
  fileList.querySelectorAll('.file-checkbox').forEach((cb) => {
    cb.checked = true;
    cb.closest('.file-item')?.classList.add('selected');
  });
  updateSelectionUI();
});

// ─── Download ───
btnDownloadSelected.addEventListener('click', async () => {
  if (selectedFiles.size === 0) return;
  const files = Array.from(selectedFiles.values());
  btnDownloadSelected.disabled = true;
  btnDownloadSelected.textContent = 'Downloading...';
  downloadStatus.textContent = `Downloading ${files.length}...`;

  const result = await window.api.downloadFiles(files);

  btnDownloadSelected.disabled = false;
  btnDownloadSelected.textContent = '\u2b07 Download .md';

  if (result.error) {
    downloadStatus.textContent = `Error: ${result.error}`;
  } else {
    const s = result.results.filter((r) => r.status === 'success').length;
    const e = result.results.filter((r) => r.status === 'error').length;
    downloadStatus.textContent = `\u2713 ${s} saved${e ? `, ${e} failed` : ''}`;
  }

  selectedFiles.clear();
  updateSelectionUI();
});

async function downloadSingle(file) {
  downloadStatus.textContent = `Downloading ${file.name}...`;
  const result = await window.api.downloadFiles([file]);
  if (result.error) {
    downloadStatus.textContent = `Error: ${result.error}`;
  } else {
    const r = result.results[0];
    downloadStatus.textContent = r.status === 'success' ? `\u2713 ${r.name}.md` : `\u2717 ${r.error || r.reason}`;
  }
}

function updateFileStatus(fileId, data) {
  const el = fileList.querySelector(`[data-id="${fileId}"]`);
  if (!el) return;
  const statusEl = el.querySelector('.file-status');
  if (statusEl) {
    statusEl.textContent = getStatusText(data);
    statusEl.className = `file-status ${data.status === 'done' ? 'success' : data.status === 'error' ? 'error' : ''}`;
  }
  el.classList.toggle('downloaded', data.status === 'done');
  el.classList.toggle('downloading', data.status === 'downloading');
}

// ─── Helpers ───
function isDownloadableType(mimeType) {
  return ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation', 'text/plain', 'text/markdown'].includes(mimeType);
}

function getFileIcon(m) {
  const icons = {
    'application/vnd.google-apps.folder': '\ud83d\udcc1',
    'application/vnd.google-apps.document': '\ud83d\udcdd',
    'application/vnd.google-apps.spreadsheet': '\ud83d\udcca',
    'application/vnd.google-apps.presentation': '\ud83d\udcfd\ufe0f',
    'text/plain': '\ud83d\udcc4', 'text/markdown': '\ud83d\udcc4',
    'application/pdf': '\ud83d\udcd5',
  };
  return icons[m] || '\ud83d\udcce';
}

function getFileType(m) {
  const types = {
    'application/vnd.google-apps.folder': 'Folder',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Slides',
    'text/plain': 'Text', 'text/markdown': 'Markdown', 'application/pdf': 'PDF',
  };
  return types[m] || (m?.split('/').pop() || 'File');
}

function getStatusText(s) {
  if (!s) return '';
  return { downloading: '\u23f3', done: '\u2713 saved', error: '\u2717 error' }[s.status] || '';
}

function formatDate(dateStr) {
  const d = new Date(dateStr), diff = Date.now() - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ─── Boot ───
init();
