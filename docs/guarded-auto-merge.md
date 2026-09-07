# Guarded auto-merge

The protected production branch is `dexsword/dextech:main`. CI tests and audits,
a read-only Codex review, and a deterministic path policy guard squash auto-merge.
GitHub branch protection remains authoritative. No immediate merge endpoint,
approval bypass, or fabricated native CI result is used.

## Required configuration

Will must configure `OPENAI_API_KEY` as a repository Actions secret. Never put its
value in files, logs, comments, artifacts, or PR text. The reviewer receives no
production, SSH, Tailscale, Calendar, or deployment credentials. OpenAI API use
incurs usage costs; each qualifying review can consume tokens. Set a project
budget/alerts and monitor usage. Rotate the key in the OpenAI project and replace
the GitHub secret; revoke the old key. To disable reviews, disable this workflow
and revoke the key. To stop automatic merging, disable repository auto-merge and
cancel pending native auto-merge requests. Keep required protections in place:
missing reviews must block merging.

Enable **Settings → General → Pull Requests → Allow auto-merge** and squash
merging. In the enforcing main ruleset, require an up-to-date branch and these
exact contexts, all sourced from **GitHub Actions** (integration ID 15368):

- `checks` (the `CI / checks` job)
- `Codex Review / gate`
- `Auto Merge / eligible`

Keep the configured approval and review-thread requirements. No setting change is
part of this PR. On 2026-09-07 the live repository already enabled auto-merge and
squash; effective rules required the three contexts above, strict up-to-date
branches, resolved threads, and zero mandatory approving reviews. Any additional
approval requirement remains authoritative.

## Source, merge and run identity

`HEAD_SHA` is the exact source reviewed, classified, and passed as native
`expectedHeadOid`. All three required checks belong to **HEAD_SHA** here.
`MERGE_SHA` independently identifies GitHub's synthetic candidate, validated
against the live merge ref and its ordered parents `[BASE_SHA, HEAD_SHA]`.
`BASE_SHA` must equal current main. The full-history source checkout must descend
from that trusted base. None of these immutable bindings is silently replaced
once captured. A changed candidate needs a new evaluation.

This is based on live evidence, not only mocks. On 2026-09-07, PR #17 head
`a3484cac3e9b7286fa373d5f583677e639c9261f` had all three contexts marked
`isRequired: true` by GraphQL on its source commit. Its potential merge commit
`78ee3678ed382246b01af2539fd8652ea6eacf5f` had no check rollup. REST check runs,
check suites, and statuses agreed; CI run/check metadata referenced the head.
PR #13 independently showed the same placement. Both merge-ref and commit REST
endpoints returned the correct ordered parents. The real readiness GraphQL query
used by this implementation also passed against PR #17's metadata.

