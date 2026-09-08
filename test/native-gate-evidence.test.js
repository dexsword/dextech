'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect } = require('../scripts/collect-native-gate-evidence.cjs');
const head = 'a'.repeat(40);
function fixture() {
  const context = { __typename: 'CheckRun', databaseId: 99, name: 'merge-gate', status: 'IN_PROGRESS',
    conclusion: null, isRequired: true, checkSuite: { databaseId: 456, app: { databaseId: 15368, slug: 'github-actions' } } };
  const connection = nodes => ({ pageInfo: { hasNextPage: false }, nodes });
  const data = {
    run: { id: 123, run_attempt: 2, check_suite_id: 456, head_sha: head,
      path: '.github/workflows/codex-review.yml', event: 'pull_request_target' },
    jobs: { total_count: 1, jobs: [{ id: 99, name: 'merge-gate' }] },
    check: { id: 99, name: 'merge-gate', head_sha: head, status: 'in_progress', conclusion: null,
      check_suite: { id: 456 }, app: { id: 15368 } },
    pr: { state: 'OPEN', isDraft: false, headRefOid: head, mergeStateStatus: 'BLOCKED', autoMergeRequest: null,
      reviewThreads: connection([]), potentialMergeCommit: { oid: 'b'.repeat(40), statusCheckRollup: { contexts: connection([]) } },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: connection([context]) } } }] } },
    rules: []
  };
  const calls = [];
  const request = (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'graphql') {
      assert.match(payload.query.trim(), /^query\(/);
      assert.equal((payload.query.match(/contexts\(first:100\)/g) || []).length, 2);
      assert.equal((payload.query.match(/isRequired\(pullRequestNumber:\$number\)/g) || []).length, 4);
      assert.deepEqual(payload.variables, { number: 35 });
      return { data: { repository: { pullRequest: data.pr } } };
    }
    assert.equal(payload, undefined, 'REST calls must be read-only');
    if (endpoint.endsWith('/actions/runs/123')) return data.run;
    if (endpoint.endsWith('/actions/runs/123/attempts/2/jobs?per_page=100')) return data.jobs;
    if (endpoint.endsWith('/check-runs/99')) return data.check;
    if (endpoint.endsWith('/rules/branches/main')) return data.rules;
    assert.fail('Unexpected API endpoint');
  };
  return { data, calls, request };
}

test('capture records head and synthetic-merge checks separately without inferring enforcement', () => {
  const f = fixture();
  f.data.pr.potentialMergeCommit.statusCheckRollup.contexts.nodes.push({
    ...structuredClone(f.data.pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0]),
    databaseId: 88, status: 'COMPLETED', conclusion: 'SUCCESS'
  });
  const evidence = collect('35', '123', f.request);
  assert.equal(evidence.observations.gate_bound_to_current_run_and_head, true);
  assert.equal(evidence.observations.current_gate_required, true);
  assert.equal(evidence.observations.synthetic_merge_has_checks, true);
  assert.equal(evidence.pr.potentialMergeCommit.statusCheckRollup.contexts.nodes[0].databaseId, 88);
  assert.equal(evidence.gate.id, 99);
  assert.equal(evidence.observations.merge_state, 'BLOCKED');
  assert.equal(Object.hasOwn(evidence.observations, 'enforcement_proved'), false);
});

test('optional or older same-name checks never substitute for the current required check', () => {
  for (const change of [
    f => { f.data.pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].isRequired = false; },
    f => { f.data.pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].databaseId = 88; }
  ]) {
    const f = fixture(); change(f);
    assert.equal(collect('35', '123', f.request).observations.current_gate_required, false);
  }
});

test('wrong SHA, suite, workflow or App cannot be reported as bound', () => {
  for (const change of [f => { f.data.check.head_sha = 'c'.repeat(40); },
    f => { f.data.run.check_suite_id = 1; }, f => { f.data.run.path = 'other.yml'; },
    f => { f.data.check.app.id = 1; }]) {
    const f = fixture(); change(f);
    assert.equal(collect('35', '123', f.request).observations.gate_bound_to_current_run_and_head, false);
  }
});

test('truncated jobs, head checks, merge checks or review threads reject the capture', () => {
  for (const change of [f => { f.data.jobs.total_count = 101; },
    f => { f.data.pr.commits.nodes[0].commit.statusCheckRollup.contexts.pageInfo.hasNextPage = true; },
    f => { f.data.pr.potentialMergeCommit.statusCheckRollup.contexts.pageInfo.hasNextPage = true; },
    f => { f.data.pr.reviewThreads.pageInfo.hasNextPage = true; }]) {
    const f = fixture(); change(f);
    assert.throws(() => collect('35', '123', f.request));
  }
});

test('absent gate is recorded without manufacturing a required result; malformed IDs reject before reads', () => {
  const f = fixture(); f.data.jobs = { total_count: 0, jobs: [] };
  const evidence = collect('35', '123', f.request);
  assert.equal(evidence.gate, null);
  assert.equal(evidence.observations.current_gate_required, false);
  for (const ids of [['-1', '123'], ['35', 'other'], ['9007199254740993', '123']]) {
    assert.throws(() => collect(...ids, () => assert.fail('Invalid IDs must not reach GitHub')));
  }
});
