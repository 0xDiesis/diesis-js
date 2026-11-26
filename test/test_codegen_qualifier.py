import base64
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('qualifier',Path(__file__).parents[1]/'scripts/qualify-contract-inputs.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class QualifierTests(unittest.TestCase):
    def test_exact_source_and_release_tuple(self):
        self.assertEqual(module.REVISION,'f0f9df1408efcf9bd8b996266ec91504e5e1e372')
        self.assertEqual(module.GENERATOR_COMMIT,'fbf6f7468c952863f2318a450520ac0933cbd65d')
    def test_zip_bytes_manifest_and_traversal(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:z.writestr('src/a.sol',b'exact\x00bytes')
        with tempfile.TemporaryDirectory() as tmp:
            files=module.extract_zip(stream.getvalue(),Path(tmp))
            self.assertEqual(files,[{'path':'src/a.sol','sha256':module.sha(b'exact\x00bytes')}])
            self.assertEqual((Path(tmp)/'src/a.sol').read_bytes(),b'exact\x00bytes')
        for name in ['../escape','/absolute','a/../../escape','a\\b']:
            with self.assertRaises(ValueError):module.safe_name(name)
    def test_tar_refuses_symlink_and_duplicate(self):
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w:gz') as t:
            entry=tarfile.TarInfo('link');entry.type=tarfile.SYMTYPE;entry.linkname='/escape';t.addfile(entry)
        with self.assertRaises(ValueError):module.tar_files(stream.getvalue())
    def test_source_identity_pins_explicit_work_tree(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            checkout=Path(tmp).resolve()
            with patch.object(module.platform,'system',return_value='Linux'), patch.object(module.platform,'machine',return_value='x86_64'), patch.object(module.os,'access',return_value=True), patch.object(module,'run',side_effect=[module.REVISION,RuntimeError('stop before network')]) as run:
                with self.assertRaisesRegex(RuntimeError,'stop before network'):
                    module.qualify(checkout,checkout/'unused-work')
                self.assertEqual(run.call_args_list[0].args[0],['git',f'--work-tree={checkout}','-C',checkout,'rev-parse','HEAD'])
                self.assertEqual(run.call_args_list[1].args[0],['git',f'--work-tree={checkout}','-C',checkout,'status','--porcelain'])
    def test_unqualified_platform_aborts_before_download_or_build(self):
        from unittest.mock import patch
        with patch.object(module.platform,'system',return_value='Windows'), patch.object(module,'download') as download:
            with self.assertRaises(ValueError):module.qualify(Path('/not/read'),Path('/not/write'))
            download.assert_not_called()



class PackageManagerBoundaryTest(unittest.TestCase):
    def test_installer_is_pinned_pnpm_and_npm_is_readonly_audit(self):
        import ast
        tree=ast.parse((Path(__file__).parents[1]/'scripts/qualify-contract-inputs.py').read_text())
        commands=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='run' and node.args and isinstance(node.args[0],ast.List):
                values=node.args[0].elts
                if all(isinstance(v,ast.Constant) and isinstance(v.value,str) for v in values):commands.append([v.value for v in values])
        self.assertIn(['pnpm','install','--ignore-scripts','--registry=https://registry.npmjs.org'],commands)
        npm=[c for c in commands if c[0]=='npm']
        self.assertEqual(npm,[['npm','audit','signatures','--json','--include-attestations','--registry=https://registry.npmjs.org']])


class VerifiedProvenanceBindingTest(unittest.TestCase):
    # Model the fields returned by npm audit. The qualifier runs npm to perform
    # the cryptographic checks before it validates these fields.
    def receipt(self):
        predicate_type = 'https://slsa.dev/provenance/v1'
        repository = 'https://github.com/0xdoublesharp/abi-typegen'
        ref = 'refs/tags/v0.9.3'
        statement = {
            '_type': 'https://in-toto.io/Statement/v1',
            'predicateType': predicate_type,
            'subject': [{
                'name': 'pkg:npm/%400xdoublesharp/abi-typegen@0.9.3',
                'digest': {'sha512': 'eb959f5a68edc1f7f770fd37d6854cd40466c8599e0ae2ef4cf3a31f351c715600fb89e66f29b90730113bca0b92f853408c2c5d50c9971d4266e388b5d50792'},
            }],
            'predicate': {'buildDefinition': {
                'buildType': 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
                'externalParameters': {'workflow': {
                    'ref': ref,
                    'repository': repository,
                    'path': '.github/workflows/release.yml',
                }},
                'resolvedDependencies': [{
                    'uri': f'git+{repository}@{ref}',
                    'digest': {'gitCommit': 'fbf6f7468c952863f2318a450520ac0933cbd65d'},
                }],
            }},
        }
        return {'verified': [{
            'name': '@0xdoublesharp/abi-typegen',
            'version': '0.9.3',
            'attestationBundles': [
                {'predicateType': 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'},
                {'predicateType': predicate_type, 'bundle': {'dsseEnvelope': {
                    'payloadType': 'application/vnd.in-toto+json',
                    'payload': base64.b64encode(json.dumps(statement).encode()).decode(),
                }}},
            ],
        }]}

    def test_provenance_binds_published_source(self):
        module.validate_signature_provenance(self.receipt())

    def test_rejects_subject_digest_source_workflow_and_ambiguous_receipts(self):
        import copy
        original = self.receipt()
        for mutation in ['digest','commit','subject','repo','ref','path','uri','publish-only','zero','duplicate']:
            report=copy.deepcopy(original)
            bundles=report['verified'][0]['attestationBundles']
            slsa=next(b for b in bundles if b['predicateType']=='https://slsa.dev/provenance/v1')
            statement=json.loads(base64.b64decode(slsa['bundle']['dsseEnvelope']['payload']))
            definition=statement['predicate']['buildDefinition']
            if mutation=='digest':statement['subject'][0]['digest']['sha512']='0'*128
            elif mutation=='commit':definition['resolvedDependencies'][0]['digest']['gitCommit']='0'*40
            elif mutation=='subject':statement['subject'][0]['name']='pkg:npm/other@0.9.3'
            elif mutation=='repo':definition['externalParameters']['workflow']['repository']='https://github.com/other/repo'
            elif mutation=='ref':definition['externalParameters']['workflow']['ref']='refs/heads/main'
            elif mutation=='path':definition['externalParameters']['workflow']['path']='.github/workflows/other.yml'
            elif mutation=='uri':definition['resolvedDependencies'][0]['uri']='git+https://github.com/other/repo'
            elif mutation=='publish-only':report['verified'][0]['attestationBundles']=[bundles[0]]
            elif mutation=='zero':report['verified']=[]
            elif mutation=='duplicate':bundles.append(copy.deepcopy(slsa))
            slsa['bundle']['dsseEnvelope']['payload']=base64.b64encode(json.dumps(statement).encode()).decode()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                module.validate_signature_provenance(report)


class SourceBuildCommandTest(unittest.TestCase):
    def test_explicit_source_filter_and_offline_tuple_preserved(self):
        command=module.source_build_command('/verified/forge',['--offline','--use','/verified/wrapper'])
        self.assertEqual(command,['/verified/forge','build','src','--offline','--use','/verified/wrapper','--skip','test','--skip','script'])


class ForgedsPinTest(unittest.TestCase):
    COMMIT='4ca15fcba25aa61a1b436d28b428e30b459f3d56'
    VERSION='forgeds Version: 1.9.1-dev\nCommit SHA: 4ca15fcba25aa61a1b436d28b428e30b459f3d56\nBuild Timestamp: 2026-11-08T18:08:13.913946000Z (1794161293)\nBuild Profile: release\n'
    def test_pins_forgeds_4ca15fcb_instead_of_previous_toolchains(self):
        self.assertEqual(module.FORGEDS_COMMIT,self.COMMIT)
        self.assertFalse(hasattr(module,'FORGE_COMMIT'))
        self.assertEqual(module.forgeds_asset('darwin_arm64'),('forgeds-4ca15fc_darwin_arm64.tar.gz','39c4b0fd5ab8cd7ee2b411a1e0a5ac8519a5566bdd25d50f90ae9bd47ab01f63'))
        self.assertEqual(module.forgeds_asset('linux_amd64'),('forgeds-4ca15fc_linux_amd64.tar.gz','a1341d56a7fc743b4d87853596baaf0931a6e4348106def1a6994bc793c5b62f'))
        with self.assertRaises(ValueError):module.forgeds_asset('win32_amd64')
    def test_version_requires_exact_forgeds_commit(self):
        module.validate_forgeds_version(self.VERSION)
        for text in [
            'forge Version: 1.8.3-stable\nCommit SHA: cae51ad458f6abb64852b7709eb784352429825d\n',
            'forgeds Version: 1.8.8-dev\nCommit SHA: bb92ff96b819bcea5ced55228d122ac725e9ffd9\n',
            self.VERSION.replace(self.COMMIT,self.COMMIT[:7]),
            self.VERSION.replace('1.9.1-dev','1.9.2-dev'),
            '',
        ]:
            with self.subTest(text=text), self.assertRaises(ValueError):module.validate_forgeds_version(text)
    def test_archive_requires_pinned_and_published_digest(self):
        data=b'forgeds archive bytes'
        digest=module.sha(data)
        module.verify_forgeds_archive(data,f'{digest}  forgeds.tar.gz\n',digest)
        for archive,published,pinned in [
            (data+b'x',f'{digest}  forgeds.tar.gz\n',digest),
            (data,f'{"0"*64}  forgeds.tar.gz\n',digest),
            (data,f'{digest}  forgeds.tar.gz\n','0'*64),
            (data,'',digest),
        ]:
            with self.assertRaises(ValueError):module.verify_forgeds_archive(archive,published,pinned)
    def test_forgeds_runs_with_fresh_home_inside_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp)
            env=module.forgeds_environment({'HOME':'/Users/someone','PATH':'/bin'},work,{'EXTRA':'1'})
            self.assertEqual(env['HOME'],str(work/'forgeds-home'))
            self.assertEqual((env['PATH'],env['EXTRA']),('/bin','1'))
            self.assertTrue((work/'forgeds-home').is_dir())
            self.assertEqual(list((work/'forgeds-home').iterdir()),[])
            with self.assertRaises(FileExistsError):module.forgeds_environment({},work,{})


class AuditStreamTest(unittest.TestCase):
    def test_json_stdout_remains_parseable_with_warning_stderr(self):
        import json
        import sys
        result=module.run([sys.executable,'-c',"import sys; print('{\"verified\": []}'); print('npm fixture warning',file=sys.stderr)"],stdout_only=True)
        self.assertEqual(json.loads(result),{'verified':[]})




class SolarPlatformTests(unittest.TestCase):
    def test_darwin_arm64_reaches_source_identity_check(self):
        from unittest.mock import patch
        with patch.object(module.platform, "system", return_value="Darwin"), patch.object(module.platform, "machine", return_value="arm64"), patch.object(module.os, "access", return_value=True), patch.object(module, "run", side_effect=RuntimeError("source identity check")), tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "source identity check"):
                module.qualify(Path(tmp), Path(tmp) / "unused-work")

    def test_solar_release_identity_rejects_wrong_commit(self):
        valid = "solar 0.3.0+commit.e7a91fc7\nSolc-Compatible Version: 0.8.38+commit.e7a91fc7.solar.0.3.0\nCommit SHA: e7a91fc70f29dc8d0c236d56a2aa7706dc2555cf\n"
        module.validate_compiler_version(valid)
        with self.assertRaises(ValueError):
            module.validate_compiler_version(valid.replace("e7a91fc70f29dc8d0c236d56a2aa7706dc2555cf", "0" * 40))


if __name__ == "__main__":
    unittest.main()
