# NFCT fork record

`neurofeedback-cognitive-training` (NFCT) is the consumer cognitive-training
product. It was forked on 2026-09-29 from the Waveable clinical repository
(`samerzumot/neurasticity`), which continues separately and was not modified.

## Fork base

| | SHA |
|---|---|
| Source commit (`neurasticity` `main`) | `f096a27643c556f243f67f72ae4ede364777edad` |
| Same commit in this repository | `35edb7afa6c932b47c0da6624a099fc220490700` (tag `nfct-fork-base`) |

History was preserved, then rewritten once with
`git filter-repo --path build/Brainwell.xcarchive --invert-paths` to drop an
old development build archive (it contained a development provisioning
profile). No other path changed: the fork base and every ported branch tip
have trees identical to their `neurasticity` originals. Because every commit
was rewritten, SHAs differ from `neurasticity`; `fork-commit-map.txt` maps
each original SHA (left) to its SHA here (right). Use it, or `git cherry`
patch ids, to find a `neurasticity` commit in this history. Moving later
changes between the repositories is done with cherry-picks.

## Ported work (Stage 0)

Merged with `--no-ff` from `neurasticity` source branches, rewritten
consistently with the fork base:

| Change | Source branch tip | Rewritten tip |
|---|---|---|
| WB-97 in-app account deletion and readable errors | `596419f` | `1e02758` |
| WB-93 password-reset resend cooldown | `49be0d1` | `13a3345` |
| WB-88 bounded session history | `87e6ad7` | `95b9011` |

WB-109/WB-96 (self-directed plan and weekly target), WB-71, WB-91 and
WB-103 were deliberately not ported.

## Isolation from Waveable

- No clinical Firebase project, credentials, auto-deploy workflow or
  deployed E2E harness. `npm run check:isolation` enforces this in CI.
- `src/services/firebaseConfig.ts` has no default project and refuses the
  Waveable clinical project.
- `brainflow_service/` is an inherited copy of the shared, product-neutral
  `brainflow-service` repository. NFCT does not own or change it; a later
  stage points NFCT at the shared service and removes the copy.
