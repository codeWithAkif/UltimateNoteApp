const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getNotesPath: () => ipcRenderer.invoke('get-notes-path'),
  listFiles: () => ipcRenderer.invoke('list-files'),
  readNote: (relativePath) => ipcRenderer.invoke('read-note', relativePath),
  readMedia: (relativePath) => ipcRenderer.invoke('read-media', relativePath),
  writeNote: (relativePath, content) => ipcRenderer.invoke('write-note', { relativePath, content }),
  deletePath: (relativePath) => ipcRenderer.invoke('delete-path', relativePath),
  createFolder: (relativePath) => ipcRenderer.invoke('create-folder', relativePath),
  renamePath: (oldPath, newPath) => ipcRenderer.invoke('rename-path', { oldPath, newPath }),
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
  getLastSyncError: () => ipcRenderer.invoke('get-last-sync-error'),
  saveGitCreds: (creds) => ipcRenderer.invoke('save-git-creds', creds),
  searchOnlineMusic: (query) => ipcRenderer.invoke('search-online-music', query),
  resolveArchiveTrack: (identifier) => ipcRenderer.invoke('resolve-archive-track', identifier),
  resolveYoutubePlaylist: (playlistId) => ipcRenderer.invoke('resolve-youtube-playlist', playlistId),
  fileExists: (relativePath) => ipcRenderer.invoke('file-exists', relativePath),
  toggleMiniMode: (isMini) => ipcRenderer.invoke('toggle-mini-mode', { isMini }),
  onSyncStatusChanged: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('sync-status-changed', subscription);
    return () => ipcRenderer.removeListener('sync-status-changed', subscription);
  }
});
