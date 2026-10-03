import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { seedPlayer } from './helpers/localEmulator';
import type { AuthorizedRead } from './helpers/authorizedFirestore';
import { expectProfileReadable } from './helpers/persistenceAssertions';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('persistence assertions read as the player; outsider reads are denied', async ({ browser, permissionErrorGuard }) => {
  const owner = await seedPlayer();
  const unrelated = await seedPlayer();
  // This local run has no privileged cleanup; the emulators discard all data.
  const playerContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(outsiderContext);
  try {
    const player = await playerContext.newPage();
    const outsider = await outsiderContext.newPage();
    await loginThroughUi(player, owner.player);
    await arriveAtHome(player);
    await loginThroughUi(outsider, unrelated.player);
    await arriveAtHome(outsider);

    await expectProfileReadable(owner.player, owner.name, player);

    const identityGuards = await player.evaluate(async ({ playerId }) => {
      const { authorizedFirestoreRead } = await import('/e2e/helpers/authorizedFirestore.ts');
      const read = { kind: 'document' as const, path: `users/${playerId}` };
      const outcome = async (uid: string, projectId: string) => {
        try {
          await authorizedFirestoreRead(uid, read, projectId);
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      };
      return {
        wrongUid: await outcome('another-user', 'demo-neurasticity-protocol-e2e'),
        wrongProject: await outcome(playerId, 'another-project'),
      };
    }, { playerId: owner.player.uid });
    expect(identityGuards.wrongUid).toContain('expected test account');
    expect(identityGuards.wrongProject).toContain('wrong Firebase project');

    const forbidden: AuthorizedRead[] = [
      { kind: 'collection', path: `users/${owner.player.uid}/gameSessions` },
      { kind: 'document', path: `users/${owner.player.uid}` },
    ];
    for (const read of forbidden) {
      const outcome = await outsider.evaluate(async ({ uid, read }) => {
        const { authorizedFirestoreRead } = await import('/e2e/helpers/authorizedFirestore.ts');
        try {
          await authorizedFirestoreRead(uid, read);
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      }, { uid: unrelated.player.uid, read });
      expect(outcome, `Outsider read of ${read.path}`).toContain('permission-denied');
    }
  } finally {
    await Promise.allSettled([playerContext.close(), outsiderContext.close()]);
  }
});
