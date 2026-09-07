# Guarded PR auto-merge — Phase 1

This policy reviews same-repository PRs targeting `dexsword/dextech:main` and
requests **native GitHub squash auto-merge** only for eligible, reviewed heads.
It does not merge through an immediate merge endpoint, approve a PR, dismiss a
check, or bypass branch protection. Installing these files does not configure
GitHub settings or secrets. This implementation PR itself is ineligible.

## Required setup by Will

1. Manually review and install this policy on `main`. `pull_request_target`
   deliberately uses the base workflow, so a PR cannot bootstrap its own trusted
   review. Keep the existing manual approval requirement during installation and
   first-run validation. A human merge to `main` also triggers the existing
   production deployment workflow; plan that separately.
2. Add an Actions **repository secret** named `OPENAI_API_KEY`, or an organization
   secret restricted to this repository. Use a dedicated, budget-limited OpenAI
   project key with permission to call the Responses API/model. Never put the key
   in a variable, file, comment, job log, artifact, or the `production` environment.
   The review job does not use the production environment or its credentials.
   This change does not create, read, or verify that secret.
3. Protect `main`: require pull requests, retain all existing required approvals,
   security checks, and conversation requirements; dismiss stale approvals;
   require approval of the most recent reviewable push; **require branches to be
   up to date before merging**; disallow force pushes/deletion and protection
   bypasses (including administrator bypass where supported).
4. Require the following exact check-run names, with **GitHub Actions** as their
   expected source. Select them after the first trusted run registers them:

   | Required check-run name | Meaning |
   | --- | --- |
   | `checks` | Existing `CI / checks`: complete deterministic tests, CI smoke/syntax/tracked-file checks, plus production dependency audit |
   | `Codex Review / gate` | Exact-head, schema-validated review and successful revocation of any earlier auto-merge request |
   | `Auto Merge / eligible` | Classification completed; success means eligible, neutral means manual review |

   Keep other existing requirements. Do not require `deploy` (a post-merge job),
   `auto-merge`, or every job in the target workflow. The two explicitly named
   checks are created **on GitHub’s synthetic PR merge SHA**, alongside `CI / checks`.
   The reviewed source head remains separately bound; the target workflow’s base
   SHA is never used as the check destination.
   GitHub accepts a neutral required check for manual merging. The requester
   additionally demands actual eligibility `true` and a **success** conclusion.
5. Enable repository **Allow squash merging** and **Allow auto-merge**. Confirm
   organization/repository Actions policy allows the pinned official actions and
   the explicitly declared job permissions. Do not grant workflow approval
   permission, bypass rights, or a broadly privileged PAT. Leave all production,
   SSH, Tailscale and deployment configuration unchanged.

Configuration is part of enforcement: code cannot install branch protection.
The required checks must exist before enabling unattended operation. Do not use
merge queues in Phase 1: `merge_group` candidates are not implemented.

## Trust boundary and permissions

The trigger is `pull_request_target` for opened, synchronized, reopened, edited,
ready-for-review and converted-to-draft PRs against `main`. There are no path
filters. The job guard and live API snapshot both require head and base repository
exactly `dexsword/dextech`. Forks receive neither review credentials nor an
auto-merge request. Their required review check will remain unavailable; bringing
a vetted contribution onto a same-repository branch is a separate maintainer
operation. Drafts can be reviewed but cannot be enabled for auto-merge.

All executable control code, JSON Schema, model configuration and review rules
come from the exact base SHA. Candidate checkout uses the exact head SHA and
`persist-credentials: false`. It must contain the current base as an ancestor;
otherwise update the branch and rerun. No candidate dependency installation,
build, test, script, hook, Git text conversion, or source instruction runs in the
privileged review workflow. Existing ordinary CI runs independently without the
OpenAI key. CI now includes `npm audit --omit=dev --audit-level=high`, so high or
critical production findings block its required check before merge.

Git object readers use literal paths, disable external diffs/text conversion and
hooks, reject special file types, and bound input. They supply complete changed
text before/after plus relevant application/test context. The model works in a
clean temporary directory outside either checkout, with trusted isolated config,
project instruction discovery disabled, shell/execution/browser/plugin/agent
features disabled, no additional MCP servers and `web_search = "disabled"`.
All PR text and source are untrusted data, including edits to `AGENTS.md`.
Only the base's `Code Review Rules` become review instructions.

