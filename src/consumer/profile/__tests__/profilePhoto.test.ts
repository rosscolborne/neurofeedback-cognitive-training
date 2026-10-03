import { describe, expect, it, vi } from 'vitest';
import { PROFILE_PHOTO_MAX_LENGTH, userProfileWriteSchema } from '@nfct/shared';
import { PROFILE_PHOTO_MAX_FILE_BYTES, ProfilePhotoError, profilePhotoFromFile } from '../profilePhoto';

// A chosen photo becomes a small JPEG data URL the shared schema and the rules
// accept; a file that cannot is refused with a message for the player.

const jpeg = (payloadLength: number) => `data:image/jpeg;base64,${'A'.repeat(payloadLength)}`;
const image = (type = 'image/png', size = 1024) => ({ type, size }) as Blob;

describe('profilePhotoFromFile', () => {
  it('encodes the photo once when the first attempt fits, as a value the profile schema accepts', async () => {
    const encode = vi.fn(async () => jpeg(20_000));
    const dataUrl = await profilePhotoFromFile(image(), encode);

    expect(encode).toHaveBeenCalledOnce();
    expect(encode).toHaveBeenCalledWith(expect.anything(), 256, 0.85);
    expect(userProfileWriteSchema.shape.avatar.safeParse({ kind: 'photo', dataUrl }).success).toBe(true);
  });

  it('steps down size and quality until the photo fits the profile bound', async () => {
    const tooBig = jpeg(PROFILE_PHOTO_MAX_LENGTH);
    const encode = vi.fn()
      .mockResolvedValueOnce(tooBig)
      .mockResolvedValueOnce(tooBig)
      .mockResolvedValueOnce(jpeg(40_000));
    const dataUrl = await profilePhotoFromFile(image(), encode);

    expect(encode.mock.calls.map(([, size, quality]) => [size, quality])).toEqual([[256, 0.85], [256, 0.7], [192, 0.7]]);
    expect(dataUrl.length).toBeLessThanOrEqual(PROFILE_PHOTO_MAX_LENGTH);
  });

  it('refuses a photo that never fits, or an encoding the browser could not produce', async () => {
    await expect(profilePhotoFromFile(image(), async () => jpeg(PROFILE_PHOTO_MAX_LENGTH))).rejects.toThrow(ProfilePhotoError);
    // A canvas that cannot encode returns "data:,".
    await expect(profilePhotoFromFile(image(), async () => 'data:,')).rejects.toThrow('Choose a different photo');
  });

  it('refuses a file that is not an image, or is too large to read, without encoding it', async () => {
    const encode = vi.fn(async () => jpeg(10));
    await expect(profilePhotoFromFile(image('application/pdf'), encode)).rejects.toThrow('Choose an image file.');
    await expect(profilePhotoFromFile(image('image/jpeg', PROFILE_PHOTO_MAX_FILE_BYTES + 1), encode)).rejects.toThrow('under 20 MB');
    expect(encode).not.toHaveBeenCalled();
  });

  it('passes on the player-facing reason when the image cannot be read', async () => {
    const unreadable = new ProfilePhotoError('This image couldn’t be read. Choose a different photo.');
    await expect(profilePhotoFromFile(image('image/heic'), async () => { throw unreadable; })).rejects.toBe(unreadable);
  });
});
