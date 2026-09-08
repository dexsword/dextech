# Native merge-gate enforcement evidence

The controller's exact-run validation and GitHub's branch protection are separate
contracts. A green native job, or a local test of its identity, does not establish
that GitHub requires it to merge. Do not retire the legacy requirements before
live enforcement is demonstrated.

## Test conditions

Use a ready, same-repository PR containing a protected documentation or workflow
change. Keep auto-merge absent throughout the experiment and do not attempt a
merge. Keep `checks`, `Codex Review / gate`, and `Auto Merge / eligible` required,
with their existing GitHub Actions source, strict updates, and review settings.
Stage `merge-gate` from GitHub Actions alongside these requirements.

Record the source and base SHAs, workflow run and attempt, check suite and native
check ID. Match the current job through the run-attempt jobs endpoint, then match
that exact check ID in GraphQL with `isRequired(pullRequestNumber: ...) = true`.
Check the source and synthetic merge commit separately; an old same-name success
must not stand in for the current native job.

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

## Evidence status

The live experiment is pending. On 2026-09-08, the successful native check
`101916781303` in [PR #33](https://github.com/dexsword/dextech/pull/33) matched run
`34179823592`, attempt `1`, suite `92588241813`, and source
`a91b34a941ba07ce177dcc1dcaf965b562ea44b2`. GitHub reported `isRequired: false`.
That establishes native check identity, not native enforcement. The existing
ruleset required only CI and the two legacy checks at that observation.

Replace this pending status with the recorded scenarios and run links after the
staged requirement is installed and tested. The subsequent migration removes the
legacy requirements only after these checks pass.
