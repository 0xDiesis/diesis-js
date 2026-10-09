import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('qualifier',Path(__file__).parents[1]/'scripts/qualify-contract-inputs.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class QualifierTests(unittest.TestCase):
    def test_exact_source_and_release_tuple(self):
        self.assertEqual(module.REVISION,'281dcae85f6c695c00323b359877630ae4857b2e')
        self.assertEqual(module.FORGE_COMMIT,'cae51ad458f6abb64852b7709eb784352429825d')
        self.assertEqual(module.GENERATOR_COMMIT,'66d6e86e8aa6ebc06b22ebf8355cbaea256f0502')
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
        with patch.object(module.platform,'system',return_value='Darwin'), patch.object(module,'download') as download:
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
    # The stored receipt was verified by npm audit signatures. Mutations test
    # structural binding only, not cryptographic acceptance of altered payloads.
    def receipt(self):
        import json
        return json.loads((Path(__file__).parent / 'fixtures/npm-abi-typegen-0.8.0-verified-audit.json').read_text())

    def test_actual_verified_receipt_binds_published_source(self):
        module.validate_signature_provenance(self.receipt())

    def test_rejects_subject_digest_source_workflow_and_ambiguous_receipts(self):
        import base64
        import json
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
            elif mutation=='subject':statement['subject'][0]['name']='pkg:npm/other@0.8.0'
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


class AuditStreamTest(unittest.TestCase):
    def test_json_stdout_remains_parseable_with_warning_stderr(self):
        import json
        import sys
        result=module.run([sys.executable,'-c',"import sys; print('{\"verified\": []}'); print('npm fixture warning',file=sys.stderr)"],stdout_only=True)
        self.assertEqual(json.loads(result),{'verified':[]})


if __name__ == '__main__':
    unittest.main()
