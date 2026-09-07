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
   checks are created **on the PR head SHA**, not the base SHA of the target run.
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
A separate revocation job has `contents: write`, `pull-requests: write` solely to
**disable** previous native auto-merge requests before any final passing checks.
This also resets previously human-enabled auto-merge requests: a new sensitive
change must not inherit permission from an old eligible head. Revocation failure
fails the gate. The distinct **enable** job runs only after gate and eligibility
pass, with `contents: write`, `pull-requests: write`, `checks: read`; it receives no
model response, API key or candidate checkout. It rereads the same run's check
IDs, head SHA, run/attempt binding, results, current main and current PR immediately
before requesting `enablePullRequestAutoMerge` with `expectedHeadOid` and
`mergeMethod: SQUASH`. GitHub atomically rejects a changed head. There is no direct
merge fallback. A stale base, stale head, draft, closed PR or fork stops the request.

## Review decision and eligibility

The shared JSON Schema requires `verdict`, numeric `confidence` in `[0, 1]`,
`blocking_findings`, and `summary`, with no unknown fields. Findings require
severity `P0`–`P3`, file, nullable positive line bounds and an explanation.
The publisher independently validates that schema with a small dependency-free
validator that rejects unsupported schema keywords. Passing requires verdict
`pass`, **confidence >= 0.95**, **zero blocking findings**, successful action/job
completion and successful revocation. Every P0/P1 finding therefore fails, as do
other blocking findings. Prose is never parsed as approval. Empty/malformed or
masked/missing output, API/action error, timeout, and low confidence fail closed.
Cancelled runs can leave an in-progress check, which also blocks merging; rerun
the entire trusted workflow to recover. No `continue-on-error` path passes review.

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
copied to check summaries, comments or uploaded artifacts. The upstream action
and Actions output/environment plumbing can put review text in Actions logs. Only public repository source is sent;
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
   audit run, the exact-head Codex check passes, eligibility succeeds, and no
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
