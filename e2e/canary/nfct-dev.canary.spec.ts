import { appendFileSync, readFileSync } from 'node:fs';
import type { BrowserContext, Request } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loginThroughUi } from '../helpers/auth';
import {
  completeConsumerOnboarding,
  expectConsumerHome,
  expectMentalMathReadyForNewPlayer,
  openGameFromTrain,
  signUpFreshAccountThroughUi,
  startPauseAndQuitMentalMathRun,
  type FreshAccount,
} from '../helpers/journeys';
import { canaryDevice } from './device';

// The nfct-dev canary (docs/nfct/nfct-dev-canary.md): can this branch's code
// complete the critical consumer journey against the Firebase backend that
// TestFlight builds use? Ordinary user actions only, through the real UI, as
// one fresh disposable account. The permission-denied guard (../fixtures)
// fails the test on any denied Firestore request.
//
// Keep it narrow: nfct-dev is on the Spark plan and shared. One account, one
// browser, no fixture seeding, no polling of Firestore, no retries. Assert
// trusted scoring (a session `result`, progress) here only once Functions are
// deployed to nfct-dev.

/** Generous ceilings that only a request loop would reach (a normal run makes far fewer). */
const REQUEST_CEILING = { auth: 40, firestore: 250 } as const;

type Usage = Record<'auth' | 'firestore' | 'otherGoogle', number>;

function categoryOf(request: Request): keyof Usage | null {
  const url = new URL(request.url());
  if (/^(identitytoolkit|securetoken)\.googleapis\.com$/.test(url.hostname) || /^\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(url.pathname)) return 'auth';
  if (url.hostname === 'firestore.googleapis.com' || url.pathname.includes('/google.firestore.v1.Firestore/')) return 'firestore';
  if (url.hostname.endsWith('.googleapis.com')) return 'otherGoogle';
  return null;
}

function recordFirebaseRequests(usage: Usage, context: BrowserContext): void {
  context.on('request', (request) => {
    const category = categoryOf(request);
    if (category) usage[category] += 1;
  });
}

function canaryIdentity(): FreshAccount {
  const path = process.env.NFCT_CANARY_IDENTITY_FILE;
  if (!path) throw new Error('NFCT_CANARY_IDENTITY_FILE is not set: run the canary with `node scripts/canary/canary.mjs run`');
  return JSON.parse(readFileSync(path, 'utf8')) as FreshAccount;
}

test('a fresh consumer signs up, onboards, saves a Mental Math run and signs back in', async ({ page, browser }, testInfo) => {
  const account = canaryIdentity();
  const usage: Usage = { auth: 0, firestore: 0, otherGoogle: 0 };
  recordFirebaseRequests(usage, page.context());

  try {
    await test.step('create a fresh account from the signed-out Welcome screen', async () => {
      await signUpFreshAccountThroughUi(page, account);
    });

    await test.step('Train my brain: the role is saved and the consumer arrives home', async () => {
      await completeConsumerOnboarding(page);
    });

    await test.step('Train > Mental Math loads the new player\'s progress and sessions', async () => {
      await openGameFromTrain(page, 'Mental Math');
      await expectMentalMathReadyForNewPlayer(page);
    });

    await test.step('start, pause and quit a run: the server acknowledges the saved session', async () => {
      await startPauseAndQuitMentalMathRun(page);
    });

    await test.step('sign in again with no cache: the profile and role come back from the server', async () => {
      const context = await browser.newContext({ ...canaryDevice, baseURL: testInfo.project.use.baseURL });
      recordFirebaseRequests(usage, context);
      try {
        const freshPage = await context.newPage();
        await loginThroughUi(freshPage, account);
        await expectConsumerHome(freshPage, 'Signing in again should return home, not to role selection');
      } finally {
        await context.close();
      }
    });
  } finally {
    const summary = `Firebase requests by this run: Auth ${usage.auth}, Firestore ${usage.firestore}, other Google APIs ${usage.otherGoogle}`;
    console.log(summary);
    await testInfo.attach('firebase-requests.json', { body: JSON.stringify(usage), contentType: 'application/json' });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
  }

  expect(usage.auth, 'Auth requests (a loop?)').toBeLessThanOrEqual(REQUEST_CEILING.auth);
  expect(usage.firestore, 'Firestore requests (a listener or write loop?)').toBeLessThanOrEqual(REQUEST_CEILING.firestore);
});
