import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { CapacitorHttp } from '@capacitor/core';
import * as git from 'isomorphic-git';
async function* makeAsyncIterable(buffer: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield buffer;
}

// Custom non-streaming HTTP client to prevent CapacitorHttp global patch from hanging.
// Converts request streams into single Uint8Array blocks, and resolves responses as single ArrayBuffers.
const http: any = {
  request: async ({ url, method, headers, body }: any) => {
    // 1. Consume the request body stream if present
    let requestBody: Uint8Array | undefined = undefined;
    if (body) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      let totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      requestBody = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        requestBody.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }

    // Normalize headers (especially Content-Type) to match the case-sensitive checks in native Capacitor code.
    const normalizedHeaders: Record<string, string> = {};
    if (headers) {
      Object.keys(headers).forEach((key) => {
        if (key.toLowerCase() === 'content-type') {
          normalizedHeaders['Content-Type'] = headers[key];
        } else {
          normalizedHeaders[key] = headers[key];
        }
      });
    }
    // Prevent CapacitorHttp native cache from serving stale Git ref/pack data
    normalizedHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    normalizedHeaders['Pragma'] = 'no-cache';
    normalizedHeaders['Expires'] = '0';

    const isPostOrPut = method === 'POST' || method === 'PUT';
    
    // We call CapacitorHttp.request directly to bypass window.fetch binary body serialization issues.
    const options: any = {
      url,
      method: method || 'GET',
      headers: normalizedHeaders,
      responseType: 'arraybuffer' // Ask native bridge to return response as a Base64-encoded string
    };

    if (isPostOrPut && requestBody) {
      options.data = fromBuffer(requestBody); // Convert binary body to Base64
      options.dataType = 'file'; // Instruct Android CapacitorHttp to decode Base64 and send raw bytes
    }

    const nativeRes = await CapacitorHttp.request(options);

    // Decode response data (which is a Base64 string on native if responseType is 'arraybuffer' and request succeeded)
    let responseData: Uint8Array;
    if (typeof nativeRes.data === 'string') {
      const isSuccess = nativeRes.status >= 200 && nativeRes.status < 300;
      if (isSuccess) {
        try {
          responseData = toUint8Array(nativeRes.data);
        } catch (e) {
          responseData = new TextEncoder().encode(nativeRes.data);
        }
      } else {
        responseData = new TextEncoder().encode(nativeRes.data);
      }
    } else if (nativeRes.data instanceof ArrayBuffer) {
      responseData = new Uint8Array(nativeRes.data);
    } else if (nativeRes.data instanceof Uint8Array) {
      responseData = nativeRes.data;
    } else {
      responseData = new Uint8Array();
    }

    // Lowercase headers for isomorphic-git compatibility
    const responseHeaders: Record<string, string> = {};
    if (nativeRes.headers) {
      Object.keys(nativeRes.headers).forEach((key) => {
        responseHeaders[key.toLowerCase()] = String(nativeRes.headers[key]);
      });
    }

    return {
      url: nativeRes.url || url,
      method: method || 'GET',
      headers: responseHeaders,
      body: makeAsyncIterable(responseData),
      statusCode: nativeRes.status,
      statusMessage: 'OK'
    };
  }
};

// Environment Check
export const isCapacitor = !!(window && (window as any).Capacitor);

// --------------------------------------------------------------------------
// 1. UTILS: PATH AND BINARY CONVERTERS
// --------------------------------------------------------------------------
function cleanPath(path: string): string {
  let rel = path;
  if (rel.startsWith('/UltimateNotes')) {
    rel = rel.substring('/UltimateNotes'.length);
  }
  if (rel.startsWith('/')) {
    rel = rel.substring(1);
  }
  return rel ? `UltimateNotes/${rel}`.replace(/\/+$/, '') : 'UltimateNotes';
}

