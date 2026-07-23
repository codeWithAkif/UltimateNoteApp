const { app, BrowserWindow, ipcMain, protocol, net, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-media', privileges: { standard: true, secure: true, bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let mainWindow;
let originalBounds = null;

const DEFAULT_NOTES_DIR = path.join(app.getPath('documents'), 'UltimateNotes');
if (!fs.existsSync(DEFAULT_NOTES_DIR)) {
  fs.mkdirSync(DEFAULT_NOTES_DIR, { recursive: true });
}

// Güvenlik (Kural): Renderer'dan gelen tüm göreli yolları DEFAULT_NOTES_DIR
// kökü içinde tutar. "../" gibi kalıplarla notes klasörünün dışına çıkmayı
// (path traversal) engeller. Kök dışına çıkan her yol için hata fırlatır.
function resolveSafePath(relativePath) {
  if (typeof relativePath !== 'string') {
    throw new Error('Invalid path');
  }
  const fullPath = path.resolve(DEFAULT_NOTES_DIR, relativePath);
  const rel = path.relative(DEFAULT_NOTES_DIR, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return fullPath;
}

function logDebug(msg) {
  try {
    const logPath = path.join(DEFAULT_NOTES_DIR, 'media_debug.txt');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch (e) {
    console.error('Failed to write debug log:', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, // Security best practice
      contextIsolation: true, // Security best practice
      webviewTag: true, // Enable webview tag
      webSecurity: false // Allow loading local files and custom protocols without CORS blocks
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    backgroundColor: '#121214',
    titleBarStyle: 'hidden', // Modern titlebar
    titleBarOverlay: {
      color: '#121214',
      symbolColor: '#e1e1e6',
      height: 35
    }
  });

  // Check if we are running in dev mode (Vite dev server must be explicitly set)
  const isDev = process.env.VITE_DEV_SERVER === '1';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (!isDev) {
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch((err) => {
          console.error('[AutoUpdater Error]:', err);
        });
      }, 1500);
    }
  });

  // Forward frontend console messages to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Frontend Console] [Level ${level}]: ${message} (Source: ${sourceId}:${line})`);
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Electron, normal bir tarayıcı sekmesinin aksine, düz metin (div/span) üzerinde
  // sağ tıklandığında OTOMATİK bir "Kopyala" menüsü GÖSTERMEZ — bu yalnızca gerçek
  // <input>/<textarea> alanları için Chromium tarafından sağlanır. Uygulamanın eski
  // özel sağ tık menüsü kaldırıldığında bu yüzden hem düzenleme hem önizleme
  // modunda hiçbir menü çıkmaz hale geldi. Burada native, OS tarzı bir sağ tık
  // menüsü kuruyoruz (Kes/Kopyala/Yapıştır/Tümünü Seç), bağlama göre (seçili metin
  // var mı, düzenlenebilir bir alanda mıyız) doğru öğeleri gösterir.
  mainWindow.webContents.on('context-menu', (event, params) => {
    const hasSelection = !!params.selectionText && params.selectionText.trim().length > 0;
    const template = [];

    if (params.isEditable) {
      template.push(
        { label: 'Kes', role: 'cut', enabled: hasSelection },
        { label: 'Kopyala', role: 'copy', enabled: hasSelection },
        { label: 'Yapıştır', role: 'paste' },
        { type: 'separator' },
        { label: 'Tümünü Seç', role: 'selectAll' }
      );
    } else if (hasSelection) {
      template.push(
        { label: 'Kopyala', role: 'copy' }
      );
    }

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  // Open external links in default browser instead of new Electron windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Renderer süreci (uygulama içeriğini çizen alt süreç) bellek yetersizliği
  // veya başka bir nedenle çökerse, pencere çerçevesi (işletim sistemi
  // tarafından çizildiği için) ayakta kalır ama içerik beyaz/boş kalır ve
  // hiçbir işleve yanıt vermez — kullanıcı yalnızca kapatma düğmesini
  // kullanabilir. Bu olayı yakalayıp pencereyi otomatik olarak yeniden
  // yüklüyoruz ki uygulama kalıcı olarak beyaz ekranda takılı kalmasın.
  // Neden (details.reason: 'oom', 'crashed', 'killed' vb.) loglanır, böylece
  // tekrar olursa kök neden teşhis edilebilir.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process gone:', details.reason, details);
    logDebug(`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.on('unresponsive', () => {
    console.error('[Main] Window became unresponsive.');
    logDebug('Window became unresponsive.');
  });

  mainWindow.on('responsive', () => {
    console.log('[Main] Window became responsive again.');
  });
}

const getAudioMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  
  // Try to check magic bytes for local files to handle mismatching extensions (e.g. downloaded as .mp3 but actually ogg/webm)
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(12);
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      // EBML / WebM
      if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return 'audio/webm';
      }
      // OggS / OGG
      if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
        return 'audio/ogg';
      }
      // fLaC / FLAC
      if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
        return 'audio/flac';
      }
      // RIFF / WAV
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        return 'audio/wav';
      }
      // ID3 (MP3)
      if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
        return 'audio/mpeg';
      }
      // MPEG ADTS Frame Sync (MP3 without ID3 tag)
      if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
        return 'audio/mpeg';
      }
      // ftyp (M4A/MP4)
      if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        return 'audio/mp4';
      }
    }
  } catch (e) {
    console.error('Error reading magic bytes:', e);
  }

  // Fallback to extension check
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp3': return 'audio/mpeg';
    case '.m4a':
    case '.mp4': return 'audio/mp4';
    case '.wav': return 'audio/wav';
    case '.webm': return 'audio/webm';
    case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.opus': return 'audio/opus';
    case '.aac': return 'audio/aac';
    default: return 'application/octet-stream';
  }
};

app.whenReady().then(() => {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  Menu.setApplicationMenu(null);
  protocol.handle('app-media', (request) => {
    try {
      logDebug(`Request URL: ${request.url}`);
      const urlPath = decodeURIComponent(request.url.replace('app-media://', ''));
      let filePath;
      try {
        filePath = resolveSafePath(urlPath);
      } catch (secErr) {
        logDebug(`Blocked media request (traversal): ${urlPath}`);
        return new Response('Forbidden', { status: 403 });
      }
      logDebug(`Resolved path: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        logDebug(`File NOT found: ${filePath}`);
        return new Response('Not Found', { status: 404 });
      }

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // app-media protokolünde dosyanın boyutunu (Content-Length) okumak için eksik olan stats tanımı yapılmıştır.
      const stats = fs.statSync(filePath);
      const mimeType = getAudioMimeType(filePath);

      logDebug(`File found. Size: ${stats.size} bytes, MimeType: ${mimeType}`);

      const nodeStream = fs.createReadStream(filePath);
      const webStream = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk) => {
            controller.enqueue(chunk);
          });
          nodeStream.on('end', () => {
            logDebug(`Stream read finished successfully for: ${urlPath}`);
            controller.close();
          });
          nodeStream.on('error', (err) => {
            logDebug(`Stream error: ${err.message}`);
            controller.error(err);
          });
        },
        cancel() {
          logDebug(`Stream cancelled for: ${urlPath}`);
          nodeStream.destroy();
        }
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Length': stats.size.toString(),
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*'
        }
      });
    } catch (error) {
      logDebug(`Protocol handler error: ${error.message}\n${error.stack}`);
      console.error('Error handling media protocol request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  // Fix for YouTube Embed "Error 153" and "Error 152" on file:// protocol
  const { session } = require('electron');
  
  // Güvenlik (Kural): Yalnızca gerçekten ihtiyaç duyulan medya/mikrofon izinleri
  // verilir. Gömülü webview/iframe içindeki siteler kamera, konum, bildirim vb.
  // hassas izinleri otomatik alamaz; diğer tüm istekler reddedilir.
  const ALLOWED_PERMISSIONS = new Set(['media', 'microphone', 'audioCapture']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  session.defaultSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      const url = details.url;
      if (url.includes('youtube-nocookie.com')) {
        details.requestHeaders['Referer'] = 'https://www.youtube-nocookie.com/';
        details.requestHeaders['Origin'] = 'https://www.youtube-nocookie.com';
      } else {
        details.requestHeaders['Referer'] = 'https://www.youtube.com/';
        details.requestHeaders['Origin'] = 'https://www.youtube.com';
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Directory and Markdown operations IPC handlers

ipcMain.handle('get-notes-path', () => {
  return DEFAULT_NOTES_DIR;
});

// IPC Handler: List all files recursively
ipcMain.handle('list-files', async () => {
  try {
    const listAllFiles = (dir, fileList = []) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // BUG DÜZELTMESİ: Önceden "." ile başlayan HER ŞEY (dosya/klasör) atlanıyordu.
        // Bu, uygulamanın kendi varsayılan şablon klasörünü (".templates") de görünmez
        // yapıyordu — App.tsx'teki "şablon klasörü boşsa varsayılan RFC şablonunu oluştur"
        // efekti dosyayı hiç göremediği için onu SONSUZA KADAR yeniden oluşturup diske
        // yazıyor, bu da her seferinde Supabase'e yükleme tetikleyip "Eşitleniyor..."
        // durumunun sürekli yanıp sönmesine ve arka planda bitmeyen CPU/disk/ağ
        // trafiğine (ve uzun vadede performans sorunlarına) yol açıyordu. Yalnızca
        // gerçek sistem klasörü olan ".git" gizlenir; diğer nokta ile başlayan
        // klasörler (".templates" gibi) uygulamanın kendi kullanımı için meşrudur.
        if (file === '.git') {
          return;
        }
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const relativePath = path.relative(DEFAULT_NOTES_DIR, filePath).replace(/\\/g, '/');
        
        if (stat.isDirectory()) {
          fileList.push({
            name: file,
            path: relativePath,
            type: 'folder',
            createdAt: stat.birthtimeMs,
            updatedAt: stat.mtimeMs
          });
          listAllFiles(filePath, fileList);
        } else if (file.endsWith('.md') || file.endsWith('.excalidraw') || file.endsWith('.drawio')) {
          // .drawio: draw.io (diagrams.net) diyagram dosyaları da not listesine dahil edilir.
          const isExcalidraw = file.endsWith('.excalidraw');
          const isDrawio = file.endsWith('.drawio');
          fileList.push({
            name: file.replace(/\.(md|excalidraw|drawio)$/, ''),
            path: relativePath,
            type: isExcalidraw ? 'excalidraw' : (isDrawio ? 'drawio' : 'note'),
            createdAt: stat.birthtimeMs,
            updatedAt: stat.mtimeMs
          });
        }
      });
      return fileList;
    };
    return listAllFiles(DEFAULT_NOTES_DIR);
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
});

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// MEDYA SENKRONİZASYONU: notlara eklenen resim/ses dosyaları önceden Supabase'e hiç
// yüklenmiyordu (yalnızca .md/.excalidraw/.drawio senkronize ediliyordu) — bir cihazda
// eklenen medya diğer cihazda bozuk link olarak kalıyordu. Bu handler, bilinen medya
// uzantılarına sahip dosyaları (list-files'ın aksine .md/.excalidraw/.drawio HARİÇ)
// listeler; supabaseSync.ts bunları Supabase Storage'a yükler/indirir.
const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp3', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.opus', '.aac', '.mp4'
]);

