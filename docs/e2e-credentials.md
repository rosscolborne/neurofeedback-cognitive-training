# WB-44 E2E credentials and fixtures

This workflow is for the disposable development Firebase project `brainwell-327dc`. It does not create cloud resources by itself. An IAM administrator must review and perform the one-time bootstrap below before the first shared-project run. Do not run fixture reset against that project until this implementation and the proposed IAM bindings are approved.

## One-time IAM bootstrap (awaiting approval)

Resource: `waveable-e2e@brainwell-327dc.iam.gserviceaccount.com`. Create it in `brainwell-327dc`, with **no user-managed keys**. Grant the service account only two project custom roles:

| Role | Exact permissions | Use |
| --- | --- | --- |
| `waveableE2EFirestore` | `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`, `datastore.entities.update`, `datastore.entities.delete` | Read/query, transact, provision, reset and verify fixture documents. Bind with a condition for the `(default)` database. |
| `waveableE2EAuth` | `firebaseauth.users.get`, `firebaseauth.users.create`, `firebaseauth.users.update`, `firebaseauth.users.delete` | Look up fixed and disposable Auth users, create them, rotate passwords, mark email verified, and delete disposable users. |

Grant each approved human `roles/iam.serviceAccountTokenCreator` **on this service account only**. Its relevant permission is `iam.serviceAccounts.getAccessToken`; the predefined role also contains signing permissions, so a custom service-account-level role containing only `getAccessToken` is preferable if the IAM administrator can create one. Do not bind Token Creator at project scope. Enable `iamcredentials.googleapis.com` for the development project. The service account receives no role in any production project. [Google's IAM Credentials API](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken) documents the required impersonation permission; [Identity Platform's method table](https://docs.cloud.google.com/identity-platform/docs/access-control) and [Firestore IAM](https://docs.cloud.google.com/firestore/docs/security/iam) document the data permissions. [Firestore database IAM conditions](https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions) document the database restriction.

Proposed administrator commands (replace `HUMAN_EMAIL`, then review the IAM policy after each binding):

```bash
gcloud services enable iamcredentials.googleapis.com --project=brainwell-327dc
gcloud iam service-accounts create waveable-e2e --project=brainwell-327dc --display-name='Waveable E2E fixtures'
gcloud iam roles create waveableE2EFirestore --project=brainwell-327dc --title='Waveable E2E Firestore data' --stage=GA --permissions=datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update,datastore.entities.delete
gcloud iam roles create waveableE2EAuth --project=brainwell-327dc --title='Waveable E2E Auth users' --stage=GA --permissions=firebaseauth.users.get,firebaseauth.users.create,firebaseauth.users.update,firebaseauth.users.delete
gcloud projects add-iam-policy-binding brainwell-327dc --member=serviceAccount:waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --role=projects/brainwell-327dc/roles/waveableE2EFirestore --condition='expression=resource.name=="projects/brainwell-327dc/databases/(default)",title=WaveableE2EDefaultDatabase'
gcloud projects add-iam-policy-binding brainwell-327dc --member=serviceAccount:waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --role=projects/brainwell-327dc/roles/waveableE2EAuth --condition=None
gcloud iam service-accounts add-iam-policy-binding waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --project=brainwell-327dc --member=user:HUMAN_EMAIL --role=roles/iam.serviceAccountTokenCreator
```

The custom role permissions are the minimum expected for the current Admin SDK calls; the first approved cloud preflight must confirm them. If the Firebase Admin SDK needs an additional permission, amend the role only after identifying the failed API call. Do not substitute Owner, Editor, Firebase Admin, or a service-agent role. The Firestore IAM condition limits access to the default database, but it does not limit document paths inside that database; the fixed namespace and reset guards prevent accidental writes to unrelated accounts, while IAM alone cannot enforce that path allow-list.

## Per-session workflow

1. Run `gcloud auth application-default login` as a human approved for this service account. Do not use `gcloud auth activate-service-account` or a JSON key. The library accepts only user ADC and impersonates the pinned account for ten-minute access tokens, refreshing them in memory during a run.
2. Start the web app against `brainwell-327dc` at `E2E_BASE_URL` (default `http://localhost:5173`). Check `VITE_FIREBASE_PROJECT_ID` if setting Firebase overrides; the browser project must match.
   If an older `.env.e2e` exists, keep only `E2E_BASE_URL` in it before using the session command. The command rejects stored account passwords, key paths, and old cleanup settings before any reset.
3. Run `npm run test:e2e:session -- preflight` for a reset and Admin/browser readiness check, or `npm run test:e2e:session -- patient`, `-- clinician`, or `-- isolation` for a stateful suite. The latter two run the deployed-rules probe first. The command generates random per-session passwords, sets email verification and the current `users/{uid}.role` clinician authorization, recreates the linked pair and unlinked outsider, then starts Playwright auth setup. It uses `E2E_CLEANUP_MODE=execute` and resets the fixtures again after the suite.
4. `npm run test:e2e:session -- reset` repairs the fixture baseline without running Playwright. This rotates passwords, so use a new session command for later browser tests.

Fixed identities are in `e2e/helpers/fixtureModel.ts`: `wb44-e2e-patient`, `wb44-e2e-clinician`, and `wb44-e2e-outsider` with corresponding `@example.com` emails. The patient is linked to the clinician's single-member clinic; the outsider has no clinician or clinic. The existing isolation suite creates additional random accounts in its registered disposable namespace and cleans them through its lease. Auth UIDs are reused, passwords are rotated on every reset, and Firestore fixture data is recreated. Current rules use `users/{uid}.role` for clinician authorization; if WB-18/WB-19 introduce a separate grant, update this seeder before running those tests.

Reset also removes the fixture pair's message documents and read receipts. It refuses a receipt naming a reader outside that pair, so new messaging activity cannot cause the reset to delete another account's data.

The script refuses a different project or service account, a key-file path, non-human ADC, emulator variables, an active/parked stateful lease, a fixture reset lock, an unmarked fixed profile, or any discovered relationship to an unrelated user. It checks the browser Firebase project before the first reset. It does not change unrelated development accounts. A partial reset can be rerun; fixed IDs and email ownership checks prevent duplicates.

## Recovery and revocation

If a stateful run parks its lease, run `npm run test:e2e:recover -- <run-id> plan`, inspect the plan, then run `npm run test:e2e:recover -- <run-id> execute <digest>`. Recovery uses pinned Admin identities and does not require the discarded session passwords or browser storage states. The digest and lease checks in the [E2E reference](../.agents/skills/neurasticity-development-testing/references/e2e.md) still apply. Add `--accept-retained` only when consciously releasing a reviewed lease with retained records. Then run `npm run test:e2e:session -- reset` to recreate the baseline. If a reset fails after deleting some fixture documents, rerun it after resolving its error. If it refuses an unrelated link or unmarked document, inspect that record and resolve its ownership before retrying. Do not force-delete it through this script.

If the reset process crashes and leaves its own lock, run `npm run test:e2e:unlock -- inspect`. Confirm the original process is no longer running. Once the lock is at least ten minutes old, run `npm run test:e2e:unlock -- release <reviewed-reset-run-id>`, then rerun reset. A reset lock never expires automatically, so a slow active reset cannot be overtaken by another run.

To revoke access immediately, disable the service account, then remove the human Token Creator and project role bindings. Example commands for the proposed bootstrap:

```bash
gcloud iam service-accounts disable waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --project=brainwell-327dc
gcloud iam service-accounts remove-iam-policy-binding waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --project=brainwell-327dc --member=user:HUMAN_EMAIL --role=roles/iam.serviceAccountTokenCreator
gcloud projects remove-iam-policy-binding brainwell-327dc --member=serviceAccount:waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --role=projects/brainwell-327dc/roles/waveableE2EAuth --all
gcloud projects remove-iam-policy-binding brainwell-327dc --member=serviceAccount:waveable-e2e@brainwell-327dc.iam.gserviceaccount.com --role=projects/brainwell-327dc/roles/waveableE2EFirestore --all
```

Never commit `.env.e2e`, user ADC files, `e2e/.auth/` from the older workflow, Playwright auth storage state, session passwords, access tokens, service-account JSON keys, or cleanup reports. The session command keeps auth storage state in a private OS temporary directory and deletes it when finished. `.env.e2e.example` contains no secrets.
