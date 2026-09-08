'use strict';

// Operator-only read-only capture. This is not a CI or merge authorization gate.
// Usage: node scripts/collect-native-gate-evidence.cjs PR RUN OUTPUT.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const repository = 'dexsword/dextech';
function api(endpoint, payload) {
  const args = ['api', endpoint];
  if (payload) args.push('--method', 'POST', '--input', '-');
  return JSON.parse(execFileSync('gh', args, {
    input: payload ? JSON.stringify(payload) : undefined,
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
    maxBuffer: 4000000
  }));
}
function read(endpoint) { return api(`repos/${repository}/${endpoint}`); }
function pick(object, keys) { return Object.fromEntries(keys.map(key => [key, object[key]])); }
function main() {
  const [number, runId, output] = process.argv.slice(2);
  assert.equal(process.argv.length, 5);
  assert.match(number, /^[1-9][0-9]*$/);
  assert.match(runId, /^[1-9][0-9]*$/);
  assert.ok(Number.isSafeInteger(Number(number)) && Number.isSafeInteger(Number(runId)));
  assert.ok(output);
  const run = read(`actions/runs/${runId}`);
  const jobs = read(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert.equal(jobs.total_count, jobs.jobs.length);
  assert.ok(jobs.total_count <= 100);
  const gates = jobs.jobs.filter(job => job.name === 'merge-gate');
  assert.ok(gates.length <= 1);
  const gate = gates.length ? read(`check-runs/${gates[0].id}`) : null;
  const result = api('graphql', { variables: { number: Number(number) }, query: `
    query($number:Int!) { repository(owner:"dexsword",name:"dextech") {
      pullRequest(number:$number) {
        state isDraft mergeable mergeStateStatus headRefOid baseRefOid reviewDecision
        autoMergeRequest { enabledAt }
        reviewThreads(first:100) { pageInfo { hasNextPage } nodes { isResolved } }
        potentialMergeCommit { oid statusCheckRollup { contexts(first:1) { nodes { __typename } } } }
        commits(last:1) { nodes { commit { oid statusCheckRollup { contexts(first:100) {
          pageInfo { hasNextPage } nodes { __typename
            ... on CheckRun { databaseId name status conclusion isRequired(pullRequestNumber:$number)
              checkSuite { databaseId app { databaseId slug } } }
            ... on StatusContext { context state isRequired(pullRequestNumber:$number) }
          }
        } } } } }
      }
    } }` });
  assert.ok(!result.errors);
  const pr = result.data.repository.pullRequest;
  const contexts = pr.commits.nodes[0].commit.statusCheckRollup.contexts;
  assert.equal(contexts.pageInfo.hasNextPage, false);
  const current = contexts.nodes.find(context => gate && context.databaseId === gate.id);
  const bound = Boolean(gate && current && run.path === '.github/workflows/codex-review.yml' &&
    run.event === 'pull_request_target' && gate.head_sha === pr.headRefOid && gate.head_sha === run.head_sha &&
    gate.check_suite.id === run.check_suite_id && gate.app.id === 15368 &&
    current.checkSuite.databaseId === run.check_suite_id && current.checkSuite.app.databaseId === 15368);
  const evidence = {
    captured_at: new Date().toISOString(), repository, pr_number: Number(number),
    run: pick(run, ['id', 'run_attempt', 'check_suite_id', 'head_sha', 'event', 'path', 'status', 'conclusion']),
    gate: gate && pick(gate, ['id', 'name', 'head_sha', 'status', 'conclusion']),
    pr, rules: read('rules/branches/main'),
    observations: { gate_bound_to_current_run_and_head: bound,
      current_gate_required: Boolean(current?.isRequired), merge_state: pr.mergeStateStatus,
      no_auto_merge_request: pr.autoMergeRequest === null }
  };
  // Refuse to overwrite an earlier capture. Snapshots contain only selected
  // metadata, not tokens, logs, PR bodies, comments, or model review contents.
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence.observations));
}
try { main(); } catch {
  console.error('Native-gate evidence capture failed; response and exception details withheld.');
  process.exitCode = 1;
}
