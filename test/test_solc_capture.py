import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).parents[1] / 'scripts/solc-capture.py'


class CaptureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.compiler = self.root / 'fake-solc'
        self.compiler.write_text('''#!/usr/bin/env python3
import os,signal,sys,time
if '--version' in sys.argv:
    sys.stdout.buffer.write(b'fake-version\\n');sys.exit(0)
if '--wait' in sys.argv:
    open('ready','w').close()
    time.sleep(30)
if '--signal' in sys.argv: os.kill(os.getpid(),signal.SIGTERM)
b = sys.stdin.buffer.read()
sys.stdout.buffer.write(b'OUT\\x00'+b)
sys.stderr.buffer.write(b'ERR\\xff')
sys.exit(7 if '--fail' in sys.argv else 0)
''')
        self.compiler.chmod(0o700)
        self.captures = self.root / 'captures'
        self.captures.mkdir()
        self.env = dict(os.environ, DIESIS_SDK_REAL_SOLC=str(self.compiler),
                        DIESIS_SDK_SOLC_CAPTURE_DIR=str(self.captures), SECRET_SENTINEL='never-record')

    def tearDown(self):
        self.tmp.cleanup()

    def run_wrapper(self, args, data=b''):
        return subprocess.run([sys.executable, str(WRAPPER), *args], input=data,
                              capture_output=True, env=self.env, cwd=self.root)

    def manifests(self):
        return [json.loads((d / 'manifest.json').read_text()) for d in self.captures.iterdir()]

    def test_version_and_other_flags_passthrough_without_capture(self):
        p = self.run_wrapper(['--version'])
        self.assertEqual((p.returncode,p.stdout,p.stderr),(0,b'fake-version\n',b''))
        p = self.run_wrapper(['--other'], b'abc')
        self.assertEqual((p.returncode,p.stdout,p.stderr),(0,b'OUT\x00abc',b'ERR\xff'))
        self.assertEqual(list(self.captures.iterdir()), [])

    def test_exact_bytes_argv_hashes_and_failure(self):
        data=b'{"sources":{}}\n\x00\xff'
        p=self.run_wrapper(['--standard-json','--fail'],data)
        self.assertEqual((p.returncode,p.stdout,p.stderr),(7,b'OUT\x00'+data,b'ERR\xff'))
        m=self.manifests()[0]
        self.assertEqual(m['argv'],['--standard-json','--fail'])
        self.assertEqual(m['cwd'],str(self.root.resolve()))
        self.assertEqual(m['exitCode'],7)
        self.assertEqual(m['compilerSha256'],hashlib.sha256(self.compiler.read_bytes()).hexdigest())
        d=self.captures/m['captureId']
        for name, expected in [('stdin.bin',data),('stdout.bin',p.stdout),('stderr.bin',p.stderr)]:
            self.assertEqual((d/name).read_bytes(),expected)
            self.assertEqual(m['files'][name],{'bytes':len(expected),'sha256':hashlib.sha256(expected).hexdigest()})
        self.assertNotIn('never-record',json.dumps(m))

    def test_child_signal_preserved_and_captured(self):
        p=self.run_wrapper(['--standard-json','--signal'])
        self.assertEqual(p.returncode,-signal.SIGTERM)
        self.assertEqual(self.manifests()[0]['signal'],signal.SIGTERM)

    def test_external_signal_forwarded(self):
        import time
        p=subprocess.Popen([sys.executable,str(WRAPPER),'--standard-json','--wait'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=self.env,cwd=self.root)
        p.stdin.close()
        deadline=time.monotonic()+5
        while not (self.root/'ready').exists():
            if time.monotonic()>deadline:
                p.kill();self.fail('fake compiler did not start')
            time.sleep(0.01)
        p.send_signal(signal.SIGTERM)
        p.wait(timeout=5)
        p.stdout.close();p.stderr.close()
        self.assertEqual(p.returncode,-signal.SIGTERM)
        self.assertEqual(self.manifests()[0]['receivedSignals'],[signal.SIGTERM])

    def test_concurrent_unique_atomic_captures(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda i:self.run_wrapper(['--standard-json'],str(i).encode()),range(12)))
        self.assertTrue(all(p.returncode==0 for p in results))
        m=self.manifests()
        self.assertEqual(len({x['captureId'] for x in m}),12)
        self.assertFalse(any(d.name.startswith('.') for d in self.captures.iterdir()))


if __name__ == '__main__':
    unittest.main()