The review job has **only `contents: read`** and the single OpenAI API key input.
The official action retains `safety-strategy: drop-sudo` plus `sandbox: read-only`
on a fresh GitHub-hosted Ubuntu runner. Its protected Responses proxy is the
necessary model network path; no network or shell tool is exposed to the model.
The action is the final substantive step. Never run its privilege-dropping setup
on DexServe or another persistent/self-hosted production runner.

Separate fresh jobs create/publish checks (`contents: read`, `checks: write`).
The order is deliberately:

1. `snapshot` captures the reviewed `HEAD_SHA`, trusted `BASE_SHA`, and current
   synthetic `MERGE_SHA`, verifies the merge ref/parents, and creates both custom
   checks **in progress on `MERGE_SHA`**.
2. `disarm` revokes any earlier native request before `eligibility` and `review`
   evaluate the captured candidate. It has `contents: write`, `pull-requests: write`
   solely to disable stale requests. Failure blocks evaluation/publication.
3. `eligibility` and the read-only `review` run. Ordinary deterministic CI continues
   independently; GitHub must still enforce its required `checks` result.
4. For eligible non-draft PRs, `auto-merge` validates the structured review again
   (confidence >= 0.95, no blocking findings, successful review/disarming and
   eligibility). It checks both custom checks are still **in progress** with null
   conclusions and this run's IDs/head/merge/base/attempt binding, then revalidates
   current main, GitHub's merge ref and parents, and the open, non-draft,
   same-repository PR immediately before the mutation.
5. While the checks remain pending, it requests `enablePullRequestAutoMerge` with
   `expectedHeadOid` and `mergeMethod: SQUASH`. It validates the mutation response's
   PR ID, source head and method, then independently reads back current main,
   merge ref/parents and PR to confirm the same merge candidate is still current
   and native squash auto-merge is enabled. An already-enabled matching squash
   request uses the same checks/read-back without another mutation; another method
   or a stale candidate fails closed.
6. Only after the request job succeeds does `publish` validate its head/merge/base/run
   confirmation, reread live PR/main/merge and the enabled squash request, validate
   the review, and revalidate both source and merge SHAs immediately
   before each check update. It completes `Codex Review / gate` and
   `Auto Merge / eligible` successfully. GitHub can then observe the completed
   requirements and merge when every configured protection/approval permits it.

The request job has `contents: write`, `pull-requests: write`, `checks: read`;
it cannot complete checks. It receives structured review data for validation,
but no OpenAI key, deployment credentials, or candidate checkout. The publisher
cannot request a merge. Codex remains the final substantive step of its read-only
job; no PR-controlled code executes in either write job. Native auto-merge is
requested **before** successful required checks, because GitHub may reject enabling
it on a PR that is already immediately mergeable. No immediate merge fallback exists.

Failure to request or confirm auto-merge leaves both authorization checks pending
or failed, never successful. Cancellation or failure before publication leaves
pending checks; rerun the complete trusted workflow to recover. Confirmation is
bound to the workflow run/attempt, captured head, merge and base, never just a boolean.
If publication is interrupted after one check succeeds, the other remains pending
and still blocks merging. GitHub offers no transaction across the two check writes.
Strict up-to-date protection remains required: the head precondition is atomic,
but reading main/the merge candidate and publishing checks are separate API operations.

Ineligible changes skip the request job: a valid review gets a successful gate and
**neutral** eligibility for manual review. Drafts also skip requesting auto-merge;
a valid draft review can complete its checks, but marking it ready triggers a new
run. A changed ready/draft state fails closed if it no longer matches the skipped
request path. This hotfix changes protected control/workflow paths and is itself
ineligible; it requires manual review and manual squash merge.

Failures emit only fixed diagnostic categories: `permission-or-repository-setting-rejection`,
`pr-already-immediately-mergeable`, `stale-head-or-base`, `stale-or-unavailable-merge-candidate`, `draft-or-closed-pr`,
`auto-merge-unavailable`, `unexpected-github-response`, `invalid-review-or-eligibility`,
or `required-checks-not-pending`. API status/known error patterns select these
trusted strings; raw response bodies, exception text and model output are never
included in diagnostics. Unknown failures use `unexpected-github-response`.


