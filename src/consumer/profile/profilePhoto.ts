import { PROFILE_PHOTO_DATA_URL_PATTERN, PROFILE_PHOTO_MAX_LENGTH } from '@nfct/shared';

// A profile photo lives inside the profile document (users/{uid}) as a small
// image data URL: there is no file storage. The app makes it fit on the
// device: a centred square, downscaled and re-encoded as JPEG, which also
// drops the original file's metadata (such as its location).

/** The largest image file the app will try to read. */
export const PROFILE_PHOTO_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Encodes the centre square of an image at `size` × `size` pixels as a JPEG data URL. */
export type ProfilePhotoEncoder = (image: Blob, size: number, quality: number) => Promise<string>;

/** A photo the player chose that cannot become a profile photo; its message is written for them. */
export class ProfilePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePhotoError';
  }
}

// Tried in order until one fits the profile's bound. A typical photo fits at the first.
const ATTEMPTS: ReadonlyArray<readonly [size: number, quality: number]> = [
  [256, 0.85],
  [256, 0.7],
  [192, 0.7],
  [128, 0.6],
];

const encodeSquareJpeg: ProfilePhotoEncoder = async (image, size, quality) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new ProfilePhotoError('This image couldn’t be read. Choose a different photo.');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context || side === 0) throw new ProfilePhotoError('This image couldn’t be read. Choose a different photo.');
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
};

/** The profile photo for an image file the player chose: a data URL the shared schema and the rules accept. */
export async function profilePhotoFromFile(file: Blob, encode: ProfilePhotoEncoder = encodeSquareJpeg): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ProfilePhotoError('Choose an image file.');
  if (file.size > PROFILE_PHOTO_MAX_FILE_BYTES) throw new ProfilePhotoError('Choose a photo under 20 MB.');
  for (const [size, quality] of ATTEMPTS) {
    const dataUrl = await encode(file, size, quality);
    if (dataUrl.length <= PROFILE_PHOTO_MAX_LENGTH && PROFILE_PHOTO_DATA_URL_PATTERN.test(dataUrl)) return dataUrl;
  }
  throw new ProfilePhotoError('This photo couldn’t be used. Choose a different photo.');
}
