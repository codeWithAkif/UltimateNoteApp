import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, Trash2, Plus, ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  loadCfg, saveCfg, loadState, saveState, rowsFromResult, guessMapping, toTasks, parseCurl, notePathFor, applyFilter, type AssignedCfg, type AssignedState,
  type SourceCfg, type SourceResult, type Mapping, type StatusKey, type AssignedTask
} from '../services/assignedTasks';

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panel: React.CSSProperties = {
  width: 'min(780px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px',
  padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0, width: '100%'
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '16px 0 6px' };
const card: React.CSSProperties = { background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' };

const STATUS_KEYS: StatusKey[] = ['backlog', 'inprogress', 'review', 'test', 'park', 'blocked', 'done'];
const STATUS_LABEL: Record<StatusKey, string> = { backlog: 'Backlog', inprogress: 'Devam Ediyor', review: 'İncelemede', test: 'Test', park: 'Park', blocked: 'Bloklu', done: 'Bitti' };

interface Preview { fields: string[]; rows: ReturnType<typeof rowsFromResult>['rows']; mapping: Mapping; tasks: AssignedTask[]; statuses: string[] }

// Şirketin proje yönetim uygulamasından "bana atanan işler"i çekme ayarı. Şifre yalnızca Electron tarafında, işletim sisteminin korumalı deposunda saklanır.
export default function AssignedTasksModal({ onSyncNow, onConfigChanged, onClose }: {
  onSyncNow: () => Promise<AssignedState>;
  onConfigChanged: () => void;
  onClose: () => void;
}) {
  const api = (window as any).electron;
  const [cfg, setCfg] = useState<AssignedCfg>(() => loadCfg());
  const [state, setState] = useState<AssignedState>(() => loadState());
  const [cred, setCred] = useState<{ has: boolean; username: string }>({ has: false, username: '' });
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [credMsg, setCredMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [curlNote, setCurlNote] = useState('');
  const [previews, setPreviews] = useState<Record<number, Preview>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { api?.taskSourceCredentialsStatus?.().then((c: any) => { setCred(c); setUser(c.username || ''); }).catch(() => undefined); }, []);

  const update = (next: AssignedCfg) => { setCfg(next); saveCfg(next); onConfigChanged(); };

  const saveCreds = async () => {
    setCredMsg('');
    const r = await api.taskSourceSaveCredentials({ username: user, password: pass });
    if (!r.ok) { setCredMsg(r.error || 'Kaydedilemedi.'); return; }
    setPass('');
    setCred({ has: true, username: user.trim() });
    setCredMsg('Kaydedildi (şifre bu bilgisayarda şifreli saklanır).');
    const st = { ...loadState(), paused: false, lastCode: undefined, lastError: '' };
    saveState(st); setState(st); onConfigChanged();
  };
  const clearCreds = async () => { await api.taskSourceClearCredentials(); setCred({ has: false, username: '' }); setCredMsg('Kayıtlı e-posta ve şifre silindi.'); };

  // Eklenen metin "curl ..." ise adres, yöntem ve gövde çıkarılır (çerez/yetki başlıkları atılır); değilse düz adres sayılır.
  const addSource = () => {
    const raw = newUrl.trim();
    if (!newName.trim() || !raw) { setMsg('Ekip adı ve adres gerekli.'); return; }
    let src: SourceCfg = { name: newName.trim(), url: raw };
    if (/^curl/i.test(raw)) {
      const c = parseCurl(raw);
      if (!c) { setMsg('cURL okunamadı (adres http(s) olmalı).'); return; }
      src = { name: newName.trim(), url: c.url, method: c.method, body: c.body, contentType: c.contentType };
      setCurlNote(c.dropped.length ? `Güvenlik için şu bilgiler atıldı: ${c.dropped.join(', ')}.` : '');
    }
    update({ ...cfg, sources: [...cfg.sources, src] });
    setNewName(''); setNewUrl(''); setMsg('');
  };

  const runPreview = async () => {
    setBusy('preview'); setMsg('');
    try {
      const res = await api.taskSourceSync({ loginUrl: cfg.loginUrl, allowHttp: cfg.allowHttp, maxPages: 10, sources: cfg.sources.map(s => ({ name: s.name, url: s.url, method: s.method, body: s.body, contentType: s.contentType, cookies: s.cookies, team: s.team })) });
      if (!res.ok) { setMsg(res.error || 'Çekilemedi.'); return; }
      const out: Record<number, Preview> = {};
      // Ekip adıyla bulunan bir kaynak birden çok sonuç döndürebilir: önizlemede tek listede birleşir
      const merged: Record<number, { fields: string[]; rows: ReturnType<typeof rowsFromResult>['rows'] }> = {};
      (res.sources as SourceResult[]).forEach((r, i) => {
        const idx = r.sourceIndex ?? i;
        const { fields, rows } = rowsFromResult(r);
        const m = merged[idx] || (merged[idx] = { fields, rows: [] });
        m.rows = m.rows.concat(rows);
      });
      Object.keys(merged).forEach(k => {
        const i = Number(k); const { fields, rows } = merged[i];
        const mapping = { ...guessMapping(fields), ...(cfg.sources[i]?.mapping || {}) };
        const tasks = toTasks(applyFilter(rows, cfg.sources[i]?.filter), mapping, cfg.sources[i]?.statusMap);
        out[i] = { fields, rows, mapping, tasks, statuses: [...new Set(rows.map(x => (mapping.status ? x[mapping.status] : '')).filter(Boolean))] };
      });
      setPreviews(out);
      if (Object.values(out).every(p => p.rows.length === 0)) setMsg('Bağlantı çalıştı ama hiç kayıt bulunamadı (kaynak adresi doğru mu?).');
    } catch (e: any) { setMsg(String(e?.message || e)); }
    finally { setBusy(''); }
  };

  const setMapping = (i: number, key: keyof Mapping, v: string) => {
    const p = previews[i]; if (!p) return;
    const mapping = { ...p.mapping, [key]: v || undefined };
    const src = cfg.sources[i];
    setPreviews({ ...previews, [i]: { ...p, mapping, tasks: toTasks(applyFilter(p.rows, src?.filter), mapping, src?.statusMap) } });
    update({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, mapping } : s)) });
  };
  const setStatusMap = (i: number, raw: string, v: StatusKey) => {
    const src = cfg.sources[i]; const p = previews[i]; if (!src || !p) return;
    const statusMap = { ...(src.statusMap || {}), [raw.toLocaleLowerCase('tr')]: v };
    update({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, statusMap } : s)) });
    setPreviews({ ...previews, [i]: { ...p, tasks: toTasks(applyFilter(p.rows, src.filter), p.mapping, statusMap) } });
  };
  const setTeam = (i: number, v: string) => { update({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, team: v.trim() || undefined } : s)) }); setPreviews({}); };
  const setCookies = (i: number, v: string) => { update({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, cookies: v.trim() || undefined } : s)) }); };
  const setFilter = (i: number, patch: Partial<{ column: string; contains: string }>) => {
    const src = cfg.sources[i]; const p = previews[i]; if (!src) return;
    const filter = { column: '', contains: '', ...(src.filter || {}), ...patch };
    update({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, filter: filter.column && filter.contains ? filter : undefined } : s)) });
    if (p) setPreviews({ ...previews, [i]: { ...p, tasks: toTasks(applyFilter(p.rows, filter.column && filter.contains ? filter : undefined), p.mapping, src.statusMap) } });
  };

  const syncNow = async () => {
    setBusy('sync'); setMsg('');
    try { setState(await onSyncNow()); } catch (e: any) { setMsg(String(e?.message || e)); }
    finally { setBusy(''); }
  };

  const ago = state.lastSync ? new Date(state.lastSync).toLocaleString('tr-TR') : '—';
  const insecure = /^http:\/\//i.test(cfg.loginUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(cfg.loginUrl);

  return createPortal(
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Atanan işler (şirket uygulaması)</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>Size atanan işler her ekip için bir proje olarak <b>Atananlar</b> klasörüne yazılır. Yalnızca okunur; şirket uygulamasına hiçbir şey yazılmaz.</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 8px' }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={label}>1. Bağlantı</div>
        <input value={cfg.loginUrl} onChange={(e) => update({ ...cfg, loginUrl: e.target.value.trim() })} placeholder="Giriş sayfasının adresi (örn. https://protracker.sirket.com/Account/Login)" style={field} />
        {insecure && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '6px', fontSize: '12px', color: '#f59e0b', cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.allowHttp} onChange={(e) => update({ ...cfg, allowHttp: e.target.checked })} style={{ marginTop: '2px' }} />
            <span>Bu adres güvenli değil (http): şifre şifrelenmeden gider. Şirket iç ağınızda ve VPN'deyken kullanıyorsanız izin verin.</span>
          </label>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="E-posta" autoComplete="off" style={{ ...field, flex: '1 1 200px', width: 'auto' }} />
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cred.has ? 'Şifre kayıtlı (değiştirmek için yazın)' : 'Şifre'} autoComplete="new-password" style={{ ...field, flex: '1 1 200px', width: 'auto' }} />
          <button type="button" style={btn} disabled={!user.trim() || !pass} onClick={saveCreds}><ShieldCheck size={14} /> Kaydet</button>
          {cred.has && <button type="button" style={btn} onClick={clearCreds} title="Kayıtlı e-posta ve şifreyi sil"><Trash2 size={14} /></button>}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '5px' }}>
          {cred.has ? `Kayıtlı: ${cred.username}. ` : ''}Şifre yalnızca bu bilgisayarda, işletim sisteminin korumalı deposunda şifreli saklanır; notlara, koda ve senkronlanan dosyalara yazılmaz, bu pencereye geri gösterilmez.
        </div>
        {credMsg && <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>{credMsg}</div>}

        <div style={label}>2. Kaynaklar (her ekip için bir adres)</div>
        {cfg.sources.length === 0 && <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Henüz kaynak yok. Aşağıdan ekleyin.</div>}
        {cfg.sources.map((s, i) => {
          const p = previews[i];
          return (
            <div key={i} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{s.name} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>→ {notePathFor(s.name)}</span></div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{s.method === 'POST' ? 'POST ' : ''}{s.url}</div>
                  <input
                    value={s.team || ''}
                    onChange={(e) => setTeam(i, e.target.value)}
                    placeholder="Ekip adı (isteğe bağlı): sprint değişse de güncel sprint bulunur. * yazarsanız menüdeki tüm ekipler çekilir"
                    title="Adres ekip menüsü olan bir sayfa olmalı (örn. .../MainTask). Menüde bu adı taşıyan ekibin o anki sprint sayfası otomatik bulunur; notlar ekip adıyla yazılır."
                    style={{ ...field, marginTop: '6px', fontSize: '11.5px' }}
                  />
                  <input
                    value={s.cookies || ''}
                    onChange={(e) => setCookies(i, e.target.value)}
                    placeholder="Görünüm çerezi (isteğe bağlı, örn. taskViewPreference=list)"
                    title="Site liste/board görünümünü çerezle hatırlıyorsa, tablo (liste) görünümünü almak için. Oturum/giriş çerezleri yazılamaz."
                    style={{ ...field, marginTop: '6px', fontSize: '11.5px' }}
                  />
                </div>
                <button type="button" style={{ ...btn, padding: '5px 8px' }} title="Kaynağı kaldır" onClick={() => { update({ ...cfg, sources: cfg.sources.filter((_, k) => k !== i) }); setPreviews({}); }}><Trash2 size={14} /></button>
              </div>
              {p && (
                <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{p.rows.length} kayıt bulundu, {p.tasks.length} iş okunacak. Alanlar doğru eşleşmediyse düzeltin:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {([['id', 'Numara'], ['title', 'Başlık'], ['status', 'Durum'], ['due', 'Bitiş']] as [keyof Mapping, string][]).map(([k, lab]) => (
                      <label key={k} style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 130px' }}>
                        {lab}
                        <select value={p.mapping[k] || ''} onChange={(e) => setMapping(i, k, e.target.value)} style={field}>
                          <option value="">(yok)</option>
                          {p.fields.filter(f => f !== '__href').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    <span>Yalnızca şu kişiye atananlar:</span>
                    <select value={s.filter?.column || ''} onChange={(e) => setFilter(i, { column: e.target.value })} style={{ ...field, width: 'auto', padding: '3px 6px', fontSize: '11.5px' }}>
                      <option value="">(filtre yok)</option>
                      {p.fields.filter(f => f !== '__href').map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input value={s.filter?.contains || ''} onChange={(e) => setFilter(i, { contains: e.target.value })} placeholder="içinde geçen metin (örn. MS)" style={{ ...field, width: '170px', padding: '3px 6px', fontSize: '11.5px' }} />
                  </div>
                  {p.statuses.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      <span>Durumlar →</span>
                      {p.statuses.map(st => {
                        const cur = p.tasks.find(t => t.rawStatus === st)?.status || 'backlog';
                        return (
                          <label key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            {st}
                            <select value={cur} onChange={(e) => setStatusMap(i, st, e.target.value as StatusKey)} style={{ ...field, width: 'auto', padding: '3px 6px', fontSize: '11.5px' }}>
                              {STATUS_KEYS.map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    {p.tasks.slice(0, 6).map(t => (
                      <div key={t.id} style={{ display: 'flex', gap: '8px', padding: '2px 0', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{t.id}</span><span style={{ flex: 1, overflowWrap: 'anywhere' }}>{t.title}</span><span style={{ flexShrink: 0 }}>{STATUS_LABEL[t.status]}{t.due ? ` · ${t.due}` : ''}</span>
                      </div>
                    ))}
                    {p.tasks.length > 6 && <div style={{ color: 'var(--text-muted)' }}>… ve {p.tasks.length - 6} iş daha</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ekip/proje adı (örn. Data Prime - 18)" style={{ ...field, flex: '1 1 180px', width: 'auto' }} />
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder='Adres ya da tarayıcıdan "Copy as cURL" ile kopyalanan komut' style={{ ...field, flex: '2 1 260px', width: 'auto' }} />
          <button type="button" style={btn} onClick={addSource}><Plus size={14} /> Ekle</button>
        </div>
        {curlNote && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>{curlNote}</div>}
        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
          İpucu: Kartlar ekrana arka plandan yükleniyorsa tarayıcıda F12 &gt; Network'te kartları getiren isteğe sağ tıklayıp <b>Copy as cURL</b> ile kopyalayın ve buraya yapıştırın. Çerez ve token bilgileri otomatik atılır, kaydedilmez.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
          <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy || !cfg.loginUrl || cfg.sources.length === 0 || !cred.has} onClick={runPreview}><RefreshCw size={14} /> {busy === 'preview' ? 'Okunuyor…' : 'Önizle'}</button>
        </div>
        {!cred.has && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Önizlemek için önce e-posta ve şifreyi kaydedin.</div>}
        {msg && <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{msg}</div>}

        <div style={label}>3. Otomatik çekme</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ ...cfg, enabled: e.target.checked })} /> Uygulama açıkken otomatik çek
          </label>
          <select value={cfg.intervalMin} onChange={(e) => update({ ...cfg, intervalMin: parseInt(e.target.value, 10) })} style={{ ...field, width: 'auto' }}>
            {[5, 15, 30, 60].map(m => <option key={m} value={m}>{m} dakikada bir</option>)}
          </select>
          <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy || !cred.has} onClick={syncNow}><RefreshCw size={14} /> {busy === 'sync' ? 'Çekiliyor…' : 'Şimdi çek'}</button>
        </div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: state.lastCode === 'ok' || state.lastCode === 'partial' ? 'var(--text-secondary)' : state.lastError ? '#ef4444' : 'var(--text-muted)', overflowWrap: 'anywhere' }}>
          Son çekme: {ago}{state.summary ? ` · ${state.summary}` : ''}{state.lastError ? ` · ${state.lastError}` : ''}
        </div>
        {state.paused && (
          <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '12px', color: '#f59e0b' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>Otomatik çekme durdu: sorun düzeltilene kadar (şifre ya da ayar) tekrar denenmeyecek. Hesabınız kilitlenmesin diye yanlış şifreyle yeniden denenmez.</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button type="button" style={btn} onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
