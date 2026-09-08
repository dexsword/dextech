# Guarded auto-merge

CI, a read-only Codex review, and a deterministic path policy guard native squash
auto-merge into `dexsword/dextech:main`. GitHub enforces the required checks,
up-to-date branch, human reviews, and resolved conversations. The controller never
uses an immediate merge endpoint, approves a review, bypasses a rule, or fabricates CI.

The standalone `CI` workflow runs on pull requests and manual dispatch. After a
merge, `Deploy production` validates the exact commit pushed to `main` with the
full test/health-check script and production dependency audit before deployment.
There is no separate main-push CI run duplicating those checks.

## Required checks

The final configuration has **two required contexts**, both sourced from
GitHub Actions (integration ID **15368**):

- `checks`: the existing `CI / checks` job.
- `merge-gate`: the native final job in `Codex Review` (job ID `auto-merge`).

Keep strict up-to-date checks and all existing review/conversation requirements.
Enable repository auto-merge and squash merging. Do not give the merge App bypass
access. The internal preparation, review and feedback jobs need not be separately
required: the final gate validates their relevant prerequisites.

The controller reads effective branch rules from
`GET /repos/dexsword/dextech/rules/branches/main`. It requires each native context
exactly once with the GitHub Actions source and strict updates. Missing,
duplicate, wrong-source, or still-required legacy contexts fail closed.

The legacy `Codex Review / gate` and `Auto Merge / eligible` contexts are retired.
There is no compatibility publisher, custom-check creation/renaming, or
`checks: write` permission in this workflow. GitHub alone completes the native
job check. Historical results can remain attached to older runs; they are not
required by the final ruleset.

PR #28 exposed why the migration is needed: the two custom results were successful
in the API but the merge box reported them as **Expected**. They were attached to
check suite `92541669805`, while the latest review run `34162055922` belonged to
suite `92542942183`. That association is the suspected cause; an API success alone
is not proof that GitHub accepted a required result.

## Execution and trust boundaries

1. `snapshot` validates the live same-repository PR, verifies ownership of the
   run, and revokes any previous native auto-merge request. Draft events stop
   here with `active=false`; they need no merge candidate or up-to-date base.
   Ready PRs additionally validate current main and record source, base and
   synthetic merge commits. Snapshot never writes a check result.
2. `disarm` independently verifies revocation. `eligibility` classifies exact Git
   objects against the trusted allowlist, and `review` supplies complete before/
   after text to Codex as untrusted data. Neither executes candidate scripts.
3. The native `merge-gate` job runs with `always()` after those prerequisites.
   A failed, cancelled, missing or unexpectedly skipped prerequisite causes an
   explicit failure; it cannot turn into a skipped successful required gate.
4. `gate-prepare` validates the schema, passing verdict, confidence, eligibility,
   current candidate, CI and native job identity. Only an eligible, ready PR
   proceeds to token creation and `enablePullRequestAutoMerge` with SQUASH and
   `expectedHeadOid`. The native gate is **already running** during this request.
5. `gate-finish`, using only the read token, revalidates the candidate and the
   independently confirmed App request. For a protected change, it
   instead requires the request step to be skipped and auto-merge to be absent.
   Its exit status determines the gate result; GitHub completes the native check
   after all job steps and token cleanup finish.
6. After the gate, the optional `feedback` job manages one metadata-only review
   comment and tolerates a PR merging before it runs.

Draft opening, pushes and reopening still run ordinary CI. The Codex workflow
only performs draft cleanup: it does not classify files, run the AI reviewer,
mint an App token, or publish passing gates. Converting a ready PR to draft uses
the same per-PR concurrency group to cancel obsolete work, and snapshot revokes
the previous auto-merge request even if the draft is behind main or conflicted.
Failed revocation remains a failed cleanup run.

Draft events exclude the required `merge-gate` job and use a separate display
name, so a skipped draft job cannot satisfy the native requirement. Cleanup
never writes a successful or neutral check. A `ready_for_review` event starts a
fresh full evaluation, even on the same source SHA. A delayed draft event cannot
start AI review if the PR has since become ready, and a ready-event run that
finds a live draft cannot authorize auto-merge. Ordinary PR CI still runs on drafts.

