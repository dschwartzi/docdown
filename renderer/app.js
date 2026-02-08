// ─── State ───
let authenticated = false;
let folderSelected = false;
let selectedFiles = new Map(); // id -> file obj
let folderStack = []; // { id, name } for breadcrumb navigation
let isSearchMode = false;
let fileStatuses = new Map(); // id -> status

// ─── DOM ───
const $ = (sel) => document.querySelector(sel);
const screenAuth = $('#screen-auth');
const screenBrowse = $('#screen-browse');

// Auth
const btnChooseFolder = $('#btn-choose-folder');
const folderStatus = $('#folder-status');
const btnSignIn = $('#btn-sign-in');
const btnSignOut = $('#btn-sign-out');

// Browse
const btnBack = $('#btn-back');
const breadcrumbs = $('#breadcrumbs');
const searchInput = $('#search-input');
const btnSearch = $('#btn-search');
const btnClearSearch = $('#btn-clear-search');
const selectionBar = $('#selection-bar');
const selectionCount = $('#selection-count');
const btnDownloadSelected = $('#btn-download-selected');
const btnClearSelection = $('#btn-clear-selection');
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

// ─── Auth Flow ───
btnChooseFolder.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    folderSelected = true;
    folderStatus.textContent = '✓ ' + folder.split('/').pop();
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

syncFolderLabel.addEventListener('click', () => {
  window.api.openSyncFolder();
});

function updateAuthUI() {
  btnSignIn.disabled = !folderSelected;
}

function showAuthScreen() {
  screenAuth.style.display = '';
  screenBrowse.style.display = 'none';
  btnSignOut.style.display = 'none';
}

function showBrowseScreen() {
  screenAuth.style.display = 'none';
  screenBrowse.style.display = 'flex';
  screenBrowse.style.flexDirection = 'column';
  screenBrowse.style.flex = '1';
  btnSignOut.style.display = '';
  loadFiles();
}

// ─── Events from main ───
window.api.onAuthStatus((data) => {
  if (data.authenticated) {
    authenticated = true;
    showBrowseScreen();
  }
});

window.api.onDownloadProgress((data) => {
  fileStatuses.set(data.fileId, data);
  updateFileStatus(data.fileId, data);
});

// ─── File Browsing ───
async function loadFiles(folderId) {
  fileList.innerHTML = '<div class="loading">Loading files...</div>';
  isSearchMode = false;
  btnClearSearch.style.display = 'none';
  searchInput.value = '';

  const result = await window.api.listFiles(folderId || null);
  if (result.error) {
    fileList.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${result.error}</p></div>`;
    return;
  }

  renderFiles(result.files);
}

async function searchFiles(query) {
  if (!query.trim()) return;
  fileList.innerHTML = '<div class="loading">Searching...</div>';
  isSearchMode = true;
  btnClearSearch.style.display = '';

  const result = await window.api.searchFiles(query);
  if (result.error) {
    fileList.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${result.error}</p></div>`;
    return;
  }

  renderFiles(result.files);
}

