'use strict';

// Operator-only, read-only integration regression against completed public runs.
// No token creation, writes, check publication, deployment, or PR code execution.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = 'dexsword/dextech';
const head = 'f26f262746e77dc91fbed829de56f9484c5fddc4';
const merged = 'ba97961e5c45b4731a072945e9ee981a1a9291ed';
function read(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${endpoint}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    maxBuffer: 4000000
  }));
}
try {
  const pr = read('pulls/24');
  assert.equal(pr.head.repo.full_name, repo);
  assert.equal(pr.base.repo.full_name, repo);
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.head.sha, head);
  assert.equal(pr.merged, true);
  assert.equal(pr.merge_commit_sha, merged);
  assert.equal(pr.merged_by.login, 'dextech-auto-merge[bot]');
  assert.equal(pr.auto_merge.enabled_by.login, 'dextech-auto-merge[bot]');
  assert.equal(pr.auto_merge.merge_method, 'squash');
  assert.equal(read(`git/commits/${merged}`).parents.length, 1); // Squash, not merge commit.
  const checks = read(`commits/${head}/check-runs?per_page=100`).check_runs;
  for (const name of ['checks', 'Codex Review / gate', 'Auto Merge / eligible']) {
    const matches = checks.filter(c => c.name === name && c.app.id === 15368);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].head_sha, head);
    assert.equal(matches[0].conclusion, 'success');
  }
  const probe = read('actions/runs/34152666030');
  assert.equal(probe.event, 'push');
  assert.equal(probe.head_branch, 'ci/merge-app-installation-probe');
  assert.equal(probe.conclusion, 'success');
  const jobs = read('actions/runs/34152666030/jobs').jobs;
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].steps.some(s => s.name.startsWith('Post ') &&
    s.name.includes('create-github-app-token') && s.conclusion === 'success'));
  // The native queue survived token cleanup and the conversation hold.
  assert.ok(Date.parse(jobs[0].completed_at) < Date.parse(pr.merged_at));
  const deploy = read('actions/runs/34152935927');
  assert.equal(deploy.path, '.github/workflows/deploy-production.yml');
  assert.equal(deploy.event, 'push');
  assert.equal(deploy.head_branch, 'main');
  assert.equal(deploy.head_sha, merged);
  for (const id of [34152425830, 34152425843]) {
    assert.equal(read(`actions/runs/${id}`).conclusion, 'cancelled');
  }
  // This verifies triggering, not deployment acceptance: the first deployment
  // correctly failed its server disk-space gate. Never disguise that failure.
  console.log('PASS: real App squash merge, required HEAD checks, token cleanup, stale-run cancellation and production push trigger.');
} catch {
  console.error('Live merge-App verification failed; response and exception details withheld.');
  process.exitCode = 1;
}
