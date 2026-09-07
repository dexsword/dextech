#!/usr/bin/python3 -I
"""Login program and authorized_keys forced command. Never interpret shell text."""
import os
import re
import sys
import syslog

ENTRY = '/usr/local/libexec/dextech-ssh'


def parse(argv, command):
    if argv != ['-c', ENTRY]:
        raise ValueError('denied')
    match = re.fullmatch(r'deploy ([0-9a-f]{40})', command, flags=re.ASCII)
    if not match:
        raise ValueError('denied')
    return match[1]


def main():
    try:
        sha = parse(sys.argv[1:], os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    except ValueError:
        print('Deployment command rejected.', file=sys.stderr)
        return 64
    # No client environment, command text, address or credentials in logs or sudo.
    syslog.openlog('dextech-deploy', syslog.LOG_PID, syslog.LOG_AUTHPRIV)
    syslog.syslog(syslog.LOG_NOTICE, 'accepted sha=' + sha)
    os.execve('/usr/bin/sudo', ['sudo', '-n', '--', '/usr/local/sbin/dextech-deploy',
                              'deploy', sha],
              {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})


if __name__ == '__main__':
    sys.exit(main())
