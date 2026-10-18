// 사진: 올리기 전에 폰에서 줄인다(긴 변 1280px·JPEG 0.8 ≈ 200KB) — 무료 저장 용량 안에서 버티려고.

export function loadImage(src, { cors = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

export async function compressImage(file, maxSide = 1280, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    c.getContext('2d').drawImage(img, 0, 0, w, hgt);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('compress_failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 목록은 작은 사진을 쓰고, 상세·저장 카드만 1280px 사진을 쓴다.
export async function compressPhoto(file) {
  const photoBlob = await compressImage(file);
  const photoThumbBlob = await compressImage(photoBlob, 480, 0.75);
  return { photoBlob, photoThumbBlob };
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