## Source-head and merge-candidate bindings

`HEAD_SHA` is the exact immutable source commit checked out with full history,
classified and reviewed by Codex. `MERGE_SHA` is GitHub's current synthetic
`refs/pull/<number>/merge` commit, captured from the live open PR's
`merge_commit_sha` after `mergeable` is explicitly true. `BASE_SHA` remains the
captured main commit controlling the workflow, policy and review instructions.

GitHub's [required-check troubleshooting documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#conflicts-between-head-commit-and-test-merge-commit)
says merge-commit results take precedence when that commit has a status; otherwise
head results apply. Executing CI against a synthetic merge checkout does not by
itself prove that its check run is attached to that SHA. The proposed implementation
publishes both custom checks with `head_sha: MERGE_SHA`, binding run, attempt,
source head, merge and base. This placement still needs end-to-end verification
alongside the actual CI check placement; see the live evidence below.

Snapshot capture, native request, request confirmation and final check publication
verify the live merge ref and its two parents (captured base first, source head
second), plus current PR head/base/merge metadata. Check IDs must point to that
same merge SHA. The existing ancestry gate still requires base to be an ancestor
of the reviewed source head. No synthetic-merge scripts are executed: candidate
checkout stays on `HEAD_SHA`, and `expectedHeadOid` still uses `HEAD_SHA`.

Initial snapshot discovery retries GitHub's transient `mergeable: null`, missing
merge SHA, and HTTP 404 for the merge ref/commit, with backoff of 1, 2, 4, 8, 15,
and 30 seconds (seven attempts, 60 seconds of waiting). Every attempt rechecks the
captured source head and current main base; neither binding can change. No check
is created until the merge ref, ordered parents, and final PR read validate.
Confirmed conflicts, malformed metadata, inconsistent parents, permission failures,
and head/base changes stop immediately. The existing five-minute snapshot job
limit and 20-second request timeout also bound API delays. Exhaustion reports only
`merge-candidate-discovery-timeout`; prolonged unavailability requires a fresh run.

Once discovery succeeds, the merge SHA is frozen. Later unknown mergeability,
an absent merge ref, inconsistent parents, or any head/base/merge change fails closed. Never substitute the source head for a missing
merge candidate, reuse an old merge receipt, or silently recapture a different
candidate mid-run. Start a fresh trusted run once GitHub has a valid candidate.
GitHub has no atomic merge-candidate precondition on enable-auto-merge/check writes;
the immediate revalidation and required up-to-date ruleset remain authoritative.

## Live GitHub verification and unresolved placement risk

Read-only checks on 2026-09-07 at 10:01 UTC used authenticated local `gh` against
GitHub's real REST API, independently of the unit-test mocks. No check/status,
auto-merge request, workflow run, ruleset, PR #13 update, or merge was created.
The following immutable observations describe that time, not future PR heads:

| PR | Source head | Synthetic merge |
| --- | --- | --- |
| #13 | `6afedeb8efc034f778e93bd133ce9dd1451bb567` | `9c19711cb0c85c409a7d62574d240c01491190d4` |
| #17 | `0b2e11fc4ee3529b5cbbaa5c7e1f3c5bffae2a22` | `9c8af51bcc850f3214f31e7a581916fea6dd13bd` |

For both PRs, `GET /repos/dexsword/dextech/git/ref/pull/<number>/merge` and
`GET /repos/dexsword/dextech/git/commits/<merge_sha>` succeeded. The ref, commit,
and live PR merge SHA agreed. Each commit had exactly two ordered parents:
current main `03aafa3b87b2dbe6f9c0808ae46cb5d1d06deb70`, then the source head.
A second PR read confirmed unchanged head/base/merge bindings. This verifies
endpoint availability and parent shape with the local CLI identity, not the
permissions of a future Actions token.