function renderFiles(files) {
  if (!files || files.length === 0) {
    fileList.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No files found</p></div>';
    fileCount.textContent = '0 items';
    return;
  }

  // Sort: folders first, then by name
  files.sort((a, b) => {
    const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder';
    const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder';
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name);
  });

  fileList.innerHTML = '';
  for (const file of files) {
    const el = createFileElement(file);
    fileList.appendChild(el);
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
    ${isDownloadable ? `<input type="checkbox" class="file-checkbox" ${selectedFiles.has(file.id) ? 'checked' : ''}>` : '<span style="width:18px"></span>'}
    <span class="file-icon">${getFileIcon(file.mimeType)}</span>
    <div class="file-info">
      <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
      <div class="file-meta">${getFileType(file.mimeType)}${file.modifiedTime ? ' · ' + formatDate(file.modifiedTime) : ''}</div>
    </div>
    <span class="file-status ${status?.status === 'done' ? 'success' : status?.status === 'error' ? 'error' : ''}">${getStatusText(status)}</span>
  `;

  // Click handler
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

  // Double-click to instant-download
  if (isDownloadable) {
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      downloadSingle(file);
    });
  }

  return el;
}

function navigateToFolder(folderId, folderName) {
  folderStack.push({ id: folderId, name: folderName });
  updateBreadcrumbs();
  loadFiles(folderId);
}

function navigateBack() {
  if (folderStack.length === 0) return;
  folderStack.pop();
  const current = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  updateBreadcrumbs();
  loadFiles(current?.id);
}

function navigateToCrumb(index) {
  // index -1 = root
  if (index === -1) {
    folderStack = [];
  } else {
    folderStack = folderStack.slice(0, index + 1);
  }
  updateBreadcrumbs();
  const current = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  loadFiles(current?.id);
}

function updateBreadcrumbs() {
  btnBack.disabled = folderStack.length === 0;
  let html = '<span class="crumb" data-index="-1">My Drive</span>';
  for (let i = 0; i < folderStack.length; i++) {
    html += `<span class="crumb-sep">›</span><span class="crumb" data-index="${i}">${escapeHtml(folderStack[i].name)}</span>`;
  }
  breadcrumbs.innerHTML = html;

  // Add click handlers
  breadcrumbs.querySelectorAll('.crumb').forEach((crumb) => {
    crumb.addEventListener('click', () => {
      navigateToCrumb(parseInt(crumb.dataset.index));
    });
  });
}

btnBack.addEventListener('click', navigateBack);

// ─── Search ───
btnSearch.addEventListener('click', () => {
  searchFiles(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchFiles(searchInput.value);
});

btnClearSearch.addEventListener('click', () => {
  const current = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  loadFiles(current?.id);
});

// ─── Selection ───
function toggleSelection(file, checked) {
  if (checked) {
    selectedFiles.set(file.id, file);
  } else {
    selectedFiles.delete(file.id);
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedFiles.size;
  if (count > 0) {
    selectionBar.style.display = '';
    selectionCount.textContent = `${count} file${count !== 1 ? 's' : ''} selected`;
  } else {
    selectionBar.style.display = 'none';
  }
}

btnClearSelection.addEventListener('click', () => {
  selectedFiles.clear();
  updateSelectionUI();
  fileList.querySelectorAll('.file-checkbox').forEach((cb) => {
    cb.checked = false;
    cb.closest('.file-item').classList.remove('selected');
  });
});

// ─── Download ───
btnDownloadSelected.addEventListener('click', async () => {
  if (selectedFiles.size === 0) return;
  const files = Array.from(selectedFiles.values());
  btnDownloadSelected.disabled = true;
  btnDownloadSelected.textContent = 'Downloading...';
  downloadStatus.textContent = `Downloading ${files.length} files...`;

  const result = await window.api.downloadFiles(files);

  btnDownloadSelected.disabled = false;
  btnDownloadSelected.textContent = 'Download as Markdown';

  if (result.error) {
    downloadStatus.textContent = `Error: ${result.error}`;
  } else {
    const success = result.results.filter((r) => r.status === 'success').length;
    const errors = result.results.filter((r) => r.status === 'error').length;
    const skipped = result.results.filter((r) => r.status === 'skipped').length;
    downloadStatus.textContent = `✓ ${success} downloaded${errors ? `, ${errors} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`;
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
    downloadStatus.textContent = r.status === 'success'
      ? `✓ Saved: ${r.name}.md`
      : `✗ ${r.error || r.reason}`;
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
  return [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    'text/plain',
    'text/markdown',
  ].includes(mimeType);
}

function getFileIcon(mimeType) {
  switch (mimeType) {
    case 'application/vnd.google-apps.folder': return '📁';
    case 'application/vnd.google-apps.document': return '📝';
    case 'application/vnd.google-apps.spreadsheet': return '📊';
    case 'application/vnd.google-apps.presentation': return '📽️';
    case 'text/plain': return '📄';
    case 'text/markdown': return '📑';
    case 'application/pdf': return '📕';
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif': return '🖼️';
    default: return '📎';
  }
}

function getFileType(mimeType) {
  switch (mimeType) {
    case 'application/vnd.google-apps.folder': return 'Folder';
    case 'application/vnd.google-apps.document': return 'Google Doc';
    case 'application/vnd.google-apps.spreadsheet': return 'Google Sheet';
    case 'application/vnd.google-apps.presentation': return 'Google Slides';
    case 'text/plain': return 'Text file';
    case 'text/markdown': return 'Markdown';
    case 'application/pdf': return 'PDF';
    default: return mimeType?.split('/').pop() || 'File';
  }
}

function getStatusText(status) {
  if (!status) return '';
  switch (status.status) {
    case 'downloading': return '⏳';
    case 'done': return '✓ saved';
    case 'error': return '✗ error';
    default: return '';
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Boot ───
init();
