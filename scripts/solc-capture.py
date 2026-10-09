#!/usr/bin/env python3
"""Transparent solc delegate; capture standard JSON without recording environment secrets."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    compiler = Path(os.environ['DIESIS_SDK_REAL_SOLC']).resolve(strict=True)
    args = sys.argv[1:]
    capture = '--standard-json' in args
    stage = None
    if capture:
        root = Path(os.environ['DIESIS_SDK_SOLC_CAPTURE_DIR']).resolve(strict=True)
        identity = str(uuid.uuid4())
        stage = root / ('.' + identity + '.staging')
        stage.mkdir(mode=0o700)
    child = None
    received = []

    def forward(signum, _frame):
        received.append(signum)
        if child is not None:
            child.send_signal(signum)

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, forward)
    if capture:
        stdin = sys.stdin.buffer.read()
        child = subprocess.Popen([str(compiler), *args], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for signum in received:
            child.send_signal(signum)
        stdout, stderr = child.communicate(stdin)
        files = {'stdin.bin': stdin, 'stdout.bin': stdout, 'stderr.bin': stderr}
        manifest = {
            'version': 1, 'captureId': identity, 'argv': args, 'cwd': os.getcwd(),
            'compiler': str(compiler), 'compilerSha256': digest(compiler.read_bytes()),
            'exitCode': child.returncode if child.returncode >= 0 else None,
            'signal': -child.returncode if child.returncode < 0 else None,
            'receivedSignals': received,
            'files': {name: {'sha256': digest(data), 'bytes': len(data)}
                      for name, data in files.items()},
        }
        for name, data in files.items():
            with (stage / name).open('xb') as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
        with (stage / 'manifest.json').open('x') as output:
            json.dump(manifest, output, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        stage.rename(root / identity)
        sys.stdout.buffer.write(stdout)
        sys.stdout.buffer.flush()
        sys.stderr.buffer.write(stderr)
        sys.stderr.buffer.flush()
    else:
        child = subprocess.Popen([str(compiler), *args])
        for signum in received:
            child.send_signal(signum)
        child.wait()
    if child.returncode < 0:
        signum = -child.returncode
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
    return child.returncode


if __name__ == '__main__':
    sys.exit(main())
