export interface ElectronAPI {
  getNotesPath: () => Promise<string>;
  listFiles: () => Promise<Array<{
    name: string;
    path: string;
    type: 'note' | 'folder' | 'excalidraw';
    createdAt: number;
    updatedAt: number;
  }>>;
  listMediaFiles: () => Promise<Array<{ path: string; size?: number; updatedAt: number }>>;
  readNote: (relativePath: string) => Promise<string>;
  readMedia: (relativePath: string) => Promise<string>;
  writeNote: (relativePath: string, content: string) => Promise<{ success: boolean }>;
  deletePath: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  createFolder: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  renamePath: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
  getSyncStatus: () => Promise<'synced' | 'syncing' | 'offline' | 'error'>;
  getLastSyncError: () => Promise<string | null>;
  saveGitCreds: (creds: { url: string; username: string; token: string; branch: string }) => Promise<{ success: boolean; error?: string }>;
  onSyncStatusChanged: (callback: (status: 'synced' | 'syncing' | 'offline' | 'error') => void) => () => void;
  searchOnlineMusic: (query: string) => Promise<any[]>;
  fetchIcs?: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  taskSourceSaveCredentials?: (creds: { username: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  taskSourceCredentialsStatus?: () => Promise<{ has: boolean; username: string }>;
  taskSourceClearCredentials?: () => Promise<{ ok: boolean }>;
  taskSourceSync?: (cfg: any) => Promise<{ ok: boolean; code?: string; error?: string; sources?: any[] }>;
  claudeAgentPlan?: (req: { runId: string; dir: string; prompt: string; attachments?: string[]; model?: string; timeoutMs?: number }) => Promise<{ ok: boolean; text?: string; error?: string; cancelled?: boolean; ms: number; cost?: number; turns?: number }>;
  claudeAgentApply?: (req: { runId: string; dir: string; prompt: string; title: string; attachments?: string[]; shots?: string[]; model?: string; timeoutMs?: number; reuse?: { worktree: string; branch: string } }) => Promise<{
    ok: boolean; text?: string; error?: string; cancelled?: boolean; ms: number; cost?: number; turns?: number;
    changed?: boolean; partial?: boolean; dirtyBase?: boolean; branch?: string; worktree?: string; base?: string; stat?: string; files?: { status: string; path: string }[];
  }>;
  claudeAgentDiscard?: (req: { dir: string; worktree: string; branch: string }) => Promise<{ ok: boolean; error?: string }>;
  claudeAgentOpenFolder?: (req: { dir: string; worktree: string }) => Promise<{ ok: boolean; error?: string }>;
  claudeAgentCancel?: (runId: string) => Promise<{ ok: boolean }>;
  devStatus?: (req: { dir: string }) => Promise<any>;
  devCheck?: (req: { dir: string; worktree: string; branch: string }) => Promise<any>;
  devDiff?: (req: { dir: string; worktree: string; branch: string; file?: string }) => Promise<any>;
  devMerge?: (req: { dir: string; worktree: string; branch: string }) => Promise<any>;
  devReleasePlan?: (req: { dir: string }) => Promise<any>;
  devReleaseDo?: (req: { dir: string; version: string; summary?: string }) => Promise<any>;
  devCi?: (req: { dir: string; tag: string }) => Promise<any>;
  devPreviewStart?: (req: { dir: string; worktree: string; branch: string }) => Promise<{ ok: boolean; url?: string; port?: number; error?: string }>;
  devPreviewStop?: () => Promise<{ ok: boolean; stopped?: boolean }>;
  devPreviewShot?: (webContentsId: number) => Promise<{ ok: boolean; path?: string; thumb?: string; error?: string }>;
  devStoreGet?: () => Promise<any>;
  devStoreSet?: (data: any) => Promise<{ ok: boolean; error?: string }>;
  onDevProgress?: (cb: (d: { text: string }) => void) => () => void;
  onClaudeAgentProgress?: (callback: (data: { runId?: string; text: string }) => void) => () => void;
  pickProjectFolder?: () => Promise<{ canceled: boolean; info?: { ok: boolean; path?: string; name?: string; isGit?: boolean; branch?: string; error?: string; warning?: string } }>;
  inspectProjectFolder?: (dir: string) => Promise<{ ok: boolean; path?: string; name?: string; isGit?: boolean; branch?: string; error?: string; warning?: string }>;
  claudeCliRun?: (req: { prompt: string; schema?: any; model?: string; timeoutMs?: number }) => Promise<{ ok: boolean; structured?: any; text?: string; error?: string; ms: number }>;
  marketNearest?: (req: { latitude: number; longitude: number; distance: number }) => Promise<{ ok: boolean; data?: any; error?: string }>;
  marketSearch?: (req: { keywords: string; latitude: number; longitude: number; distance: number; depots: string[]; size?: number; pages?: number }) => Promise<{ ok: boolean; data?: any; error?: string }>;
  claudeCliStatus?: () => Promise<{ available: boolean; version?: string; loggedIn?: boolean; authMethod?: string; error?: string }>;
  resolveArchiveTrack: (identifier: string) => Promise<string>;
  resolveYoutubePlaylist: (playlistId: string) => Promise<any[]>;
  fileExists: (relativePath: string) => Promise<boolean>;
  toggleMiniMode: (isMini: boolean) => Promise<{ success: boolean }>;
  setTitleBarTheme: (theme: 'dark' | 'light') => Promise<{ success: boolean }>;
  getAppVersion: () => Promise<string>;
  restartAndInstall: (opts?: { silent?: boolean }) => Promise<{ success: boolean }>;
  checkForUpdates: () => Promise<{ success: boolean; error?: string }>;
  onWebResearch?: (callback: (text: string) => void) => () => void;
  azureSpeechSave?: (cfg: { key: string; region: string; voice?: string }) => Promise<{ ok: boolean; error?: string }>;
  azureSpeechStatus?: () => Promise<{ has: boolean; region: string; voice: string }>;
  azureSpeechClear?: () => Promise<{ ok: boolean }>;
  azureSpeechSpeak?: (text: string) => Promise<{ ok: boolean; base64?: string; mime?: string; error?: string }>;
  transcriptScan?: (folder?: string) => Promise<{ success: boolean; folder?: string; error?: string; files: { path: string; name: string; mtimeMs: number; size: number }[] }>;
  transcriptRead?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  transcriptPickFolder?: () => Promise<string | null>;
  perfProfilerStart?: () => Promise<{ success: boolean; error?: string }>;
  perfProfilerStop?: () => Promise<{ success: boolean; error?: string; totalMs?: number; idleMs?: number; self?: { name: string; ms: number }[]; incl?: { name: string; ms: number }[] }>;
  onUpdateStatus: (callback: (data: { status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'; version?: string; percent?: number; text?: string }) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string;
        preload?: string;
        nodeintegration?: string;
        useragent?: string;
        allowpopups?: boolean;
        webpreferences?: string;
        style?: React.CSSProperties;
      }, HTMLElement>;
    }
  }
}
