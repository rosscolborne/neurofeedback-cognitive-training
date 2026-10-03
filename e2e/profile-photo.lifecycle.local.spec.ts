import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { readAccountRecords, seedPlayer } from './helpers/localEmulator';

// The profile photo (Phase 2): a player uploads it from Profile, the app
// downscales it on the device and stores it in their consumer profile
// (users/{uid}), and it is shown instead of their initials from then on.

async function openProfile(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Account' })).toBeVisible();
}

/** A large PNG drawn in the page, so the upload exercises real decoding and downscaling. */
async function largePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    for (let x = 0; x < canvas.width; x += 40) {
      context.fillStyle = `hsl(${(x / canvas.width) * 360}, 70%, 55%)`;
      context.fillRect(x, 0, 40, canvas.height);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

const photoInput = (page: Page) => page.getByTestId('profile-photo-input');
const profilePhoto = (page: Page) => page.getByRole('button', { name: 'Change profile photo' }).locator('img');

test('a player uploads a profile photo, which replaces their initials and persists in their profile', async ({ page }) => {
  const { player } = await seedPlayer();
  await loginThroughUi(page, player);
  await arriveAtHome(page);
  await openProfile(page);

  await expect(page.getByRole('button', { name: 'Upload profile photo' })).toBeVisible();
  await expect(page.getByRole('main').locator('img')).toHaveCount(0);

  // A file that is not an image is refused with a reason, and nothing is saved.
  await photoInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(page.getByRole('alert')).toHaveText('Choose an image file.');
  expect((await readAccountRecords(player.uid)).profile?.avatar).toBeNull();

  await photoInput(page).setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await largePng(page) });
  await expect(profilePhoto(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const shown = await profilePhoto(page).getAttribute('src');
  expect(shown).toMatch(/^data:image\/jpeg;base64,/);

  // The server holds it in the consumer profile, downscaled within the bound.
  const avatar = (await readAccountRecords(player.uid)).profile?.avatar as { kind: string; dataUrl: string };
  expect(avatar.kind).toBe('photo');
  expect(avatar.dataUrl).toBe(shown);
  expect(avatar.dataUrl.length).toBeLessThanOrEqual(100_000);

  // It is the account's photo: it comes back after a reload.
  await page.reload();
  await arriveAtHome(page, { afterReload: true });
  await openProfile(page);
  await expect(profilePhoto(page)).toHaveAttribute('src', shown!);
});
