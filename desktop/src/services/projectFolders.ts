// Proje -> kod klasörü eşlemesi (Claude'un bir görevde çalışacağı yer). Yol BU BİLGİSAYARA özeldir: notlara yazılmaz, senkronlanmaz
// (başka cihazda aynı klasör farklı yerde olur). Seçim her zaman klasör penceresiyle yapılır; güvenlik denetimi electron/projectFolder.cjs'te.

const KEY = 'project_folders_v1';
const norm = (project: string) => project.trim().toLocaleLowerCase('tr');

export interface FolderInfo { ok: boolean; path?: string; name?: string; isGit?: boolean; branch?: string; error?: string; warning?: string }

export const isProjectFolderSupported = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).electron?.pickProjectFolder;

const load = (): Record<string, string> => {
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};

export const getProjectFolder = (project: string): string | null => load()[norm(project)] || null;
export const setProjectFolder = (project: string, dir: string) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [norm(project)]: dir })); } catch { /* yoksay */ }
};
export const clearProjectFolder = (project: string) => {
  try { const m = load(); delete m[norm(project)]; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* yoksay */ }
};

export const pickProjectFolder = async (): Promise<{ canceled: boolean; info?: FolderInfo }> => {
  if (!isProjectFolderSupported()) return { canceled: true };
  return (window as any).electron.pickProjectFolder();
};
export const inspectProjectFolder = async (dir: string): Promise<FolderInfo> => {
  if (!isProjectFolderSupported()) return { ok: false, error: 'Yalnızca masaüstü uygulamasında kullanılabilir.' };
  return (window as any).electron.inspectProjectFolder(dir);
};
