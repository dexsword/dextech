# Automatic production deployment over Tailscale

Every push to `main` starts this deployment workflow, including the push created
by merging the PR that enables it. `workflow_dispatch` remains a manual fallback.
The deployment proceeds only after its checks and existing `production`
environment protections pass; required approvals, if configured, still apply.
The root-installed server implementation is a separately reviewed control plane;
GitHub never uploads code to it and repository changes cannot replace it.

## Trust and command contract

Only `push` and `workflow_dispatch` on `dexsword/dextech`'s `refs/heads/main` are
eligible. There are no path filters: documentation, dependencies, configuration,
workflows and application changes merged into main all use the same checks and
deployment path. PR events, other branches, tags and forks cannot deploy.
The checks job checks out `github.sha`, requires it to equal public main, uses
Node 22, runs clean `npm ci`, the entire test suite, tracked-file and JavaScript
syntax checks, synthetic health checks, and a production audit requiring zero
high/critical vulnerabilities. CI uses the same `scripts/deployment-checks.sh`.
All actions are pinned to full upstream release commit SHAs.

A separate fresh runner receives the production secrets only after checks and
environment approval. It executes no repository code, downloads no artifacts,
and rechecks main before using OpenSSH. The server fetches public main itself
and rechecks equality immediately before switching. If main advances, the run
fails; the newer main push starts its own run, or an operator can dispatch a fresh
run after reviewing current main. There is no arbitrary SHA input or deployment
of a tag, PR head or alternate branch. Automatic runs deploy their exact push
SHA, and manual runs deploy their exact workflow SHA. Neither substitutes a newer
commit after testing.

The existing `dextech-production` concurrency group and
`cancel-in-progress: false` remain unchanged. Running deployments are not
cancelled by newer pushes. This does not guarantee that every intermediate SHA
will reach production: a superseded SHA must fail the current-main equality gate.