ipcMain.handle('list-media-files', async () => {
  try {
    const listAllMedia = (dir, fileList = []) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        if (file === '.git') return;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          listAllMedia(filePath, fileList);
          return;
        }
        const ext = path.extname(file).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(ext)) return;
        const relativePath = path.relative(DEFAULT_NOTES_DIR, filePath).replace(/\\/g, '/');
        fileList.push({
          path: relativePath,
          size: stat.size,
          updatedAt: stat.mtimeMs
        });
      });
      return fileList;
    };
    return listAllMedia(DEFAULT_NOTES_DIR);
  } catch (error) {
    console.error('Error listing media files:', error);
    return [];
  }
});

// IPC Handler: Resolve YouTube Playlist items via RSS Feed
ipcMain.handle('resolve-youtube-playlist', async (event, playlistId) => {
  return new Promise((resolve) => {
    const https = require('https');
    const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const entries = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = entryRegex.exec(data)) !== null) {
          const entryContent = match[1];
          const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/);
          const ytVideoIdMatch = entryContent.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
          if (titleMatch && ytVideoIdMatch) {
            let title = titleMatch[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
            entries.push({
              title,
              videoId: ytVideoIdMatch[1]
            });
          }
        }
        resolve(entries);
      });
    }).on('error', (err) => {
      console.error('[Electron YouTube Resolving Error]:', err.message);
      resolve([]);
    });
  });
});