A synthetic merge **checkout** in native CI does not imply its check run is
attached to that commit. [GitHub documents](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#conflicts-between-head-commit-and-test-merge-commit)
that a test-merge status can take precedence over head statuses. Therefore this
implementation rejects a split: any merge-commit check/status rollup prevents
authorization. It never copies CI results or creates a custom `checks` context.

## Sequence and lifecycle

1. `snapshot` reads and validates the live same-repository PR against the event
   head and current main. It checks run ownership, revokes stale native
   auto-merge, then immediately creates or resets the two custom checks to pending
   **on the source head**, before waiting for merge discovery. Closed PR events
   revoke stale requests and exit without review. Forks never reach a key-bearing
   job. Drafts cannot request auto-merge.
2. Merge discovery retries null/missing readiness and merge ref/commit 404s with
   1, 2, 4, 8, 15, and 30 second backoff. Temporary 502/503/504 responses are
   retryable. Each attempt reads current main and PR state, preserving the captured
   head/base. Confirmed conflicts, closed/changed PRs, malformed metadata, and
   permission errors fail closed. A five-minute snapshot limit and 20-second API
   timeouts bound prolonged outages; a later fresh run is needed after exhaustion.
3. `disarm` independently verifies revocation before eligibility/review. The
   latter jobs read exact Git objects; neither executes candidate scripts.
4. The write job does not poll for CI completion or impose a CI deadline.
   It independently validates review schema/confidence, eligibility, both pending
   checks and their ownership,
   current head/base/merge, required-check source/placement and valid state,
   repository auto-merge/squash settings, and the shape of human-review metadata.
   Immediately before mutation it re-reads the PR; GitHub's `expectedHeadOid`
   atomically binds the native request to the reviewed head. Required human
   approvals, changes-requested reviews, and unresolved conversations remain held
   by GitHub itself: enabling native auto-merge does not satisfy those requirements.
   Native CI must exist on the exact head and be successful or in a recognized
   pending state with no conclusion. Missing, malformed, failed, cancelled, timed-out,
   skipped, or neutral CI is rejected. Native auto-merge also waits for queued/running
   CI, however long it takes; completing CI later needs no new event or model review.
   A failure after authorization still blocks merging through branch protection.
   Human requirements can likewise be satisfied later without another review.
5. Request **native squash auto-merge while custom checks are pending**. Confirm
   the response and a fresh independent live read. Only then may `publish` release
   the custom checks, revalidating candidate, prerequisites, and run/check ownership
   before each update. GitHub performs the merge when its rules are satisfied.
6. Ineligible protected changes remain for manual review: eligibility is neutral,
   not an ordinary CI failure. Codex must still pass. Feedback is a single managed
   comment containing only fixed text, severity counts, bounded confidence, and
   reviewed SHA; all model filenames/explanations/summaries are withheld.
   Feedback skips closed PRs, including merges between publication and feedback.

Per-PR concurrency has `cancel-in-progress: true`. Only opened, synchronize,
reopened, ready-for-review, converted-to-draft, closed, and base-retarget edits
start reviews. Both native CI and Codex admit `edited` only when
`changes.base.ref.from` is present, so retargeting onto main starts both checks.
Title/body-only edits skip all jobs and have unique ignored concurrency groups;
their distinct review run names cannot supersede a current review. Ignored CI
edits use a different job name so they cannot add a skipped required `checks`
context. There are no status, check-run, or check-suite triggers. Updating the
managed comment or checks cannot trigger another review. A rerun reclaims pending checks for the same candidate and changes their
run/attempt ownership. Completed checks are superseded by fresh pending checks: live GitHub retained
the old conclusion when asked to reset a completed check, and duplicate older
failed names can remain required. After confirming a replacement is pending and
owning it, snapshot renames obsolete custom checks with a fixed `superseded ID`
suffix. Their historical conclusions are preserved. Native CI is never renamed
or rewritten. Snapshot requires the API response to confirm pending state, null
conclusion, and exact head/ownership before proceeding. Old runs,
old receipts, cancelled attempts, and runs superseded by a newer same-PR run
cannot authorize. Checks from an older source SHA never authorize a newer one.
GitHub API reads and mutations are separate operations; repeated ownership and
candidate checks supplement concurrency and strict branch protection, rather
than claiming those operations are atomic.

## Review trust and eligibility

Automatic runs use `pull_request_target`: workflow, policy and control code come
from the base. Exact candidate checkouts disable credentials, fetch full history
and disable tags. Candidate content, filenames, comments, commits, and PR text
are untrusted data. The review job has only `contents: read`; the official
`openai/codex-action` is its final substantive step, read-only with `drop-sudo`.
Pinned release: **v1.11**, commit
`52fe01ec70a42f454c9d2ebd47598f9fd6893d56`; Codex CLI **0.153.4**.
Candidate configuration/instructions are disabled; trusted prompt/config/schema
are supplied separately, with shell tools and unnecessary networking disabled.
Missing secrets/action failure/output or invalid JSON/schema fail closed.
Confidence must be at least **0.95**, verdict `pass`, with **no blocking findings**.
P0/P1 findings always fail. The model cannot push, approve, merge, dismiss checks,
or bypass policy. GitHub writes occur in separate jobs without the API key.

The allowlist in `.github/codex/policy.cjs` fails closed for unknown paths and file
modes. Workflows, actions, review controls/policy/AGENTS, ops/deployment and scripts,
auth/credentials, database/schema/migrations, destructive operations, backup and
rollback, Calendar/payment/admin paths, and sensitive filenames are protected.
Ordinary UI/content, allowlisted application paths, docs and tests may qualify.
Only tightly validated dev-only patch lockfile changes qualify as dependencies.
This hotfix is itself protected/ineligible and cannot auto-merge.

## Maintainer validation and recovery

Automatic review accepts only base-controlled `pull_request_target` events. There
is no production `workflow_dispatch` override and no input selecting executable
control code. Jobs that inspect run ownership explicitly declare `actions: read`;
the reviewer retains only `contents: read`. For a recovery run, use GitHub's rerun
UI on the trusted base-controlled workflow or push a fresh candidate commit.

Before installation, an isolated maintainer-owned push harness can execute vetted
control code against a fixed disposable PR. Its adapter reads live PR metadata,
constructs the equivalent base-controlled event, and explicitly checks out the
vetted harness commit in control jobs. Candidate files remain data only. This
adapter is not part of the production workflow or PR diff. Never select arbitrary
contributor code for such a harness.

For a first live test, push a harmless documentation commit to a disposable branch
from current main and open a PR. Let native CI start normally. Use the isolated
vetted harness with that fixed PR number; its matching concurrency group replaces
any old base-controlled review. Record head/base/merge and run IDs. Push a second
harmless commit to verify stale-run cancellation, then trigger the harness again.
Check that all required checks belong to the latest head and are marked required,
the old run cannot authorize, native squash is enabled before check success, and
GitHub merges without intervention. Do not manually publish checks or bypass
requirements. After installing the tested hotfix, synchronize PR #13 with current
main for a fresh automatic evaluation; that is a separate operation.

The default GITHUB_TOKEN suppresses downstream workflow events caused by its
merge. This test must not deploy production; production workflow dispatch remains
a separately authorized action. No reusable merge token is introduced here.

Fixed diagnostic categories include stale head/base, stale/unavailable merge,
merge discovery timeout, required CI missing, invalid, or failed, unexpected human-review metadata,
superseded/cancelled run, permission/settings rejection, immediately mergeable,
invalid review/eligibility, non-pending checks, unavailable auto-merge, and
unexpected response. Raw API/error/model bodies and credentials are never logged.

## Live integration evidence (2026-09-07)

The local gh token could create PRs but dispatch returned HTTP 403 with
`X-Accepted-Github-Permissions: actions=write`. Its effective Actions write
permission was unavailable. No token or repository permissions were changed.
An isolated, maintainer-owned `ci/guarded-merge-validation` branch instead used a
push-only harness with a fixed disposable PR input and the vetted control code.
Only the trigger/input adapter differed; no PR candidate code was executed by a
privileged job. The harness is not part of this PR or the main workflow.

[PR #18](https://github.com/dexsword/dextech/pull/18) used two harmless documentation
commits. On the second push, obsolete review runs `34111107752`, `34111026139`,
`34111280261`, and `34111283910` were cancelled. The successful authorization path
was [run 34111291990](https://github.com/dexsword/dextech/actions/runs/34111291990).
Its immutable source head was `bce137a6e9c895190eb89fd1cf0d37a7b7ea2eb9`, base
`03aafa3b87b2dbe6f9c0808ae46cb5d1d06deb70`, and synthetic candidate
`7b6b874cd4df02c01999af4a909a0d670c952122`.

| Required context | Check ID | SHA |
| --- | --- | --- |
| `checks` | 101707883826 | `bce137a6e9c895190eb89fd1cf0d37a7b7ea2eb9` |
| `Codex Review / gate` | 101707974042 | `bce137a6e9c895190eb89fd1cf0d37a7b7ea2eb9` |
| `Auto Merge / eligible` | 101707985180 | `bce137a6e9c895190eb89fd1cf0d37a7b7ea2eb9` |

GitHub Actions enabled native SQUASH at 10:25:49 UTC. At 10:25:58 both custom
checks were observed pending while native auto-merge was enabled. At 10:26:05 the
review gate passed while eligibility remained pending. At 10:26:09 GitHub merged
without manual intervention as `5d3ec2471ce7db414eb60f8d8eaaabbe206a02de`.
All three required contexts ended successful on the same source head. The optional
feedback job then failed because the PR had already merged; that observed race is
fixed by the closed-PR no-op regression and verified in the final test below.

Final [PR #19](https://github.com/dexsword/dextech/pull/19) completed end-to-end in
[run 34111543766](https://github.com/dexsword/dextech/actions/runs/34111543766):
**snapshot, disarm, eligibility, review, auto-merge, publish, and feedback all
succeeded**. Native [CI run 34111542594](https://github.com/dexsword/dextech/actions/runs/34111542594)
also succeeded. The obsolete base review `34111542653` was cancelled. The harness
control code was identical to this PR's implementation (the adapter only selected
its trusted control revision and fixed PR number).

| Required context | Check ID | Source SHA |
| --- | --- | --- |
| `checks` | 101708696333 | `5f79e310733f396716e432a9faa36d63c8e99f25` |
| `Codex Review / gate` | 101708743613 | `5f79e310733f396716e432a9faa36d63c8e99f25` |
| `Auto Merge / eligible` | 101708750781 | `5f79e310733f396716e432a9faa36d63c8e99f25` |

Base was `5d3ec2471ce7db414eb60f8d8eaaabbe206a02de`; synthetic candidate was
`e2143a807c028409cf9d1b2191f459eec140959f`. GitHub Actions enabled native SQUASH at
10:28:34 UTC. Both custom checks were still pending at 10:28:38; all three required
checks were successful at 10:28:53. The whole review workflow completed successfully,
and GitHub merged automatically at **10:29:20 UTC**, producing
`a7902a4b9676bb01af48ab8109d2df3e2a1dcfe7`. No immediate merge endpoint or manual
merge was used. No production/deployment workflow was triggered by these token-
originated test merges. PR #17 remains for manual review; PR #13 was not changed.

Final local validation: clean npm ci, **85 Node tests**, **9 deployment-control
tests**, CI smoke and synthetic health, actionlint, ShellCheck, YAML, JSON Schema,
TOML, JavaScript/Python/shell syntax, and production audit passed. All requested
validators were available. Audit found zero high/critical findings; one existing
low and one moderate advisory remain. Security inspection confirmed base-controlled
automatic execution, exact source/merge/base binding, separate read-only reviewer
and write jobs, no candidate execution with write credentials, no secret-bearing
logs, and no check/approval bypass. GitHub's separate reads and writes remain
non-atomic; exact-head mutation binding and branch protections are still required.

The hotfix's own review also required explicit `actions: read` on snapshot,
publish and auto-merge (their run-ownership REST reads), and removal of the
permanent dispatch override. Both were corrected. The production workflow now
accepts only `pull_request_target` from main, with no alternate control-ref input.
The isolated test adapter alone synthesizes the trusted event for pre-installation
validation; it is never merged into production.

The final base-only version (with explicit Actions read permissions) passed
[run 34113271843](https://github.com/dexsword/dextech/actions/runs/34113271843) for
[PR #20](https://github.com/dexsword/dextech/pull/20). All seven jobs succeeded,
including feedback after the merge. Source was
`f104872fc30022cfb24d2789b4070680ee222ceb`, base
`a7902a4b9676bb01af48ab8109d2df3e2a1dcfe7`, synthetic merge
`ba9bc3871eaf49e1be6a04cd9d09d6ec6beaffdc`. Check IDs were `101714136509`
(`checks`), `101714201415` (`Codex Review / gate`), and `101714211384`
(`Auto Merge / eligible`), all on that source SHA and all successful.
GitHub Actions enabled native SQUASH at **10:49:16 UTC** while the custom checks
were still pending; GitHub automatically merged at **10:49:36 UTC** as
`95d7244c06587e73d8c7a5d8ba4fc381af229392`. This verified the base-only execution path; the final rerun/conversation test
below additionally covers supersession and deferred human review holds. The production workflow has no dispatch path.

Control-change review packets include their unchanged policy, output schema,
configuration and CI dependencies as untrusted data. Unrelated application context
is reserved for application changes. All changed files remain complete before/after
Git blobs; no patch is truncated, no candidate instructions become trusted, and
no candidate scripts are executed. This improves relevance for large control
reviews without changing the confidence threshold or authorization conditions.

Human approval/thread readiness is deliberately not a prerequisite for requesting
native auto-merge: [GitHub's native mechanism](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
waits for all enforced reviews and checks before merging. The controller never
approves a review, dismisses a blocking review, or resolves a thread. This avoids
stranding a passing Codex review when a human approves or resolves a conversation
later (neither event re-runs this workflow). Missing approvals and unresolved
required conversations still block the actual merge under the enforcing ruleset;
Codex failures, CI failures and stale candidates still cannot enable auto-merge.
The live ruleset has no bypass actors.


The final implementation passed [run 34119147421](https://github.com/dexsword/dextech/actions/runs/34119147421)
for [PR #21](https://github.com/dexsword/dextech/pull/21). All seven jobs succeeded.
Source was `acb49fbc9249f964d6172cb09ae80b3133b546f0`, base
`95d7244c06587e73d8c7a5d8ba4fc381af229392`, synthetic merge
`e77408374267032340e7a2a4420e88ccffd59980`.

| Required context | Check ID | Source SHA |
| --- | --- | --- |
| `checks` | 101732849296 | `acb49fbc9249f964d6172cb09ae80b3133b546f0` |
| `Codex Review / gate` | 101733029156 | `acb49fbc9249f964d6172cb09ae80b3133b546f0` |
| `Auto Merge / eligible` | 101733052101 | `acb49fbc9249f964d6172cb09ae80b3133b546f0` |

This test exposed completed-check duplication: older failed custom checks remained
`isRequired: true` alongside newer successful checks. The corrected snapshot first
confirmed pending replacements, then preserved obsolete results under historical
names. Live GraphQL confirmed those historical checks became non-required; only
the current custom checks and native CI remained required. No native check was
changed, no conclusion was fabricated, and no required context was removed.
A low-confidence intermediate review also rejected authorization as designed;
the disposable documentation wording was corrected before the final review.

Native SQUASH was enabled at **11:57:23 UTC** while both custom checks were pending.
By 11:57:47 all required checks passed, but GitHub still blocked merging on a
clearly labelled, intentionally unresolved integration conversation. Only that
test conversation was resolved by the maintainer; the workflow never resolves
threads or approves/dismisses reviews. GitHub then merged automatically at
**11:58:15 UTC**, producing `e47c53f7d370e672661fd3ea83e0ecf241bb0f62`, without
another review run or a manual merge. This verifies the enforced conversation
hold and release. Required approval count is currently zero, so nonzero human
approval requirements rely on GitHub's documented native enforcement and local
contract tests; no settings were changed to simulate them.


## CI waiting and base-retarget follow-up

The controller delegates pending CI to [GitHub native auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request),
removing the ten-minute CI polling cutoff. This is independent of the v1.11
wrapper rollback: the reviewer still has its existing 20-minute job limit, and
merge-candidate discovery retains its bounded metadata retries. A missing native
CI context or API outage still fails closed; this change does not invent results
or automatically retry a failed review.

Local validation on 2026-09-07 passed clean installation, all **89 Node tests**,
**9 deployment tests**, smoke/synthetic health, actionlint, ShellCheck, shell and
JavaScript syntax, YAML, JSON Schema, TOML schema, and Python parsing. Production
audit reported zero high/critical findings (existing one low and one moderate).
New tests cover pending CI without a completion deadline, failure before
publication, base-retarget triggering, ignored edit isolation, and preservation
of the native required check name. The earlier live integration evidence above
predates this follow-up; it does not claim a live retarget or slow-CI experiment.

Validate a harmless eligible PR
with CI still pending when review completes: native squash auto-merge should be
enabled, custom checks should pass on HEAD, and GitHub should retain the CI hold.
Also retarget a harmless PR onto main and confirm both workflows start; a later
title/body edit must start no jobs, cancel no active run, and create no second
required `checks` context.


## App-authenticated native auto-merge and production deployment

The final auto-merge job now mints a short-lived installation token with the
GitHub-owned `actions/create-github-app-token` **v3.2.0**, pinned to
`bcd2ba49218906704ab6c1aa796996da409d3eb1`. It uses the configured numeric App ID
through the release's supported `app-id` input. Only that job references:

| GitHub configuration | Kind | Purpose |
| --- | --- | --- |
| `DEXTECH_MERGE_APP_ID` | Repository variable | Installed GitHub App ID |
| `DEXTECH_MERGE_APP_PRIVATE_KEY` | Repository secret | App signing key; never print or retrieve it |

The App is installed only on `dexsword/dextech` with Contents and Pull requests
read/write. The workflow further scopes its token to that repository and those
two permissions. Default post-job token revocation remains enabled. No App
administration, Actions, Checks, workflow-write, or ruleset-bypass permission is
needed. `GITHUB_TOKEN` in the request job is read-only and supplies the Actions,
required-check, and review-metadata queries. The App token supplies only final
head/base/merge revalidation, `enablePullRequestAutoMerge` with expected HEAD and
SQUASH, and independent confirmation. Existing requests and read-back must name
this App's bot identity; an old `github-actions[bot]` request cannot masquerade as
an App request. There is no token fallback or immediate merge endpoint.

The read-only Codex job, eligibility checks, publication and metadata-only feedback
receive no App credentials. Missing configuration, insufficient App permissions,
wrong identity, stale candidates, or failed token creation fail closed. Existing
stale-request disarming is retained and must also revoke App-created requests.

GitHub suppresses ordinary push workflows originating from `GITHUB_TOKEN`. App-
requested native auto-merges let the resulting main push start the existing
`Deploy production` workflow. That workflow retains push/main and manual dispatch,
exact-SHA testing/audit, the production environment, Tailscale-only SSH, host
verification, backup, health/Calendar checks, rollback, and non-cancelling
production concurrency. No review job directly deploys, dispatches an arbitrary
SHA, or receives production credentials.

For setup, keep the existing three required GitHub Actions contexts, up-to-date
branches, and resolved conversations. Do not give the App bypass access. For a
missing/invalid key, update Settings → Secrets and variables → Actions → Secrets
→ `DEXTECH_MERGE_APP_PRIVATE_KEY`; update the matching App ID under Variables.
For permission rejection, update the App registration's Repository permissions
and accept the installation permission update for dextech. Never paste keys into
PRs, logs, reports, or chat. Rotate by installing a new App key, updating the
secret, verifying an eligible PR, and revoking the old key. To disable, suspend
the installation and disarm pending native requests; human merging and the
existing manual deployment fallback remain available.

This control change remains automatically ineligible. Its installation requires
an explicit maintainer merge decision with required checks enforced. Because
`pull_request_target` reads main, verify the newly installed App path with a fresh,
harmless eligible PR afterward. Capture the review HEAD/merge binding, native
merge actor, resulting squash commit, push-triggered deployment run, and public
release SHA. Confirm delayed CI does not require another review and that token
cleanup does not cancel native auto-merge. Confirm ordinary title/body edits
start no jobs or new review cycles and every required check stays on the source HEAD. Earlier PR #17
and PR18–21 evidence describes the previous token implementation, not this App test.

Sources: [official token action](https://github.com/actions/create-github-app-token/tree/bcd2ba49218906704ab6c1aa796996da409d3eb1),
[GitHub workflow-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