Crucially, `GET /repos/dexsword/dextech/commits/<sha>/check-runs` showed the
successful CI `checks` result on each **source head**, not its merge SHA.
Check IDs were `101688378569` (#13) and `101698936565` (#17). Their check suites
also named the source head; their CI runs were [34105159618](https://github.com/dexsword/dextech/actions/runs/34105159618)
and [34108484917](https://github.com/dexsword/dextech/actions/runs/34108484917), both
`pull_request` runs. Both synthetic merge SHAs had zero check runs and zero legacy
statuses. The three required contexts were `checks`, `Codex Review / gate`, and
`Auto Merge / eligible`, all bound to integration ID 15368 (GitHub Actions), with
strict up-to-date checking enabled in the effective main rules.

These observations do **not** establish the earlier claim that CI already reports
on the merge SHA. Moving only the custom checks could create a split with CI and
leave a required check waiting. Do not treat this PR as verified for installation
on the strength of mocks or endpoint availability alone. The repository-wide
placement change remains unresolved pending a controlled integration experiment
that demonstrates all three required checks are recognized together. Such an
experiment must use an explicitly authorized isolated test repository or otherwise
approved setup; do not manufacture production authorization checks or weaken the
live ruleset to test it. Native auto-merge/check-write behavior was not exercised
by this read-only verification. Existing first-run instructions are conditional on
resolving this risk; do not synchronize PR #13 as part of this investigation.

To repeat the read-only verification, read the live PR and main ref, resolve the
merge ref and ordered parents, list check runs and legacy statuses separately for
head and merge, and re-read the PR to reject changing bindings. Inspect only SHA,
check ID/name/state/app, and rules metadata; never publish raw response bodies or
review output. GitHub documents mergeability's asynchronous calculation in
[Get a pull request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).

## Review decision and eligibility

The shared JSON Schema requires `verdict`, numeric `confidence` in `[0, 1]`,
`blocking_findings`, and `summary`, with no unknown fields. Findings require
severity `P0`–`P3`, file, nullable positive line bounds and an explanation.
The publisher independently validates that schema with a small dependency-free
validator that rejects unsupported schema keywords. Passing requires verdict
`pass`, **confidence >= 0.95**, **zero blocking findings**, successful action/job
completion and successful revocation. Eligible ready PRs also require confirmed
native squash auto-merge before successful checks. Every P0/P1 finding therefore fails, as do
other blocking findings. Prose is never parsed as approval. Empty/malformed or
masked/missing output, API/action error, timeout, and low confidence fail closed.
Cancelled runs can leave an in-progress check, which also blocks merging; rerun
the entire trusted workflow to recover. No `continue-on-error` path passes review.

Valid structured failures with confidence >= 0.95 and blocking findings create or
update one managed PR comment bound to the exact reviewed head. An independent
output allowlist permits only fixed status text, counts by schema-validated
severity, bounded numeric confidence and the validated snapshot SHA. Model-supplied
filenames, line locations, explanations and summaries are never published.
Formatting sanitization and secret-pattern matching cannot establish that arbitrary
model text is safe: it may quote credentials, customer/Calendar data or exceptions.
The comment deliberately withholds that text rather than attempting redaction.
A later clean high-confidence exact-head review updates the same comment to
resolved. Malformed, missing, low-confidence or otherwise nonactionable output
creates no comment. The feedback job is separate from the read-only reviewer and
has only `contents: read` plus `pull-requests: write`. Comment discovery searches
all pages (up to 10,000 comments); duplicate managed comments or an incomplete
search fail closed. The PR head is rechecked immediately before writing. GitHub
comment writes have no atomic head precondition, so feedback always labels the
reviewed SHA and never authorizes a merge.

Classification is deterministic, case-sensitive for the allowlist, with explicit
case-insensitive sensitive-name exclusions. Both sides of renames and deletions
are evaluated. Executable file modes, symlinks and submodules are ineligible.

- All `.github/**`, `ops/**`, `scripts/**`, `AGENTS.md` at any depth, review and
  auto-merge controls/tests, and deployment/rollback paths are manual-only.
- Authentication, authorization, OAuth, secret/env loading, credentials,
  sessions/tokens/permissions, database/schema/migration/destructive operations,
  backup/restore, payment and Calendar names are excluded. `server.js` is entirely
  excluded because those responsibilities share one file. `gcal-auth.js`,
  `stripe-import.js`, `admin.html` and `cancel.html` are also manual-only.
- The root UI/content allowlist is `index.html`, `support.html`, `privacy.html`,
  `terms.html`, `style.css`, `script.js`, `tests.js`, `README.md`. Ordinary
  `docs/**/*.md`/`.txt` and `test/*.test.js` names are eligible only if they do not
  match a protected name. Unknown namespaces, unusual characters and ambiguous
  paths are manual-only. New code namespaces require a reviewed policy update.
- Dependency eligibility is deliberately narrow: **only `package-lock.json`**,
  lockfile v3, 1–10 existing dev-only package patch upgrades, same major/minor,
  registry.npmjs.org tarballs with SHA-512 integrity, no lifecycle-script packages,
  sensitive package names, changed dependency ranges/metadata, new/deleted packages
  or runtime changes. Manifest changes and other dependency updates are manual-only.

An ineligible PR gets a **neutral** eligibility result and no auto-merge request;
it can be merged manually after review and every required protection passes.
Eligibility is not evidence of correctness: the model must still identify new
sensitive behavior or defects introduced under an otherwise ordinary filename.

## Pins and operational limits

- Official [`openai/codex-action` release tag `v1.12`](https://github.com/openai/codex-action/tree/v1.12):
  **`86365089eb2b84e0a8fb0717b304f8bdcb13b20e`**. This upstream version is an
  annotated release tag; upstream has no separate GitHub Release object for it.
- Codex CLI and Responses proxy: **`0.153.4`**, explicitly pinned by action input.
  Trusted configuration selects **`gpt-5.4`**, high reasoning effort. Account/model
  availability must be verified during first run; unavailability fails closed.
- `actions/checkout` **v6.0.2**, `de0fac2e4500dabe0009e67214ff5f5447ce83dd`.
- Existing CI `actions/setup-node` **v6.3.0**, `53b83947a5a98c8d113130e565377fae1a50d02f`.

Review limit: 100 changed paths, 220,000 bytes per text blob, 600,000 bytes in the
complete prompt, 32,000 bytes in the verdict, 30 findings and 20 minutes for the
review job. No silent truncation. Binary/unsupported or larger changes fail the
review gate and require a separately designed review path; eligibility alone
never overrides an incomplete review. Full reviews rerun on relevant PR events,
including edits, so **OpenAI API usage is billable and can accumulate**. Set project
budgets/alerts and monitor usage. Confidence is a model judgment, not a calibrated
probability or substitute for tests/human approvals.

Custom check summaries contain only sanitized metadata; raw model text is not
copied to check summaries, comments or uploaded artifacts. Managed comments use
only the explicitly allowlisted metadata described above; no model free text. The
upstream action and Actions output/environment plumbing can put review text in
Actions logs. Only public repository source is sent;
do not commit sensitive information or enable debug tracing. Existing GitHub log
retention/access controls apply. Temporary review files remain only on disposable
runners. Production, SSH, Tailscale and Calendar credentials are never supplied.

## Important limitations before enabling unattended operation

- GitHub settings remain authoritative and must be configured by Will. This task
  neither changes them nor proves the live required-check/auto-merge setup.
- Trust maintainers and repository writers with workflow-edit rights. A required
  check name plus the GitHub Actions App source does **not** distinguish this
  workflow from another writer-controlled workflow that can request `checks: write`.
  The normal automation validates its own run/attempt/IDs, but that cannot stop a
  malicious repository writer from forging names or directly changing automation.
  Where available, enforce a ruleset requiring the trusted workflow itself and
  protect policy/workflow changes with independent owner review. Strong isolation
  from hostile repository writers requires a separately permissioned GitHub App or
  organization-controlled required workflow; it is not provided by a repository
  `GITHUB_TOKEN`. Do not claim this gate provides that stronger security boundary.
- Native requests use `GITHUB_TOKEN`, with no PAT or additional secret. GitHub
  suppresses downstream workflows for events generated by that token. Therefore
  **do not assume a bot auto-merge triggers the existing push-based production
  deployment**. Confirm this in first-run validation and use the existing manual
  production workflow when appropriate. A future dedicated App identity can
  address event propagation, but is outside Phase 1. No deployment bypass or
  automatic dispatch is added. See [GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
- Human/administrator actions can enable auto-merge or alter protections outside
  this workflow. Do not manually re-enable auto-merge on ineligible PRs. Fork and
  unsupported/binary PRs do not have a bypass path in this implementation.
- Local tests use synthetic Git objects/API responses; no paid Codex review or
  live auto-merge mutation was run for this change. GitHub-hosted privilege dropping,
  account model access, organization permissions and check display still require
  the controlled first run below.

## First-run validation (Will, after separate installation approval)

1. Keep required independent human approval outstanding so no test PR can merge.
   Configure the key and protected checks, then open a same-repository **draft**
   PR with a harmless `README.md` edit on current main. Confirm normal CI and
   audit run, the source-head-bound Codex check passes on the synthetic merge SHA, eligibility succeeds, and no
   auto-merge request exists. Inspect only sanitized output and check metadata.
2. Mark it ready while leaving the required approval outstanding. Confirm native
   squash auto-merge becomes enabled but GitHub waits for the missing approval/CI.
   Verify the displayed head matches the reviewed head. Do not approve/merge until
   separately authorized, since a main merge may have deployment consequences.
3. Add a protected workflow/policy path to that still-unmerged PR. Confirm the old
   request is revoked, the new head is reviewed, eligibility is neutral and the
   PR stays open without a replacement request. Close the fixture afterwards.
4. Use `node --test test/codex-review.test.js` for malformed verdict, confidence,
   blocking finding, stale-head, timeout, revocation and atomic request cases;
   never inject an API key into test fixtures. A fork fixture should skip the
   privileged jobs and produce no auto-merge request or API usage.
5. Check a fully authorized eligible merge later for downstream CI/deploy event
   propagation; retain the existing manual production fallback. Do not lower
   branch protection to make a failing first run pass.

## Rotation and disable procedure

Rotate the dedicated OpenAI project key, replace the `OPENAI_API_KEY` repository
secret, verify a controlled draft review, then revoke the old key. Never echo or
store either value in the repository or a report.

To stop auto-merging, disable repository auto-merge and disable any pending native
requests first. To stop API spending, disable the **Codex Review** workflow and
revoke/remove the OpenAI key. Required reviews will then block merges; that is
intentional fail-closed behavior. Any replacement manual review policy or removal
of required checks is a separate administrator decision, not an automatic fallback.

References: [official Codex Action documentation](https://developers.openai.com/codex/github-action),
[upstream security configuration](https://github.com/openai/codex-action/tree/86365089eb2b84e0a8fb0717b304f8bdcb13b20e),
[GitHub native auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request),
[required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).


## After manually installing the merge-candidate binding hotfix

The hotfix PR itself runs the previous base-controlled workflow. Its local/CI
regression tests validate the new implementation, but its target run cannot use
this new check placement before installation. The existing head-only check bug
may therefore leave required merge-candidate checks waiting on the hotfix PR too.
Any maintainer bootstrap procedure is separate from this change; this implementation
does not alter protection or manufacture successful checks to install itself.

1. Manually review and squash merge the hotfix PR, preserving branch protection.
   This is an ineligible control change. A human merge to main follows the existing
   production deployment workflow; that is a separate authorized operation.
2. Synchronize PR #13's branch with current `main` (for example, GitHub's **Update
   branch** action if available). That push must produce a new exact head and a
   `synchronize` run using the corrected base workflow. A rerun of an old workflow
   run is not a substitute for bringing the branch up to the new base.
3. Observe `snapshot` → `disarm` → `eligibility`/`review` → `auto-merge` → `publish`.
   Verify `CI / checks` and both custom checks report the same `MERGE_SHA`,
   while the reviewed source commit and `expectedHeadOid` remain `HEAD_SHA`.
   During request/confirmation both custom checks must remain pending. Confirm
   native squash auto-merge is enabled before they turn successful. Existing CI
   and all required approvals remain authoritative; do not manually enable an
   immediate merge or weaken required checks to force progress.
4. If requesting/confirming fails, use only the fixed diagnostic category and
   leave the checks blocked. Correct the external prerequisite separately and
   rerun the complete trusted workflow on the current synchronized head.
5. After GitHub performs an authorized merge, verify downstream workflow behavior.
   The existing GITHUB_TOKEN event-suppression limitation and manual production
   deployment fallback still apply; this hotfix adds no deployment dispatch.

The implementation task does not synchronize or otherwise modify PR #13, change
settings, install secrets, merge, deploy, or exercise a live auto-merge mutation.