// IPC Handler: Read file content
ipcMain.handle('read-note', async (event, relativePath) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fs.readFileSync(fullPath, 'utf-8');
    }
    return '';
  } catch (error) {
    console.error('Error reading note:', error);
    throw error;
  }
});

// IPC Handler: Read media as base64 Data URL
ipcMain.handle('read-media', async (event, relativePath) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const mimeType = getAudioMimeType(fullPath);
      
      const buffer = fs.readFileSync(fullPath);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    return '';
  } catch (error) {
    console.error('Error reading media:', error);
    throw error;
  }
});


ipcMain.handle('file-exists', async (event, relativePath) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch (error) {
    return false;
  }
});

// IPC Handler: Write file content
ipcMain.handle('write-note', async (event, { relativePath, content }) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    const parentDir = path.dirname(fullPath);
    
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
      const parts = content.split(';base64,');
      const base64Data = parts[1];
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(fullPath, buffer);
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
    return { success: true };
  } catch (error) {
    console.error('Error writing note:', error);
    throw error;
  }
});

// IPC Handler: Delete file/folder
ipcMain.handle('delete-path', async (event, relativePath) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      return { success: true };
    }
    return { success: false, error: 'Path does not exist' };
  } catch (error) {
    console.error('Error deleting path:', error);
    throw error;
  }
});

