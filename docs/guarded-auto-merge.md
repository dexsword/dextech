# Guarded auto-merge

CI, a read-only Codex review, and a deterministic path policy guard native squash
auto-merge into `dexsword/dextech:main`. GitHub enforces the required checks,
up-to-date branch, human reviews, and resolved conversations. The controller never
uses an immediate merge endpoint, approves a review, bypasses a rule, or fabricates CI.

The standalone `CI` workflow runs on pull requests and manual dispatch. After a
merge, `Deploy production` validates the exact commit pushed to `main` with the
full test/health-check script and production dependency audit before deployment.
There is no separate main-push CI run duplicating those checks.

## Required checks and migration

The target configuration has **two required contexts**, both sourced from
GitHub Actions (integration ID **15368**):

- `checks`: the existing `CI / checks` job.
- `merge-gate`: the native final job in `Codex Review` (job ID `auto-merge`).

Keep strict up-to-date checks and all existing review/conversation requirements.
Enable repository auto-merge and squash merging. Do not give the merge App bypass
access. The internal preparation, review and feedback jobs need not be separately
required: the final gate validates their relevant prerequisites.

The implementation supports a staged migration. It reads the effective rules
from `GET /repos/dexsword/dextech/rules/branches/main`, rather than a PR input or
an optional repository variable. These configurations are accepted:

| Required contexts (besides `checks`) | Behavior |
| --- | --- |
| `Codex Review / gate` and `Auto Merge / eligible` | Publish legacy checks as well as the native job result. |
| Both legacy checks and `merge-gate` | Publish both while verifying the native gate is enforced. |
| `merge-gate` only | Stop creating/renaming legacy checks; skip the compatibility `publish` job. |

A partial legacy pair, missing gate, unexpected source for the configured gates,
or missing strict policy fails closed. A change in legacy configuration during a
run requires a fresh evaluation. Legacy code remains only for migration and can
be removed in a follow-up after the native-only configuration is verified.

PR #28 exposed why the migration is needed: the two custom results were successful
in the API but the merge box reported them as **Expected**. They were attached to
check suite `92541669805`, while the latest review run `34162055922` belonged to
suite `92542942183`. That association is the suspected cause; an API success alone
is not proof that GitHub accepted a required result.

## Execution and trust boundaries

1. `snapshot` validates the live same-repository PR and current main, verifies
   ownership of the run, and revokes any previous native auto-merge request.
   It records the source, base and synthetic merge commit. In migration mode it
   also creates pending legacy checks. It never writes the native gate.
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
   independently confirmed App request. For a protected change or draft, it
   instead requires the request step to be skipped and auto-merge to be absent.
   Its exit status determines the gate result; GitHub completes the native check
   after all job steps and token cleanup finish.
6. During migration only, `publish` releases the legacy checks after the native
   gate succeeds. Ineligible changes have a neutral legacy eligibility result.
   The optional `feedback` job manages one metadata-only review comment and
   tolerates a PR merging before it runs.

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
current run. The compatibility publisher alone may read the just-completed native
gate after the final job has succeeded.

CI must exist on the source head and be successful or in a recognized pending
state. Missing, failed, cancelled, skipped, neutral or malformed CI is rejected.
The controller rejects competing checks/statuses on the synthetic merge commit;
it never copies native CI results to another SHA. GitHub itself waits for pending
CI and required human reviews/conversations, without a local CI deadline.

Per-PR concurrency cancels obsolete runs. Run ownership rejects cancelled runs,
replaced attempts, and runs superseded by a newer relevant PR event. Closed PRs
revoke stale requests without review. Title/body-only edits use separate ignored
concurrency groups and a different gate job name (`Inactive PR event`), so they
cannot cancel a review or satisfy `merge-gate` through a skipped job. Base-retarget
edits start both CI and review. There are no check/status triggers or production
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

## Rollout and validation

1. Review and merge the implementation with the existing protections intact.
   `pull_request_target` uses main, so its own PR still runs the old controller;
   its green review is not a live test of the new gate.
2. Open a fresh harmless PR from the updated main. Verify the native gate's
   current run/attempt, suite, source SHA and result in both API and merge box.
   Exercise another review run on the **same source SHA**, and a new push during
   review. A deliberate required conversation can hold the live test open until
   the checks and token cleanup are inspected.
3. Add `merge-gate` (source GitHub Actions) to the existing required checks. Verify
   that GitHub recognizes its result as required. Test failed review/CI and an
   ineligible change; the former must block and the latter must stay manual.
4. Replace the two legacy requirements with `merge-gate`, keeping `checks`,
   strict updates and review/conversation settings. Start a fresh evaluation;
   verify no new legacy check runs are created and `publish` is skipped.
5. Resolve any deliberately created test hold, then verify an eligible PR really
   squash-merges as the App, the production workflow receives the resulting SHA,
   and deployment passes its own gates. Green API results alone are insufficient.
6. Update PR #28 with the new main and let its changed source be reviewed again.

Do not drop the legacy requirements before the native gate is available and
recognized. If native validation fails, keep the protections and diagnose the
failed gate; do not manufacture passing results or weaken the ruleset. Restore
the legacy pair alongside the native requirement and use a fresh run if a
migration rollback is needed.

Local regression tests cover failure/skipped prerequisites, native-only and
bridged configurations, stale source/base/merge, wrong suite/run/attempt,
missing current checks despite older successes, App confirmation, and manual
eligibility. They do not prove GitHub's live merge acceptance. Historical App
merge/deployment-trigger evidence is available in
[PR #24](https://github.com/dexsword/dextech/pull/24) and the read-only
`scripts/verify-merge-app-live.cjs`; it predates the native gate migration.
