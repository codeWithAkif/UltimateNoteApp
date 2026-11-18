// Ekran görüntüleri çok büyük olabiliyor (4K ekran, 5-10 MB PNG). Eklenmeden önce en uzun kenarı sınırlanır; küçülmüyorsa özgün dosya kalır.
// Yalnızca tarayıcıda çalışır (canvas).

export const shrinkImage = async (file: File | Blob, maxSide: number = 1600): Promise<Blob> => {
  const type = (file as File).type || '';
  if (!/^image\/(png|jpeg)$/.test(type) || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale >= 1) { bmp.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close?.(); return file; }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out: Blob | null = await new Promise(res => canvas.toBlob(res, type, 0.9));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
};

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
