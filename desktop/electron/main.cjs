const { app, BrowserWindow, ipcMain, protocol, net, Menu } = require('electron');
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

  // Forward frontend console messages to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Frontend Console] [Level ${level}]: ${message} (Source: ${sourceId}:${line})`);
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
        if (file.startsWith('.')) {
          return; // Ignore system/hidden files and directories like .git
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
        } else if (file.endsWith('.md') || file.endsWith('.excalidraw')) {
          const isExcalidraw = file.endsWith('.excalidraw');
          fileList.push({
            name: file.replace(/\.(md|excalidraw)$/, ''),
            path: relativePath,
            type: isExcalidraw ? 'excalidraw' : 'note',
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
