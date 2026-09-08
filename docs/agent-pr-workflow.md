# Agent PR workflow

Use this workflow for work the repository owner has requested from an agent.
Keep each PR focused on that requested change.

1. Start a branch from current `main` in `dexsword/dextech`.
2. Open a draft PR while the change is in progress. Ordinary CI runs on drafts;
   the AI review waits until the PR is ready.
3. Run the relevant local checks, then mark the PR ready for review.
4. Address failed CI or review findings and push the correction. Every new commit
   receives a fresh evaluation.
5. If another PR advances `main`, update the branch and let checks run again.
   Strict checks bind approval to the current source and base commits.

The two required checks are `checks` and `merge-gate`, both from GitHub Actions.
An eligible, ready PR with passing review and CI needs no special label or manual
auto-merge click. The trusted controller requests squash auto-merge as the
repository's merge App. The resulting push to `main` triggers production checks
and deployment for that exact merged commit.

Watch the production workflow after the PR merges. A successful PR review does
not by itself establish that deployment succeeded; production has its own test,
dependency-audit, backup, health, and acceptance checks.

The existing allowlist determines which changes can auto-merge. Ordinary UI,
content, selected documentation and tests can qualify. Workflow/policy, backend,
authentication, deployment, database, Calendar, payment and other protected
changes stay manual even after passing review. Unknown paths also stay manual.
Do not change policy or bypass checks to make an individual PR eligible.

Prefer rerunning the full review workflow when a run fails without a code change.
When a source or base commit changed, update the branch and obtain a new review.
Use the trusted repository tooling and normal check results; do not manufacture
successful statuses or run candidate-supplied operator scripts with privileged
credentials.

See [guarded auto-merge](guarded-auto-merge.md) for the detailed trust boundaries
and deployment controls.
