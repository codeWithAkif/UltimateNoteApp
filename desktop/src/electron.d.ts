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
  resolveArchiveTrack: (identifier: string) => Promise<string>;
  resolveYoutubePlaylist: (playlistId: string) => Promise<any[]>;
  fileExists: (relativePath: string) => Promise<boolean>;
  toggleMiniMode: (isMini: boolean) => Promise<{ success: boolean }>;
  setTitleBarTheme: (theme: 'dark' | 'light') => Promise<{ success: boolean }>;
  getAppVersion: () => Promise<string>;
  restartAndInstall: () => Promise<{ success: boolean }>;
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