The reviewer receives only `contents: read` and `OPENAI_API_KEY`. The pinned
`openai/codex-action` is its last substantive step, with read-only sandboxing and
`drop-sudo`. Workflow, prompt, schema, policy and control code come from the
trusted base via `pull_request_target`. Candidate instructions/configuration,
filenames, commits and PR text are data. Candidate checkouts fetch full history
without tags or persistent credentials. Forks cannot reach the reviewer or App.

The review must match the shared JSON Schema, have confidence at least **0.95**,
a `pass` verdict and no blocking findings. Missing output, invalid JSON, action
failure or low confidence fails the gate. Raw model text and API/error bodies
are not logged or published; feedback uses only fixed prose, counts, confidence
and the reviewed SHA.

The allowlist in `.github/codex/policy.cjs` rejects unknown paths and file modes.
Workflow/review controls, AGENTS, deployment, auth, credentials, database,
Calendar, payment and admin changes remain manual. Ordinary UI/content, selected
docs and tests, and tightly constrained dev-only patch lockfile updates may
qualify. This workflow change is itself ineligible for automatic merging.

## Source and run identity

`HEAD_SHA` is the exact reviewed source and native `expectedHeadOid`. `BASE_SHA`
must remain current main, and the source must descend from it. `MERGE_SHA` is
GitHub's current synthetic candidate, whose ordered parents must be
`[BASE_SHA, HEAD_SHA]`. A changed binding requires another evaluation.

The gate discovers its own check through the jobs endpoint for the **current run
attempt**. It requires one `merge-gate` job with the correct run, attempt, source
SHA, running state and null conclusion. Its check must come from GitHub Actions
and belong to this run's check suite. The GraphQL rollup must contain that exact
check ID. A successful same-name check in an older suite cannot authorize the
current run. The authorization code accepts only its own running native check;
GitHub owns completion of that check.

CI must exist on the source head and be successful or in a recognized pending
state. Missing, failed, cancelled, skipped, neutral or malformed CI is rejected.
The controller rejects competing checks/statuses on the synthetic merge commit;
it never copies native CI results to another SHA. GitHub itself waits for pending
CI and required human reviews/conversations, without a local CI deadline.

Per-PR concurrency cancels obsolete runs. Run ownership rejects cancelled runs,
replaced attempts, and runs superseded by a newer relevant PR event. Closing or
merging a PR does not trigger another review workflow, so it cannot cancel or
supersede the final jobs of the review that authorized the merge. Closed events
from older workflow revisions return inactive before candidate validation or API
access; they cannot rewrite checks or fail because main advanced at merge.
Reopening runs a fresh snapshot and revokes stale auto-merge requests before
review. All ready PR edits, including title/body changes and base retargets, start
both CI and review in the normal per-PR concurrency groups. Each subscribed event
must produce the real required check names; alternate-name skipped jobs can leave
GitHub reporting a blocked PR despite older passing results. Edits therefore cost
a fresh evaluation, while draft edits still defer AI review. This avoids relying
on the mergeability of an older check suite. Closed events remain excluded. There are no check/status triggers or production
workflow-dispatch overrides in the review workflow.

API reads and writes are not atomic. Repeated identity checks supplement the
atomic expected-head mutation, native job state, concurrency, and strict branch
protection; they do not replace GitHub's enforcement.

## App and deployment configuration

| Setting | Kind | Recipient |
| --- | --- | --- |
| `OPENAI_API_KEY` | Actions secret | Read-only Codex review job |
| `DEXTECH_MERGE_APP_ID` | Actions variable | Final authorization job |
| `DEXTECH_MERGE_APP_PRIVATE_KEY` | Actions secret | Pinned token action in final authorization job |

Only the final authorization job can mint the App token, and only after the
eligibility/review checks pass. The token is restricted to this repository and
Contents/Pull requests write permissions, with default post-job revocation.
`GITHUB_TOKEN` in that job is read-only. Only the request step receives the App
token; final validation receives the read token. There is no token fallback.
Never print, retrieve into reports, or commit keys.

