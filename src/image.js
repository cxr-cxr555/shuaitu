const MAX_WIDTH = 600;
const MAX_HEIGHT = 900;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片处理失败'));
    }, type, quality);
  });
}

async function decodeImage(file) {
  if (globalThis.createImageBitmap) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export async function compressPortrait(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_WIDTH / decoded.width, MAX_HEIGHT / decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, width, height);

    let output = await canvasToBlob(canvas, 'image/webp', 0.86);
    if (!output.type.includes('webp')) {
      output = await canvasToBlob(canvas, 'image/jpeg', 0.86);
    }
    return output;
  } finally {
    decoded.cleanup();
  }
}