// IPC Handler: Create Folder
ipcMain.handle('create-folder', async (event, relativePath) => {
  try {
    const fullPath = resolveSafePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      return { success: true };
    }
    return { success: false, error: 'Folder already exists' };
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
});

// IPC Handler: Rename / Move path (file or folder)
ipcMain.handle('rename-path', async (event, { oldPath, newPath }) => {
  try {
    const fullOldPath = resolveSafePath(oldPath);
    const fullNewPath = resolveSafePath(newPath);
    const parentDir = path.dirname(fullNewPath);
    
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    if (fs.existsSync(fullOldPath)) {
      fs.renameSync(fullOldPath, fullNewPath);
      return { success: true };
    }
    return { success: false, error: 'Source path does not exist' };
  } catch (error) {
    console.error('Error renaming/moving path:', error);
    throw error;
  }
});

ipcMain.handle('search-online-music', async (event, query) => {
  return new Promise((resolve) => {
    const url = `https://archive.org/advancedsearch.php?q=collection:(opensource_audio)+AND+(title:${encodeURIComponent(query)}+OR+creator:${encodeURIComponent(query)})&fl[]=identifier,title,creator,artist,downloads,runtime&sort[]=downloads+desc&output=json&rows=15`;
    const https = require('https');
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const docs = parsed.response?.docs || [];
          const mapped = docs.map((doc) => {
            let durationSecs = '0';
            if (doc.runtime) {
              if (typeof doc.runtime === 'string' && doc.runtime.includes(':')) {
                const parts = doc.runtime.split(':');
                if (parts.length === 2) {
                  durationSecs = String(parseInt(parts[0], 10) * 60 + parseFloat(parts[1]));
                } else if (parts.length === 3) {
                  durationSecs = String(parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]));
                }
              } else {
                durationSecs = String(doc.runtime);
              }
            }
            return {
              id: doc.identifier,
              title: doc.title || 'Bilinmeyen Şarkı',
              artist: doc.creator || doc.artist || 'Bilinmeyen Sanatçı',
              stream_url: `ARCHIVE:${doc.identifier}`,
              thumb: `https://archive.org/services/img/${doc.identifier}`,
              duration: durationSecs,
              downloads: doc.downloads || 0
            };
          });
          resolve(mapped);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', (err) => {
      console.error('IPC search music error:', err);
      resolve([]);
    });
  });
});

