const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getNotesPath: () => ipcRenderer.invoke('get-notes-path'),
  listFiles: () => ipcRenderer.invoke('list-files'),
  listMediaFiles: () => ipcRenderer.invoke('list-media-files'),
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
  fetchIcs: (url) => ipcRenderer.invoke('fetch-ics', url),
  azureSpeechSave: (cfg) => ipcRenderer.invoke('azure-speech-save', cfg),
  azureSpeechStatus: () => ipcRenderer.invoke('azure-speech-status'),
  azureSpeechClear: () => ipcRenderer.invoke('azure-speech-clear'),
  azureSpeechSpeak: (text) => ipcRenderer.invoke('azure-speech-speak', text),
  taskSourceSaveCredentials: (creds) => ipcRenderer.invoke('task-source-save-credentials', creds),
  taskSourceCredentialsStatus: () => ipcRenderer.invoke('task-source-credentials-status'),
  taskSourceClearCredentials: () => ipcRenderer.invoke('task-source-clear-credentials'),
  taskSourceSync: (cfg) => ipcRenderer.invoke('task-source-sync', cfg),
  claudeAgentPlan: (req) => ipcRenderer.invoke('claude-agent-plan', req),
  claudeAgentApply: (req) => ipcRenderer.invoke('claude-agent-apply', req),
  claudeAgentDiscard: (req) => ipcRenderer.invoke('claude-agent-discard', req),
  claudeAgentOpenFolder: (req) => ipcRenderer.invoke('claude-agent-open-folder', req),
  claudeAgentCancel: (runId) => ipcRenderer.invoke('claude-agent-cancel', runId),
  devStatus: (req) => ipcRenderer.invoke('dev-status', req),
  devCheck: (req) => ipcRenderer.invoke('dev-check', req),
  devDiff: (req) => ipcRenderer.invoke('dev-diff', req),
  devMerge: (req) => ipcRenderer.invoke('dev-merge', req),
  devReleasePlan: (req) => ipcRenderer.invoke('dev-release-plan', req),
  devReleaseDo: (req) => ipcRenderer.invoke('dev-release-do', req),
  devCi: (req) => ipcRenderer.invoke('dev-ci', req),
  devPreviewStart: (req) => ipcRenderer.invoke('dev-preview-start', req),
  devPreviewStop: () => ipcRenderer.invoke('dev-preview-stop'),
  devPreviewShot: (wcId) => ipcRenderer.invoke('dev-preview-shot', wcId),
  devStoreGet: () => ipcRenderer.invoke('dev-store-get'),
  devStoreSet: (data) => ipcRenderer.invoke('dev-store-set', data),
  onDevProgress: (cb) => {
    const sub = (_e, d) => cb(d);
    ipcRenderer.on('dev-progress', sub);
    return () => ipcRenderer.removeListener('dev-progress', sub);
  },
  onClaudeAgentProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('claude-agent-progress', subscription);
    return () => ipcRenderer.removeListener('claude-agent-progress', subscription);
  },
  pickProjectFolder: () => ipcRenderer.invoke('pick-project-folder'),
  inspectProjectFolder: (dir) => ipcRenderer.invoke('inspect-project-folder', dir),
  claudeCliRun: (req) => ipcRenderer.invoke('claude-cli-run', req),
  claudeCliStatus: () => ipcRenderer.invoke('claude-cli-status'),
  marketNearest: (req) => ipcRenderer.invoke('market-nearest', req),
  marketSearch: (req) => ipcRenderer.invoke('market-search', req),
  resolveArchiveTrack: (identifier) => ipcRenderer.invoke('resolve-archive-track', identifier),
  resolveYoutubePlaylist: (playlistId) => ipcRenderer.invoke('resolve-youtube-playlist', playlistId),
  fileExists: (relativePath) => ipcRenderer.invoke('file-exists', relativePath),
  toggleMiniMode: (isMini) => ipcRenderer.invoke('toggle-mini-mode', { isMini }),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('set-titlebar-theme', theme),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  restartAndInstall: (opts) => ipcRenderer.invoke('restart-and-install', opts),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  perfProfilerStart: () => ipcRenderer.invoke('perf-profiler-start'),
  perfProfilerStop: () => ipcRenderer.invoke('perf-profiler-stop'),
  transcriptScan: (folder) => ipcRenderer.invoke('transcript-scan', folder),
  transcriptRead: (filePath) => ipcRenderer.invoke('transcript-read', filePath),
  transcriptPickFolder: () => ipcRenderer.invoke('transcript-pick-folder'),
  focusAndFlashWindow: () => ipcRenderer.invoke('focus-and-flash-window'),
  googleSetCredentials: (clientId, clientSecret) => ipcRenderer.invoke('google-set-credentials', { clientId, clientSecret }),
  googleAuthStatus: () => ipcRenderer.invoke('google-auth-status'),
  googleAuthStart: () => ipcRenderer.invoke('google-auth-start'),
  googleDisconnect: () => ipcRenderer.invoke('google-disconnect'),
  googleCalendarPushEvent: (payload) => ipcRenderer.invoke('google-calendar-push-event', payload),
  googleCalendarDeleteEvent: (eventId) => ipcRenderer.invoke('google-calendar-delete-event', { eventId }),
  onWebResearch: (callback) => {
    const subscription = (event, text) => callback(text);
    ipcRenderer.on('web-research', subscription);
    return () => ipcRenderer.removeListener('web-research', subscription);
  },
  onSyncStatusChanged: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('sync-status-changed', subscription);
    return () => ipcRenderer.removeListener('sync-status-changed', subscription);
  },
  onUpdateStatus: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('update-status', subscription);
    return () => ipcRenderer.removeListener('update-status', subscription);
  }
});
