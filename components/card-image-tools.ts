export type ProcessedCardImage = {
  cardImageDataUrl: string;
  cardThumbnailDataUrl: string;
  cardImageMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  cardImageSize: number;
};

const maxImageBytes = 1_900_000;

function dataUrlByteSize(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

function imageMimeType(dataUrl: string): ProcessedCardImage['cardImageMimeType'] {
  if (dataUrl.startsWith('data:image/png')) return 'image/png';
  if (dataUrl.startsWith('data:image/webp')) return 'image/webp';
  return 'image/jpeg';
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('IMAGE_LOAD_FAILED'));
    };
    image.src = objectUrl;
  });
}

function renderImage(image: HTMLImageElement, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function canvasToCompressedDataUrl(canvas: HTMLCanvasElement, maxBytes: number, initialQuality: number) {
  const preferredTypes = ['image/webp', 'image/jpeg'] as const;

  for (const type of preferredTypes) {
    let quality = initialQuality;
    let dataUrl = canvas.toDataURL(type, quality);

    for (let attempt = 0; attempt < 6 && dataUrlByteSize(dataUrl) > maxBytes; attempt += 1) {
      quality = Math.max(0.58, quality - 0.08);
      dataUrl = canvas.toDataURL(type, quality);
    }

    if (dataUrl.startsWith(`data:${type}`)) return dataUrl;
  }

  return canvas.toDataURL('image/jpeg', 0.72);
}

export async function processCardImageFile(file: File): Promise<ProcessedCardImage> {
  if (!file.type.startsWith('image/')) throw new Error('INVALID_IMAGE_TYPE');

  const image = await loadImage(file);
  const fullCanvas = renderImage(image, 1440, 920);
  const thumbCanvas = renderImage(image, 560, 360);
  const cardImageDataUrl = canvasToCompressedDataUrl(fullCanvas, maxImageBytes, 0.84);
  const cardThumbnailDataUrl = canvasToCompressedDataUrl(thumbCanvas, 220_000, 0.76);
  const cardImageSize = dataUrlByteSize(cardImageDataUrl);

  if (cardImageSize > maxImageBytes) throw new Error('IMAGE_TOO_LARGE');

  return {
    cardImageDataUrl,
    cardThumbnailDataUrl,
    cardImageMimeType: imageMimeType(cardImageDataUrl),
    cardImageSize,
  };
}