ipcMain.handle('resolve-archive-track', async (event, identifier) => {
  return new Promise((resolve) => {
    const url = `https://archive.org/metadata/${identifier}`;
    const https = require('https');
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const files = parsed.files || [];
          const playableFile = files.find(f => {
            const name = f.name.toLowerCase();
            return name.endsWith('.mp3') || 
                   name.endsWith('.m4a') || 
                   name.endsWith('.ogg') || 
                   name.endsWith('.flac') || 
                   name.endsWith('.wav');
          });
          if (playableFile) {
            resolve(`https://archive.org/download/${identifier}/${encodeURIComponent(playableFile.name)}`);
          } else {
            resolve('');
          }
        } catch (e) {
          resolve('');
        }
      });
    }).on('error', (err) => {
      console.error('IPC resolve music error:', err);
      resolve('');
    });
  });
});

/* ==========================================================================
   LEGACY BACKGROUND GIT ENGINE (DISABLED)
   ========================================================================== */

ipcMain.handle('get-sync-status', () => {
  return 'offline';
});

ipcMain.handle('get-last-sync-error', () => {
  return null;
});

ipcMain.handle('save-git-creds', () => {
  return { success: true };
});

// IPC Handler: Uygulamanın açık/koyu tema durumuna göre özel (frameless) pencere
// başlığındaki minimize/maximize/kapat kontrollerinin rengini günceller. Bu
// kontroller React tarafında değil, işletim sistemi seviyesinde (titleBarOverlay)
// çizildiği için tema değişimini renderer'dan main process'e bildirmemiz gerekir.
ipcMain.handle('set-titlebar-theme', (event, theme) => {
  if (!mainWindow) return { success: false };
  const isLight = theme === 'light';
  mainWindow.setTitleBarOverlay({
    color: isLight ? '#f8fafc' : '#121214',
    symbolColor: isLight ? '#0f172a' : '#e1e1e6',
    height: 35
  });
  return { success: true };
});

ipcMain.handle('toggle-mini-mode', async (event, { isMini }) => {
  if (isMini) {
    originalBounds = mainWindow.getBounds();
    mainWindow.setSize(380, 240, true);
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setResizable(false);
  } else {
    mainWindow.setResizable(true);
    mainWindow.setAlwaysOnTop(false);
    if (originalBounds) {
      mainWindow.setBounds(originalBounds, true);
    } else {
      mainWindow.setSize(1200, 800, true);
    }
  }
  return { success: true };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('restart-and-install', () => {
  autoUpdater.quitAndInstall();
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (process.env.VITE_DEV_SERVER !== '1') {
    try {
      const res = await autoUpdater.checkForUpdatesAndNotify();
      return { success: true, res };
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'error', text: `Güncelleme hatası: ${err.message}` });
      }
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Geliştirme modunda güncellemeler devre dışıdır.' };
});

autoUpdater.on('checking-for-update', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'checking', text: 'Güncelleme kontrol ediliyor...' });
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'available', version: info.version, text: `Yeni sürüm v${info.version} bulundu!` });
  }
});

autoUpdater.on('update-not-available', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'not-available', text: 'Uygulama güncel.' });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'downloading', percent, text: `Yeni sürüm indiriliyor: %${percent}` });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'downloaded', version: info.version, text: `Sürüm v${info.version} hazır! Yüklemek için tıklayın.` });
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'error', text: `Güncelleme hatası: ${err.message}` });
  }
});
