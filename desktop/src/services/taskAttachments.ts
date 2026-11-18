// Görev ekleri (ekran görüntüsü, resim, belge): dosyalar notlar kasasında "Ekler/<proje>/<görev>/" altında durur, görev satırının ALTINA
// girintili bir madde olarak bağlanır. Böylece görev satırı kısa kalır (panoda yeni kart oluşturmaz), ek notla birlikte senkronlanır ve Claude
// görevi başlattığında bu dosyaları okuyabilir.
//
//   - [ ] Giriş ekranındaki hatayı düzelt [project:pscope]
//       - ek: [hata.png](Ekler/pscope/k3x9a1/lq2f-hata.png)
//
// Saf işlevler (disk/ağ yok); yazma/okuma çağıran tarafta platform ile yapılır.

export interface Attachment { name: string; path: string; line: number }

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ROOT = 'Ekler';

// Çalıştırılabilir/komut dosyaları saklanmaz (kasa senkronlanır, Claude'a da verilebilir).
export const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|ps1|psm1|vbs|vbe|js|jse|wsf|scr|lnk|dll|sh|jar|app|dmg|apk)$/i;
export const isImagePath = (p: string): boolean => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);

const ATT_RE = /^(\s*)[-*]\s+ek:\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const TASK_RE = /^(\s*)[-*]\s+\[[ xX/]\]/;
const indentOf = (l: string): number => (l.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;

export const isAttachmentLine = (line: string): boolean => ATT_RE.test(line);

// 'task::<yol>::<satır>' kimliğinden not yolu ve satır numarası.
export const parseTaskId = (id: string): { path: string; idx: number } | null => {
  if (!id.startsWith('task::')) return null;
  const parts = id.split('::');
  const idx = parseInt(parts[parts.length - 1], 10);
  const path = parts.slice(1, -1).join('::');
  return path && Number.isInteger(idx) && idx >= 0 ? { path, idx } : null;
};

// Görev satırının hemen altındaki (daha derin girintili) ek maddeleri.
export const parseAttachments = (lines: string[], taskIdx: number): Attachment[] => {
  const out: Attachment[] = [];
  if (taskIdx < 0 || taskIdx >= lines.length) return out;
  const base = indentOf(lines[taskIdx]);
  for (let j = taskIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || indentOf(l) <= base) break;
    const m = l.match(ATT_RE);
    if (m) out.push({ name: m[2], path: m[3], line: j });
  }
  return out;
};

// Satır gerçekten bir görev satırı mı ve beklenen göreve mi ait (satır numarası kaymış olabilir)?
export const taskLineMatches = (line: string | undefined, content: string): boolean => {
  if (!line || !TASK_RE.test(line)) return false;
  const frag = content.replace(/\s+/g, ' ').trim().slice(0, 14);
  return frag === '' || line.replace(/\s+/g, ' ').includes(frag);
};

export const attachmentLine = (taskLine: string, name: string, path: string): string =>
  `${' '.repeat(indentOf(taskLine) + 4)}- ek: [${name.replace(/[\[\]]/g, '')}](${path})`;

// Yeni ekleri mevcut eklerin sonuna (yoksa görev satırının hemen altına) ekler.
export const insertAttachmentLines = (lines: string[], taskIdx: number, entries: { name: string; path: string }[]): string[] => {
  const existing = parseAttachments(lines, taskIdx);
  const at = existing.length ? existing[existing.length - 1].line + 1 : taskIdx + 1;
  const add = entries.map(e => attachmentLine(lines[taskIdx], e.name, e.path));
  return [...lines.slice(0, at), ...add, ...lines.slice(at)];
};

export const removeAttachmentLine = (lines: string[], taskIdx: number, path: string): string[] => {
  const hit = parseAttachments(lines, taskIdx).find(a => a.path === path);
  return hit ? [...lines.slice(0, hit.line), ...lines.slice(hit.line + 1)] : lines;
};

// ---------------- adlandırma ----------------
const slug = (s: string) => s.toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'proje';

// Dosya adı: yol ayırıcıları, boşluk ve markdown'u bozan karakterler temizlenir; uzantı korunur.
export const safeFileName = (name: string): string => {
  const base = name.split(/[\\/]/).pop() || 'dosya';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 10) : '';
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[\s]+/g, '_').replace(/[^\p{L}\p{N}._-]/gu, '').replace(/^[._-]+/, '').slice(0, 60) || 'dosya';
  return stem + ext;
};

export const validateFile = (name: string, size: number): string | null => {
  if (BLOCKED_EXT.test(name)) return `"${name}" çalıştırılabilir/komut dosyası olduğu için eklenemez.`;
  if (size > MAX_ATTACHMENT_BYTES) return `"${name}" ${(size / 1048576).toFixed(1)} MB; en çok ${MAX_ATTACHMENT_BYTES / 1048576} MB eklenebilir.`;
  if (size <= 0) return `"${name}" boş.`;
  return null;
};

// Görevin ek klasörü: görevin zaten eki varsa onun klasörü, yoksa yenisi.
export const attachmentFolder = (project: string, existing: Attachment[], now: number = Date.now()): string => {
  if (existing.length) {
    const p = existing[0].path;
    const i = p.lastIndexOf('/');
    if (i > 0 && p.startsWith(ATTACHMENT_ROOT + '/')) return p.slice(0, i);
  }
  return `${ATTACHMENT_ROOT}/${slug(project)}/${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
};

export const attachmentPath = (folder: string, fileName: string, now: number = Date.now()): string =>
  `${folder}/${now.toString(36)}-${safeFileName(fileName)}`;

// Yalnızca kendi ek klasörümüzün altındaki yollar silinebilir (satır elle bozulsa bile başka dosya silinmesin).
export const isManagedAttachmentPath = (p: string): boolean =>
  p.startsWith(ATTACHMENT_ROOT + '/') && !p.split('/').some(s => s === '..' || s === '') && p.split('/').length >= 4;

export const formatSize = (bytes: number): string => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
