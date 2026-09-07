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
4. The write job waits at most ten minutes for native CI readiness, rechecking
   candidate/run ownership on every poll. It then independently validates review
   schema/confidence, eligibility, both pending checks and their ownership,
   current head/base/merge, native CI success, required-check source/placement,
   repository auto-merge/squash settings, approvals, and resolved review threads.
   Immediately before mutation it re-reads the PR; GitHub's `expectedHeadOid`
   atomically binds the native request to the reviewed head.
5. Request **native squash auto-merge while custom checks are pending**. Confirm
   the response and a fresh independent live read. Only then may `publish` release
   the custom checks, revalidating candidate, prerequisites, and run/check ownership
   before each update. GitHub performs the merge when its rules are satisfied.
6. Ineligible protected changes remain for manual review: eligibility is neutral,
   not an ordinary CI failure. Codex must still pass. Feedback is a single managed
   comment containing only fixed text, severity counts, bounded confidence, and
   reviewed SHA; all model filenames/explanations/summaries are withheld.

Per-PR concurrency has `cancel-in-progress: true`. Only opened, synchronize,
reopened, ready-for-review, converted-to-draft, and closed events are automatic;
there is no broad edited, status, check-run, or check-suite trigger. Updating the
managed comment or checks cannot trigger another review. A rerun resets/reclaims
the same candidate's checks and changes their run/attempt ownership. Old runs,
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
Pinned release: **v1.12**, commit
`86365089eb2b84e0a8fb0717b304f8bdcb13b20e`; Codex CLI **0.153.4**.
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

`workflow_dispatch` accepts only a canonical PR number. A maintainer explicitly
selects the **trusted workflow ref**; the immutable triggering SHA supplies control
code to every privileged job. The input selects PR data, never executable code or
a control SHA. Use main normally. Before installation, a maintainer can select the
reviewed hotfix branch to test that exact implementation against a disposable
same-repository PR targeting main. This is an explicit trust decision: never
select an unreviewed contributor branch. Dispatch requires repository write
access; no public PR event can select this override. API-key access retains the
live same-repository guard. Main and candidate ancestry remain independently
validated even when the selected control revision is the hotfix.

For a first live test, push a harmless documentation commit to a disposable branch
from current main and open a PR. Let native CI start normally. Dispatch the vetted
control ref with that PR number; its matching concurrency group replaces any old
base-controlled review. Record head/base/merge and run IDs. Push a second harmless
commit to verify stale-run cancellation, then dispatch the vetted control again.
Check that only the intended CI and review runs started, every required check is
on the latest head and marked required, the old run cannot authorize, native
squash is enabled before check success, and GitHub merges without intervention.
Do not manually publish checks, bypass requirements, or merge PR #17 to test it.
After installing the tested hotfix, synchronize PR #13 with current main for a
fresh automatic evaluation; that synchronization is a separate operation.

The default GITHUB_TOKEN suppresses downstream workflow events caused by its
merge. This test must not deploy production; production workflow dispatch remains
a separately authorized action. No reusable merge token is introduced here.

Fixed diagnostic categories include stale head/base, stale/unavailable merge,
merge discovery timeout, required CI not successful, unresolved approval/thread,
superseded/cancelled run, permission/settings rejection, immediately mergeable,
invalid review/eligibility, non-pending checks, unavailable auto-merge, and
unexpected response. Raw API/error/model bodies and credentials are never logged.