The deploy job first joins the tailnet using the official
[`tailscale/github-action` v4.1.3](https://github.com/tailscale/github-action/tree/780049a30b6ff5c378a9e7b389d15ece7a204888),
pinned to `780049a30b6ff5c378a9e7b389d15ece7a204888`. The reviewed upstream
`action.yml` and implementation support OIDC authentication, ping failure
handling and post-job logout. With workload identity federation, `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` select the
federated identity, and GitHub supplies a short-lived OIDC token. Only the deploy
job grants `id-token: write`; checks retain only `contents: read`. No OAuth client
secret or reusable Tailscale auth key is used.

The runner is an ephemeral node with only `tag:github-dextech`, in-memory Tailscale
state, no binary cache, and automatic post-job logout/daemon cleanup. If cleanup
cannot complete, Tailscale's ephemeral-node expiry is the fallback. The action's
`ping: 100.109.72.10` must succeed before the OpenSSH step runs. This verifies
peer reachability (direct or relayed); SSH still has to pass TCP access and
host-key/authentication checks. The action manages its own Node runtime; the
application checks remain on Node 22.

Deployment SSH goes exclusively to **100.109.72.10:22**, binds to the runner's
`tailscale0` interface, and rejects any other configured host or port before SSH.
There is no public-IP or DNS fallback. Runner DNS is left unchanged with
`--accept-dns=false`, since the destination is a literal Tailscale IP. The existing
tailnet policy permits only `tag:github-dextech` to `tag:dexserve` over TCP 22.
Public SSH ingress is not required and must remain closed. Native OpenSSH still
uses the restricted account and pinned DexServe host key; Tailscale does not
replace SSH authentication or authorize arbitrary server commands. Tailnet join
or ping failures stop the job without reaching deployment.

The sole SSH command is `deploy <40 lowercase hex characters>`, with exactly one
space, no extra arguments, newline, quoting or shell expansion. The login program
is `/usr/local/libexec/dextech-ssh`, not a general shell. Its only accepted login
argv is `-c /usr/local/libexec/dextech-ssh`, the authorized-key forced command.
Python isolated mode ignores Python environment manipulation. The wrapper
validates the complete original command and replaces its environment before
executing the one allowed sudo command. No input is evaluated as shell code.

Account `dextech-deploy` has a locked password, no supplementary privileged groups,
a root-owned home and authorized_keys, and no interactive shell. Its only sudo
exception is `/usr/local/sbin/dextech-deploy` with arguments matching
`^deploy [0-9a-f]{40}$`; `NOSETENV` applies. The key entry uses
`restrict,command="/usr/local/libexec/dextech-ssh"`, prohibiting PTY, agent/X11/port
forwarding and user rc. SSH configuration is not changed. File transfer and
arbitrary command execution cannot reach a shell. The account cannot write
releases or its own home/keys, or read production environment files.

## Server controls

Install the reviewed files as root:

| Repository file | Installed path | Mode |
| --- | --- | --- |
| `deploy.py` | `/usr/local/sbin/dextech-deploy` | root:root 0755 |
| `ssh-entry.py` | `/usr/local/libexec/dextech-ssh` | root:root 0755 |
| `calendar-read.cjs` | `/usr/local/libexec/dextech-calendar-read.cjs` | root:root 0644 |
| `sudoers` | `/etc/sudoers.d/dextech-deploy` | root:root 0440 |

The deployer holds the existing `/var/lib/dextech-deploy/deploy.lock` throughout.
It selects an explicit runtime-file allowlist from the exact Git archive; new
runtime assets require an operator-reviewed control-plane update. It never runs
repository deployment scripts. Production dependency lifecycle scripts run as
`dextech-build` in a transient systemd sandbox with no privileges, a private tmp,
read-only system, protected home, inaccessible production files and a single
writable build directory. Source parity, safe file types/symlinks, production
installation, native SQLite integrity and audit gates precede publication.
The root-owned release excludes Git metadata, environment/credential files,
databases, logs, CI, developer tools, tests and development dependencies.

Before switching it captures a fresh live SQLite Online Backup API backup from
a read-only connection. It independently restores to a temporary database and
requires integrity `ok`; temporary restore data is removed. It never restores or
replaces the live database. Protected systemd configuration and the running
process's effective production environment are compared privately, with no secret
values or hashes in evidence. Only `release.env`'s SHA changes during deployment.

The root-owned release link changes atomically, and only `dextech.service` is
restarted. Gates require systemd active/running, stable PID/no restarts, runtime
UID and Node 22, release cwd/SHA, database FD, exclusive loopback listener,
local/public health, HTML and availability, Apache active/configtest, Calendar
FreeBusy/events read, a fresh application Calendar refresh, and sanitized logs
from the current invocation and gate interval. No bookings, emails, payments,
Calendar writes or admin mutations are used as probes. The two-minute Calendar
cache may make validation take over two minutes.

Any failure after the switch is armed restores the immediately preceding release
and SHA environment, restarts only DexTech, and runs the same restored-health
gates. The database is never rolled back. Apache and PM2 identities must remain
unchanged. Ordinary termination signals enter rollback; a second signal is ignored
during recovery. An abrupt host/power loss or SIGKILL cannot be recovered by an
in-process trap: use the durable `switching` record for operator recovery. The SHA
environment update and release-link update are separate atomic operations.

Repeated deployment of the already-active current-main SHA only verifies live
health and returns success: no build, backup, switch, restart or pruning occurs.
A pre-existing *inactive* SHA directory fails closed and needs operator inspection;
it is never silently reused or overwritten. Rollback compatibility of database
schema changes must be reviewed before merging such application changes.

## Validation without deployment

As root, on DexServe:

```sh
/usr/local/sbin/dextech-deploy --validate "$(git ls-remote https://github.com/dexsword/dextech.git refs/heads/main | cut -f1)"
```

This root-only mode checks argument/main/lock/live-health/Calendar/protected-state
gates. It does not build, create database backups, switch, restart or prune.
Health requests and a transient restricted Calendar-read unit are expected;
application cache and normal access/journal logging may refresh. This mode is not
available over the deployment identity. It is not a simulation of a live restart.

Offline checks from an isolated checkout:

```sh
python3 -I ops/deployment/test_deploy.py
python3 -m py_compile ops/deployment/*.py
bash -n scripts/deployment-checks.sh
shellcheck scripts/*.sh
actionlint
```

Offline tests inject switch/acceptance failures and test rollback, malformed SSH
commands, unsafe archives, synthetic SQLite online backup/restoration, and
non-mutating validation/idempotency. `npm test` also validates the workflow
contract for both push and manual events, including rejection of other refs,
repositories and events and absence of path filters. It also executes the SSH run
block against fake local commands and synthetic
credentials: no tailnet join, SSH connection or deployment is made by those tests.
A real switch/rollback is deliberately not exercised by these validations.

## Retention and recovery evidence

Automation evidence: `/var/lib/dextech-deploy/actions`, root:root 0700; sanitized
JSON records are 0600. Online database backups: `/var/backups/dextech/actions`,
root:root 0700, individual files 0600. Only automation-owned manifest records,
backups and releases qualify for pruning. Following successful new deployments,
keep the latest five records/backups, all release SHAs referenced by those
records plus the active release, and older ownership records/backups for those
protected releases. This preserves the immediate predecessor without losing the
record needed to prune a release later. Admission stops at 20 automation records
until an operator reviews retention, bounding even repeated failures to 20
records/backups and their automation releases. Unrecorded/legacy releases and
all pre-Phase-1 backups are exempt. Failures never prune; root must review failed
attempts if successful deployment cannot resume. No existing backups were deleted
in Phase 1. Staging directories are temporary and removed after builds.

Each record identifies the target and previous SHA, backup path, artifact digest,
backup integrity proof, outcome and sanitized acceptance/rollback results. No raw
runtime logs, environment dumps, customer data or private keys are recorded.
If a deployment reports failure, inspect root-only evidence. `rolled-back` means
restored gates passed; `rollback-needs-operator` requires immediate investigation.
Do not replay the old PM2 cutover rollback for this systemd deployment scheme.
Never restore a database automatically, and never overwrite repaired OAuth grants.

## GitHub production environment configuration

Use the existing **Settings → Environments → production** configuration. Keep
deployment branches restricted to selected branch **main** (no tag rule); configure required reviewers and prevent
self-review where available. Protect main and require `CI / checks`. Reviewers
must verify the exact main SHA and the deployment implementation before approval.

| Name | Environment configuration | Value |
| --- | --- | --- |
| `DEXSERVE_HOST` | Variable | `100.109.72.10` (DexServe Tailscale IP) |
| `DEXSERVE_PORT` | Variable | `22` |
| `DEXSERVE_DEPLOY_USER` | Variable | `dextech-deploy` |
| `TS_OAUTH_CLIENT_ID` | Secret | Existing Tailscale federated identity client ID |
| `TS_AUDIENCE` | Secret | Existing Tailscale federated identity audience |
| `DEXSERVE_SSH_PRIVATE_KEY` | Secret | Complete dedicated Ed25519 private key, including final newline |
| `DEXSERVE_KNOWN_HOSTS` | Secret | Pinned server-known-host entry from trusted operator handoff |

Use the server's verified `ssh-ed25519` public host key. For port 22 the known-host
line must match `100.109.72.10 ssh-ed25519 <server-public-key>` in the existing
`DEXSERVE_KNOWN_HOSTS` secret. A public-IP-only entry will not match the tailnet
destination. Never repair a mismatch with unchecked `ssh-keyscan`, disabled
verification, a public fallback, or an open firewall port. This workflow update
does not read or change any environment configuration or credential values.
Private-key transfer uses Will's existing trusted administrative SSH identity;
the restricted deployment identity cannot retrieve files. The private key is never
stored in this repository, any release, CI artifact, report or deployment record.
After securely adding the secret and verifying the first run, remove temporary
handoff copies on both hosts. Rotate by installing a new restricted public key,
updating the environment secret, verifying it, then removing the previous key.

## Automatic deployment and manual fallback

1. Review and merge the automatic-deployment PR into main when ready. **That merge
   itself triggers the first automatic deployment workflow** for the resulting
   exact main SHA. No separate workflow dispatch or settings change is required.
2. Every subsequent push to main uses the same complete tests, production audit
   and protected environment. If environment approval is configured, review the
   exact SHA and approve the run after checks pass. Automatic triggering does not
   bypass approval or any other gate.
3. The ephemeral runner joins with `tag:github-dextech` and passes the action ping
   gate before native OpenSSH contacts `100.109.72.10:22` through `tailscale0`.
   The server again requires fetched main to equal the tested SHA before switching.
4. If main advances during checks or approval, the stale run fails closed. Use
   the run for the newer main push. For manual recovery, choose **Actions → Deploy
   production → Run workflow → main**; there are no deployment inputs. Do not
   re-run an old SHA expecting it to deploy after main has moved.
5. Confirm the run succeeds and inspect the sanitized server record. Independently
   verify local/public health and SHA. A manual dispatch for the already-active
   current-main SHA verifies safe idempotency. Both triggers retain the same
   backup, Calendar, log, rollback and evidence controls.

Validation of this workflow change is isolated and does not merge, dispatch,
deploy, modify production, change environment settings or join the tailnet.

References: [GitHub environment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[manual workflow trigger](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[OpenSSH key restrictions](https://man.openbsd.org/sshd.8).
