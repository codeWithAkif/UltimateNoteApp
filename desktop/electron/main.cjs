const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-media', privileges: { standard: true, secure: true, bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');
const http = require('http');

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
  const appIconPath = path.join(__dirname, '../public/logo.png');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: appIconPath,
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

    // BUG DÜZELTMESİ: notlardaki resimler üzerinde sağ tıklandığında (params.mediaType
    // === 'image') hiçbir menü öğesi eklenmiyordu, bu yüzden "Resmi Kopyala" gibi bir
    // seçenek hiç görünmüyordu — resimler hiçbir şekilde kopyalanamıyordu. copyImageAt,
    // resmin kaynağından (data:/file:/http: farketmeksizin) bağımsız olarak o koordinattaki
    // GERÇEK render edilmiş pikselleri panoya kopyalar.
    if (params.mediaType === 'image') {
      template.push(
        { label: 'Resmi Kopyala', click: () => mainWindow.webContents.copyImageAt(params.x, params.y) },
        { label: 'Resmi Farklı Kaydet...', click: () => mainWindow.webContents.downloadURL(params.srcURL) }
      );
    } else if (params.isEditable) {
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
  autoUpdater.allowPrerelease = true;
  autoUpdater.allowDowngrade = true;
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
  
  // Güvenlik (Kural): Yalnızca gerçekten ihtiyaç duyulan medya/mikrofon/pano izinleri
  // verilir. Gömülü webview/iframe içindeki siteler kamera, konum, bildirim vb.
  // hassas izinleri otomatik alamaz; diğer tüm istekler reddedilir.
  // BUG DÜZELTMESİ: Çoklu satır seçip Ctrl+C ile kopyalama, navigator.clipboard.writeText()
  // JS API'sini kullanıyor (tek satırlık native textarea kopyalamanın aksine) — bu API,
  // pano izinleri buraya eklenmeden Electron tarafından sessizce reddediliyordu
  // ("Write permission denied"), kullanıcı hiçbir hata görmeden kopyalama başarısız oluyordu.
  const ALLOWED_PERMISSIONS = new Set(['media', 'microphone', 'audioCapture', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
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

// İSTEK (kullanıcı: "task başlamaya/bitmesine 5dk kala kuvvetli bir uyaran istiyorum,
// uygulama açıksa ekrana gelsin"): pencere simge durumundaysa geri getirir, arkaplandaysa
// öne alır/odaklar; Windows'ta ayrıca görev çubuğu simgesini yanıp söndürür (flashFrame) —
// pencere zaten odaktaysa bu görsel olarak sessiz kalır, rahatsız etmez.
ipcMain.handle('focus-and-flash-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(true);
  return { success: true };
});

// ============ GOOGLE CALENDAR — İKİ YÖNLÜ SENKRON (İSTEK: "burda olanları da oraya
// aktarabilir miyim") ============
// Mevcut Google entegrasyonu (CalendarView.tsx'teki iCal linki) SALT-OKUNUR bir "feed" —
// Google'a yazma izni vermiyor. Buradan Google'a PUSH etmek için gerçek OAuth2 + Calendar
// API'si gerekiyor. Kullanıcının kendi Google Cloud projesindeki Client ID/Secret'ı burada
// (uygulamanın kendi diskinde, safeStorage ile İŞLETİM SİSTEMİ anahtar zinciriyle şifrelenmiş
// olarak) saklanır — KOD İÇİNE GÖMÜLMEZ, repo PUBLIC olduğu için asla git'e commit edilmez.
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function googleConfigPath() {
  return path.join(app.getPath('userData'), 'google-calendar-auth.enc');
}

function readGoogleConfig() {
  try {
    if (!fs.existsSync(googleConfigPath()) || !safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(googleConfigPath());
    return JSON.parse(safeStorage.decryptString(buf));
  } catch (e) {
    console.error('Google Calendar ayarları okunamadı:', e);
    return null;
  }
}

function writeGoogleConfig(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu sistemde şifreli depolama kullanılamıyor.');
  fs.writeFileSync(googleConfigPath(), safeStorage.encryptString(JSON.stringify(data)));
}

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

ipcMain.handle('google-set-credentials', (event, { clientId, clientSecret }) => {
  writeGoogleConfig({ ...(readGoogleConfig() || {}), clientId, clientSecret });
  return { success: true };
});

ipcMain.handle('google-auth-status', () => {
  const cfg = readGoogleConfig();
  return {
    hasCredentials: !!(cfg && cfg.clientId && cfg.clientSecret),
    isConnected: !!(cfg && cfg.refreshToken)
  };
});

ipcMain.handle('google-disconnect', () => {
  const cfg = readGoogleConfig() || {};
  delete cfg.refreshToken;
  delete cfg.accessToken;
  delete cfg.tokenExpiry;
  writeGoogleConfig(cfg);
  return { success: true };
});

// Standart "installed app" OAuth akışı (PKCE ile): tarayıcıda izin ekranı açılır, kullanıcı
// onaylayınca Google, 127.0.0.1'deki (dinamik port) GEÇİCİ yerel sunucumuza yönlendirir — bu
// "Desktop app" istemci tipi için Google'ın önerdiği, sabit bir redirect URI KAYDETMEYİ
// gerektirmeyen resmi yöntemdir.
ipcMain.handle('google-auth-start', async () => {
  const cfg = readGoogleConfig();
  if (!cfg || !cfg.clientId || !cfg.clientSecret) {
    return { success: false, error: 'Önce Client ID / Client Secret girilmeli.' };
  }
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  return new Promise((resolve) => {
    let port = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = url.searchParams.get('code');
        const errParam = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (errParam || !code) {
          res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>Bağlantı iptal edildi.</h2><p>Bu sekmeyi kapatıp uygulamaya dönebilirsin.</p></body></html>');
          server.close();
          finish({ success: false, error: errParam || 'Kod alınamadı' });
          return;
        }
        res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>✅ Google Calendar bağlandı!</h2><p>Bu sekmeyi kapatıp uygulamaya dönebilirsin.</p></body></html>');
        server.close();

        const redirectUri = `http://127.0.0.1:${port}`;
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier
          })
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok) {
          finish({ success: false, error: tokenJson.error_description || tokenJson.error || 'Token alınamadı' });
          return;
        }
        writeGoogleConfig({
          ...cfg,
          refreshToken: tokenJson.refresh_token || cfg.refreshToken,
          accessToken: tokenJson.access_token,
          tokenExpiry: Date.now() + tokenJson.expires_in * 1000
        });
        finish({ success: true });
      } catch (e) {
        finish({ success: false, error: e.message });
      }
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })}`;
      shell.openExternal(authUrl);
    });
    const timeoutId = setTimeout(() => {
      try { server.close(); } catch {}
      finish({ success: false, error: 'Zaman aşımı — izin ekranı 2 dakika içinde tamamlanmadı.' });
    }, 120000);
  });
});

// Erişim token'ı süresi dolmuşsa (veya bitmeye yakınsa) refresh_token ile sessizce yeniler —
// her API çağrısından önce bu çağrılır, çağıran taraf token yönetimiyle hiç uğraşmaz.
async function getValidGoogleAccessToken() {
  const cfg = readGoogleConfig();
  if (!cfg || !cfg.refreshToken) return null;
  if (cfg.accessToken && cfg.tokenExpiry && Date.now() < cfg.tokenExpiry - 60000) {
    return cfg.accessToken;
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('Google token yenilenemedi:', json);
    return null;
  }
  writeGoogleConfig({ ...cfg, accessToken: json.access_token, tokenExpiry: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}

// Bir görevi Google Calendar'a YAZAR — eventId verilmemişse YENİ etkinlik oluşturur (id'sini
// döner, çağıran taraf bunu notta [gcal:id] etiketi olarak saklar); verilmişse GÜNCELLER. Google
// tarafında etkinlik elle silinmişse (404) sessizce yeniden oluşturur.
ipcMain.handle('google-calendar-push-event', async (event, { eventId, summary, description, startISO, endISO }) => {
  const token = await getValidGoogleAccessToken();
  if (!token) return { success: false, error: 'Google Calendar\'a bağlı değil.' };
  const body = { summary, description, start: { dateTime: startISO }, end: { dateTime: endISO } };
  const baseUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const url = eventId ? `${baseUrl}/${eventId}` : baseUrl;
  try {
    const res = await fetch(url, {
      method: eventId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (res.ok) return { success: true, eventId: json.id };
    if (res.status === 404 && eventId) {
      const retryRes = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const retryJson = await retryRes.json();
      if (retryRes.ok) return { success: true, eventId: retryJson.id };
      return { success: false, error: retryJson.error?.message || 'Bilinmeyen hata' };
    }
    return { success: false, error: json.error?.message || 'Bilinmeyen hata' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('google-calendar-delete-event', async (event, { eventId }) => {
  const token = await getValidGoogleAccessToken();
  if (!token) return { success: false, error: 'Google Calendar\'a bağlı değil.' };
  try {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok || res.status === 404 || res.status === 410) return { success: true };
    const json = await res.json().catch(() => ({}));
    return { success: false, error: json.error?.message || 'Silinemedi' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('restart-and-install', () => {
  autoUpdater.quitAndInstall();
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (process.env.VITE_DEV_SERVER !== '1') {
    try {
      const res = await autoUpdater.checkForUpdatesAndNotify();
      return { success: true, version: res?.updateInfo?.version || null };
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
  let friendlyMsg = 'Güncelleme sunucusuna ulaşılamadı veya henüz yeni yayın bulunamadı.';
  if (err && err.message) {
    if (err.message.includes('404') || err.message.includes('406') || err.message.includes('latest')) {
      friendlyMsg = 'Yeni yayınlanan sürüm henüz GitHub üzerinde aktifleşmedi (Lütfen 1-2 dk bekleyin).';
    } else if (err.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
      friendlyMsg = 'İnternet bağlantısı kurulamadı.';
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'error', text: friendlyMsg });
  }
});
