# Native merge-gate enforcement evidence

The controller's exact-run validation and GitHub's branch protection are separate
contracts. A green native job, or a local test of its identity, does not establish
that GitHub requires it to merge. Do not retire the legacy requirements before
live enforcement is demonstrated.

## Test conditions

Use a ready, same-repository PR containing a protected script or workflow
change. Verify its exact changed paths with the current policy before opening
the PR: ordinary documentation is eligible for auto-merge and is unsuitable.
Keep auto-merge absent throughout the experiment and do not attempt a merge. Keep `checks`, `Codex Review / gate`, and `Auto Merge / eligible` required,
with their existing GitHub Actions source, strict updates, and review settings.
Stage `merge-gate` from GitHub Actions alongside these requirements.

Record the source and base SHAs, workflow run and attempt, check suite and native
check ID. Match the current job through the run-attempt jobs endpoint, then match
that exact check ID in GraphQL with `isRequired(pullRequestNumber: ...) = true`.
Check the source and synthetic merge commit separately; an old same-name success
must not stand in for the current native job.

Capture metadata with the read-only operator command:

```sh
node scripts/collect-native-gate-evidence.cjs PR_NUMBER RUN_ID output.json
```

Use a new output file for every observation. The command reports observations,
not a pass verdict; account for other merge blockers before interpreting the
result. Truncated check or review-thread connections reject the capture.
Captures are multiple API reads, not an atomic snapshot, so repeat a capture when the run changes state.

## Evidence required

| Scenario | Required observation |
| --- | --- |
| Initial complete review | Current native check is required and successful; all other requirements pass. |
| Same-SHA native-job rerun pending | Current native check is pending and required; GitHub reports the PR blocked despite the previous successful check. |
| Same-SHA native-job failure | Current native check fails and remains required; GitHub reports the PR blocked. |
| Failure isolated from other gates | Restore any deliberately interrupted CI and verify other required checks pass while the failed native gate still blocks. |
| Fresh complete evaluation | On the same source SHA, all checks recover through their normal workflows and the PR becomes mergeable. |

Capture each observation while its state is live. A blocked PR alone is not proof:
other failed or pending checks, a draft, conflicts, an outdated base, or unresolved
review requirements can also block it. For isolated evidence, account for all of
those conditions. Record administrator bypass separately; this experiment tests
normal required-check enforcement and does not remove existing bypass rights.

Use only normal workflow runs and reruns to produce results. Do not forge check
statuses, disable protections, resolve somebody else's review, or use a real merge
as a test. Preserve the staged requirement if a test fails and investigate before
removing any legacy protection.

## Live results: 2026-09-08

The staged ruleset requires all four checks from GitHub Actions (`15368`).
Strict updates, conversation resolution, and the existing administrator bypass
remain unchanged. [PR #35](https://github.com/dexsword/dextech/pull/35) stayed open,
ready, conflict-free, without review threads or an auto-merge request throughout.
No merge was attempted and no check result was edited.

The experiment held both commits fixed:

- Source: `9d641f28fc8ff6deeea4d0c5823e7d247251adb3`
- Base: `d6da1e64c2a7c29638826927ddcce4351e870bef`
- Review run: [34182241745](https://github.com/dexsword/dextech/actions/runs/34182241745)
- Native suite: `92594493531`

[Recorded API evidence](evidence/native-gate-pr35-2026-09-08.json) includes the
current native check IDs, required head checks, synthetic merge status, effective
rules, and timestamps. Every listed current native check matched the run, attempt,
suite, source SHA and GitHub Actions App and was recognized as required.

| UTC time | Attempt | Native check ID | Native result | GitHub merge state |
| --- | --- | --- | --- | --- |
| 03:28:43 | 1 | `101923935318` | Success | `CLEAN` |
| 03:34:02 | 2 | `101928421527` | In progress | `BLOCKED` |
| 03:34:44 | 2 | `101928421527` | Failure | `BLOCKED` |
| 03:38:16 | 3 | `101929126525` | In progress | `BLOCKED` |
| 03:39:13 | 3 | `101929126525` | Success | `CLEAN` |

The failed-gate observation is isolated: CI and the legacy review gate were
successful, legacy eligibility was neutral as expected for a protected change,
and the current native gate was the only unsuccessful required check. The old
native check `101923935318` remained readable as a historical success on the same
source SHA. That historical success did not satisfy the replacement gate.

The pending observations show that the current native job was recognized as
required and the PR was blocked, but they do **not** isolate the native job as the
only cause: legacy results were temporarily absent during attempt 2 and pending
during attempt 3. Do not present those observations as an isolated pending test.

### Rerun behavior and recovery

Attempt 2 used GitHub's native-job rerun endpoint. While that rerun was starting,
GitHub's GraphQL check summary omitted the legacy results; the native controller
failed closed with `required-ci-missing-invalid-or-failed`. After GitHub restored
the legacy results, the failed native gate still blocked merging. No CI failure
or check mutation was needed to obtain the isolated failed-gate observation.

Rerunning the entire review workflow produced attempt 3. Snapshot established
fresh pending legacy checks, the review and native gate passed, and publication
returned the PR to `CLEAN` on the same source and base. During migration, prefer
a full workflow rerun over rerunning only the final native job.

These observations establish recognition of the current native gate, isolated
failure enforcement despite a prior same-SHA success, and recovery through a
full rerun. They do not exercise administrator bypass, an actual merge attempt,
or a native-only ruleset. The subsequent migration still needs fresh evaluation
and acceptance checks with the legacy requirements removed.

### Earlier observations

PR #33's successful native check was optional before the staged rule was added.
The first documentation-only candidate, PR #34, auto-merged under the existing
allowlist while the native gate was optional. Neither establishes native
enforcement; that is why the live experiment used protected PR #35.