App-requested merges generate the main push that starts the existing production
deployment workflow. That workflow retains its exact-SHA testing and audit,
production environment, Tailscale-only SSH, host verification, backup, health/
Calendar checks, rollback, and non-cancelling production concurrency. Installing
this control change and testing an actual auto-merge can therefore deploy main.
No review job directly dispatches or performs deployment.

To stop automatic merging, disable repository auto-merge and disarm pending
requests while retaining required checks. To rotate the App key, update the
Actions secret, validate the installation, then revoke the old key. Missing or
invalid configuration fails closed.

## Agent PR workflow

Agents working on an authorized task should create a branch in this repository,
keep it current with main, and open a PR. Use draft status while the work is
incomplete, then mark it ready. No agent-specific label or manual auto-merge click
is needed for an eligible ready PR: the trusted controller reviews the exact
commit, checks the allowlist and CI, and requests squash auto-merge as the App.
A resulting main push starts the production workflow, which independently tests,
audits and deploys that exact merged commit.

Changes outside the allowlist still run CI and review, but remain manual. This
includes server/backend, workflow/policy, deployment, authentication, database,
Calendar and payment changes. A passing review does not override that policy.
Agents should address failed checks or review findings and push the correction;
a changed commit receives a fresh evaluation. If main advances, update the branch
and let CI/review run again. This preserves strict exact-base validation for a
team whose PRs may merge in sequence.

## Rollout and acceptance

The owner completed the ruleset switch on 2026-09-08. A subsequent read of the
effective rules is committed in
[the rules snapshot](evidence/native-only-rules-2026-09-08.json): `checks` and
`merge-gate` are the only required contexts, both use integration 15368, strict
updates remain enabled, and resolved conversations remain required. A regression
test passes this actual response through the new controller's configuration
validator. This is a dated observation, not an authorization artifact; every
ready run still reads and validates the live API response. Recheck the endpoint
before merging if repository settings change.

PR #36's required `checks` job additionally runs `control.cjs verify-rules`
against the live API using the candidate's native-only validator and the built-in
read-only token, before dependency installation. The cleanup therefore cannot
pass its required CI with legacy requirements still configured. This one-time
installation check is scoped to same-repository PR #36; later reviews validate
live rules in their trusted controller. No operator credentials or merge App
token are involved. Settings can change after a check; rerun required CI if they do.

The staged native-gate enforcement evidence is recorded in
[PR #35](https://github.com/dexsword/dextech/pull/35). Retire the legacy requirements
only after the native gate is recognized and its failure enforcement is verified.
Before installing this cleanup, configure exactly `checks` and `merge-gate` from
GitHub Actions and run a fresh evaluation using the existing migration-capable
controller. Preserve strict updates, review/conversation settings and App identity.

Then merge the cleanup after review. Its own PR still runs the previous trusted
base controller; local tests validate the new code, while subsequent PRs exercise
it live. Verify that the workflow no longer has a compatibility publisher or any
check-writing job. Use a fresh eligible PR to confirm all of the following:

1. The current native gate is required and bound to the reviewed source/run.
2. No new legacy check runs are created.
3. The App requests native squash auto-merge and performs the merge after checks.
4. The production workflow receives the resulting main SHA and passes its own
   tests, audit and deployment acceptance checks.
5. The closed PR does not start a redundant review workflow.

If a run fails, preserve protections and investigate. Prefer a full review
workflow rerun so all prerequisites are freshly evaluated. Do not manufacture
successful checks or use administrator bypass as a test. This controller no
longer supports the legacy requirements; rolling back to those requirements
would also require restoring a reviewed migration-capable controller.

Local tests retain current-run/attempt/suite binding, stale-candidate rejection,
review/schema checks, draft lifecycle, failed CI, App confirmation, credential
boundaries, and manual eligibility. Tests of retired custom-check publication are
removed with that implementation. Local tests alone do not prove GitHub merge
acceptance or production deployment; retain the corresponding live run evidence.
