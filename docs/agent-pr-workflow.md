# Agent PR workflow

Use this workflow for work the repository owner has requested from an agent.
Keep each PR focused on that requested change.

1. Start a branch from current `main` in `dexsword/dextech`.
2. Open a draft PR while the change is in progress.
3. Run the relevant local checks, then mark the PR ready for review.
4. Address failed CI or review findings and push the correction. Check the results
   for the updated commit before considering the work complete.
5. If another PR advances `main`, update the branch and check the new results.

Read the PR merge box for the current required checks and blockers. Consult
[guarded auto-merge](guarded-auto-merge.md) for the merge policy and trust
boundaries, and the [path policy](../.github/codex/policy.cjs) for eligibility.

After a merge, inspect [Deploy production](../.github/workflows/deploy-production.yml) in
Actions and match its commit to the PR's merged commit. Report deployment as
successful only when that run succeeds; if it fails or does not start, report
that separately from the merge result.

Do not change policy or bypass checks to make an individual PR eligible. Escalate
changes requiring owner action with the PR link and the specific blocker.

Diagnose failures before rerunning a workflow. Correct code or review findings
first; rerun a full workflow when the failure was transient and is resolved.
Use the trusted repository tooling and normal check results; do not manufacture
successful statuses or run candidate-supplied operator scripts with privileged
credentials.