function fromBuffer(buf: any): string {
  if (typeof buf === 'string') return buf;
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --------------------------------------------------------------------------
function wrapFsError(err: any): never {
  const msg = (err?.message || String(err)).toLowerCase();
  if (
    msg.includes('does not exist') || 
    msg.includes('not found') || 
    msg.includes('no such file') ||
    msg.includes('enoent')
  ) {
    const newErr = new Error(err?.message || String(err)) as any;
    newErr.code = 'ENOENT';
    newErr.name = 'ENOENT';
    throw newErr;
  }
  throw err;
}

// --------------------------------------------------------------------------
// 2. ISOMORPHIC-GIT COMPATIBLE CUSTOM FILE SYSTEM BRIDGE
// --------------------------------------------------------------------------
export const customFs = {
  promises: {
    readFile: async (path: string, options?: any) => {
      try {
        const cPath = cleanPath(path);
        const isUtf8 = options === 'utf8' || (options && options.encoding === 'utf8');
        
        const res = await Filesystem.readFile({
          path: cPath,
          directory: Directory.Documents,
          encoding: isUtf8 ? Encoding.UTF8 : undefined
        });

        return isUtf8 ? res.data : toUint8Array(res.data as string);
      } catch (err) {
        wrapFsError(err);
      }
    },
    writeFile: async (path: string, data: any, options?: any) => {
      const cPath = cleanPath(path);
      
      // Auto-create parent folders
      const parts = cPath.split('/');
      if (parts.length > 1) {
        const parentDir = parts.slice(0, -1).join('/');
        try {
          await Filesystem.mkdir({
            path: parentDir,
            directory: Directory.Documents,
            recursive: true
          });
        } catch (e) {}
      }

      const isUtf8 = options === 'utf8' || (options && options.encoding === 'utf8') || typeof data === 'string';

      await Filesystem.writeFile({
        path: cPath,
        directory: Directory.Documents,
        data: isUtf8 ? data : fromBuffer(data),
        encoding: isUtf8 ? Encoding.UTF8 : undefined
      });
    },
    readdir: async (path: string) => {
      try {
        const cPath = cleanPath(path);
        const res = await Filesystem.readdir({
          path: cPath,
          directory: Directory.Documents
        });
        return res.files.map(f => f.name);
      } catch (err) {
        wrapFsError(err);
      }
    },
    mkdir: async (path: string) => {
      const cPath = cleanPath(path);
      try {
        await Filesystem.mkdir({
          path: cPath,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (e) {}
    },
    rmdir: async (path: string) => {
      try {
        const cPath = cleanPath(path);
        await Filesystem.rmdir({
          path: cPath,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (err) {
        wrapFsError(err);
      }
    },
    unlink: async (path: string) => {
      try {
        const cPath = cleanPath(path);
        await Filesystem.deleteFile({
          path: cPath,
          directory: Directory.Documents
        });
      } catch (err) {
        wrapFsError(err);
      }
    },
    stat: async (path: string) => {
      try {
        const cPath = cleanPath(path);
        const res = await Filesystem.stat({
          path: cPath,
          directory: Directory.Documents
        });
        const isFile = res.type === 'file';
        const isDirectory = res.type === 'directory';
        const mtime = new Date(res.mtime);
        return {
          isFile: () => isFile,
          isDirectory: () => isDirectory,
          isSymbolicLink: () => false,
          size: res.size,
          mtimeMs: res.mtime,
          mtime: mtime,
          ctime: mtime,
          atime: mtime
        };
      } catch (err) {
        wrapFsError(err);
      }
    },
    lstat: async (path: string) => {
      return customFs.promises.stat(path);
    },
    readlink: async () => {
      throw new Error('ENOTSUP: readlink not supported');
    },
    symlink: async () => {
      throw new Error('ENOTSUP: symlink not supported');
    }
  }
};

// --------------------------------------------------------------------------
// 3. CREDENTIALS AND SYNC LIFE CYCLE MANAGEMENT
// --------------------------------------------------------------------------
export interface MobileGitCreds {
  url: string;
  username: string;
  token: string;
  branch?: string;
}

let syncStatus: 'synced' | 'syncing' | 'offline' | 'error' = 'offline';
let lastSyncError: string | null = null;
const listeners = new Set<(status: typeof syncStatus) => void>();

export function getMobileSyncStatus() {
  return syncStatus;
}

export function getMobileSyncError() {
  return null;
}

export function setMobileSyncStatus(status: any) {
  // disabled
}

export function onMobileSyncStatusChanged(callback: any) {
  return () => {};
}

export async function getMobileGitCredentials(): Promise<any | null> {
  return null;
}

export async function saveMobileGitCredentials(creds: any) {
  // disabled
}

export function triggerMobileGitSync() {
  // disabled
}

export async function syncMobileGit() {
  // disabled
}
