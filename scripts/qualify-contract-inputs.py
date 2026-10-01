#!/usr/bin/env python3
"""One isolated Linux x86_64 ABI build; fail closed before SDK generation."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import subprocess
import tarfile
import tomllib
import urllib.request
import zipfile

REVISION = 'e905d65c6a52df39f1d73906e9f5e91bd69011e9'
FORGE_COMMIT = 'cae51ad458f6abb64852b7709eb784352429825d'
GENERATOR_COMMIT = 'e7e56176a4be4dd104ec3a05020fbacee414f88e'
SRI = 'sha512-+i/j5HGm9QO3ri2JuYjSwoa5RMMXPNmYEaR162lXShfvdzDRoJP45LysW4oeichqQD8qWiYFuPRj7Io5WOoOHg=='


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def download(url, destination):
    require(url.startswith('https://'), 'HTTPS required')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'diesis-sdk-provenance'}), timeout=120) as response:
        data = response.read()
    destination.write_bytes(data)
    return data


def json_download(url, destination):
    return json.loads(download(url, destination))


def safe_name(name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'archive path escape')
    return path


def extract_zip(data, destination):
    files = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        seen = set()
        for info in archive.infolist():
            safe_name(info.filename)
            require(info.filename not in seen, 'duplicate ZIP member')
            seen.add(info.filename)
            require((info.external_attr >> 16) & 0o170000 != 0o120000, 'ZIP symlink')
            if info.is_dir():
                continue
            content = archive.read(info)
            path = destination / info.filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            files.append({'path':info.filename, 'sha256':sha(content)})
    return files


def tar_files(data):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for info in archive:
            safe_name(info.name)
            require(info.isdir() or info.isfile(), 'nonregular TAR member')
            if info.isfile():
                require(info.name not in files, 'duplicate TAR member')
                files[info.name] = archive.extractfile(info).read()
    return files


def executable(path, data):
    path.write_bytes(data)
    path.chmod(0o700)
    return path


def run(args, cwd=None, env=None, stdout_only=False):
    return subprocess.check_output([str(x) for x in args], cwd=cwd, env=env, stderr=None if stdout_only else subprocess.STDOUT).decode()



def validate_signature_provenance(report):
    """Bind an npm-verified DSSE statement; this function does not verify signatures."""
    require(isinstance(report, dict) and not report.get('invalid') and not report.get('missing'), 'npm audit errors')
    packages = [item for item in report.get('verified', []) if item.get('name') == '@0xdoublesharp/abi-typegen' and item.get('version') == '0.7.0']
    require(len(packages) == 1, 'exact verified package required')
    bundles = [item for item in packages[0].get('attestationBundles', []) if item.get('predicateType') == 'https://slsa.dev/provenance/v1']
    require(len(bundles) == 1, 'unique verified SLSA statement required')
    envelope = bundles[0]['bundle']['dsseEnvelope']
    require(envelope.get('payloadType') == 'application/vnd.in-toto+json', 'wrong DSSE payload type')
    payload = envelope['payload']
    require(isinstance(payload, str) and len(payload) < 2000000, 'invalid DSSE payload')
    statement = json.loads(base64.b64decode(payload, validate=True))
    require(statement.get('_type') == 'https://in-toto.io/Statement/v1' and statement.get('predicateType') == 'https://slsa.dev/provenance/v1', 'wrong SLSA statement')
    expected_digest = base64.b64decode(SRI.split('-', 1)[1], validate=True).hex()
    require(statement.get('subject') == [{'name':'pkg:npm/%400xdoublesharp/abi-typegen@0.7.0', 'digest':{'sha512':expected_digest}}], 'SLSA subject differs from pinned package integrity')
    definition = statement['predicate']['buildDefinition']
    require(definition.get('buildType') == 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1', 'wrong release build type')
    require(definition.get('externalParameters', {}).get('workflow') == {'ref':'refs/tags/v0.7.0', 'repository':'https://github.com/doublesharp/abi-typegen', 'path':'.github/workflows/release.yml'}, 'wrong release workflow')
    require(definition.get('resolvedDependencies') == [{'uri':'git+https://github.com/doublesharp/abi-typegen@refs/tags/v0.7.0', 'digest':{'gitCommit':GENERATOR_COMMIT}}], 'wrong release source commit')

def source_build_command(forge, common):
    return [forge, 'build', 'src', *common, '--skip', 'test', '--skip', 'script']


def qualify(checkout, work):
    require(platform.system() == 'Linux' and platform.machine() in ('x86_64','AMD64'), 'qualified platform is Linux x86_64 only')
    verifier = Path(__file__).with_name('verify-contract-artifacts.py')
    require(verifier.is_file() and not verifier.is_symlink(), 'reviewed verifier missing before build')
    wrapper = Path(__file__).with_name('solc-capture.py')
    require(wrapper.is_file() and not wrapper.is_symlink() and os.access(wrapper, os.X_OK), 'capture wrapper missing before build')
    checkout = checkout.resolve(strict=True)
    require(run(['git',f'--work-tree={checkout}','-C',checkout,'rev-parse','HEAD']).strip() == REVISION, 'wrong contracts HEAD')
    require(not run(['git',f'--work-tree={checkout}','-C',checkout,'status','--porcelain']).strip(), 'dirty contracts checkout')
    require(not any(k.startswith('FOUNDRY_') for k in os.environ), 'ambient FOUNDRY configuration')
    require(not (Path.home()/'.foundry/foundry.toml').exists(), 'global Foundry config')
    require(not work.exists(), 'work directory must be fresh')
    work.mkdir(parents=True)
    dependencies = []
    for item in tomllib.loads((checkout/'soldeer.lock').read_text())['dependencies']:
        archive = work / (item['name'].replace('@','') + '.zip')
        data = download(item['url'], archive)
        require(sha(data) == item['checksum'], 'locked dependency checksum')
        root = checkout/'dependencies'/f"{item['name']}-{item['version']}"
        require(not root.exists(), 'dependency directory must be fresh')
        files = extract_zip(data, root)
        dependencies.append({'name':item['name'],'version':item['version'],'archivePath':str(archive),'archiveSha256':sha(data),'lockIntegrity':item['integrity'],'url':item['url'],'root':str(root),'files':files})
    dep_manifest=work/'dependencies.json';dep_manifest.write_text(json.dumps(dependencies))
    release=json_download('https://api.github.com/repos/foundry-rs/foundry/releases/tags/v1.8.3',work/'forge-release.json')
    ref=json_download('https://api.github.com/repos/foundry-rs/foundry/git/ref/tags/v1.8.3',work/'forge-tag.json')['object']
    if ref['type']=='tag':
        ref=json_download(ref['url'],work/'forge-tag-object.json')['object']
    require(ref['sha']==FORGE_COMMIT,'Forge release source mismatch')
    assets=[a for a in release['assets'] if a['name']=='foundry_v1.8.3_linux_amd64.tar.gz']
    require(len(assets)==1 and assets[0].get('digest','').startswith('sha256:'),'official Forge release digest unavailable')
    data=download(assets[0]['browser_download_url'],work/'forge.tar.gz')
    require(sha(data)==assets[0]['digest'].split(':')[1],'Forge archive checksum')
    forge=executable(work/'forge',tar_files(data)['forge'])
    forge_version=run([forge,'--version']);require('1.8.3' in forge_version and FORGE_COMMIT in forge_version,'Forge version/source tuple')
    compiler_list=json_download('https://binaries.soliditylang.org/linux-amd64/list.json',work/'solc-list.json')
    entries=[b for b in compiler_list['builds'] if b['version']=='0.8.35' and b['longVersion']=='0.8.35+commit.47b9dedd']
    require(len(entries)==1,'official compiler tuple missing')
    entry=entries[0];data=download('https://binaries.soliditylang.org/linux-amd64/'+entry['path'],work/'solc.bin')
    require(sha(data)==entry['sha256'].removeprefix('0x'),'official compiler digest mismatch')
    solc=executable(work/'solc',data);require('0.8.35+commit.47b9dedd' in run([solc,'--version']),'compiler long version')
    registry=json_download('https://registry.npmjs.org/@0xdoublesharp/abi-typegen/0.7.0',work/'typegen-registry.json')
    require(registry['gitHead']==GENERATOR_COMMIT and registry['dist']['integrity']==SRI,'published generator identity')
    # npm's official audit verifies registry signatures and published provenance.
    # Isolated install is script-free; it does not execute the download shim.
    npm_audit=work/'npm-provenance';npm_audit.mkdir()
    (npm_audit/'package.json').write_text(json.dumps({'private':True,'packageManager':json.loads((Path(__file__).parents[1]/'package.json').read_text())['packageManager'],'dependencies':{'@0xdoublesharp/abi-typegen':'0.7.0'}}))
    run(['pnpm','install','--ignore-scripts','--registry=https://registry.npmjs.org'],cwd=npm_audit)
    audit_text = run(['npm', 'audit', 'signatures', '--json', '--include-attestations', '--registry=https://registry.npmjs.org'], cwd=npm_audit, stdout_only=True)
    audit = json.loads(audit_text)
    validate_signature_provenance(audit)
    (work / 'npm-signature-verification.json').write_text(audit_text)
    data=download(registry['dist']['tarball'],work/'typegen-npm.tgz')
    require('sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()==SRI,'npm SRI mismatch')
    npm=tar_files(data);checksums=json.loads(npm['package/checksums.json'])
    archive_name='abi-typegen-x86_64-unknown-linux-gnu.tar.gz'
    data=download('https://github.com/doublesharp/abi-typegen/releases/download/v0.7.0/'+archive_name,work/'typegen-platform.tgz')
    require(sha(data)==checksums['files'][archive_name],'generator platform checksum')
    typegen=executable(work/'abi-typegen',tar_files(data)['abi-typegen'])
    require(run([typegen,'--version']).strip()=='abi-typegen 0.7.0','generator actual version')
    outputs={k:str(work/k) for k in ('out','cache','captures','build-info')}
    for directory in outputs.values():Path(directory).mkdir()
    wrapper=Path(__file__).with_name('solc-capture.py').resolve()
    env=dict(os.environ,DIESIS_SDK_REAL_SOLC=str(solc),DIESIS_SDK_SOLC_CAPTURE_DIR=outputs['captures'])
    common=['--root',str(checkout),'--offline','--use',str(wrapper),'--evm-version','osaka','--via-ir','--optimize','--optimizer-runs','200','--out',outputs['out'],'--cache-path',outputs['cache'],'--build-info','--build-info-path',outputs['build-info']]
    config=json.loads(run([forge,'config','--json',*common],cwd=checkout,env=env))
    require(config['solc']==str(wrapper) and config['optimizer'] and config['optimizer_runs']==200 and config['via_ir'] and config['evm_version']=='osaka' and config['build_info'],'resolved compiler config mismatch')
    (work/'forge-config.json').write_text(json.dumps(config))
    command=source_build_command(forge, common)
    (work/'build-argv.json').write_text(json.dumps([str(x) for x in command]))
    with (work/'build.log').open('wb') as log:
        result=subprocess.run([str(x) for x in command],cwd=checkout,env=env,stdout=log,stderr=subprocess.STDOUT)
    require(result.returncode==0,'sole Forge build failed; no automatic retry permitted')
    proof={'checkout':str(checkout),'contractsRevision':REVISION,'dependencyManifest':str(dep_manifest),'solc':{'path':str(solc),'sha256':sha(solc.read_bytes()),'longVersion':'0.8.35+commit.47b9dedd'},'generator':{'path':str(typegen),'binarySha256':sha(typegen.read_bytes()),'version':'abi-typegen 0.7.0','sourceCommit':GENERATOR_COMMIT},'outputs':outputs,'forge':{'path':str(forge),'sha256':sha(forge.read_bytes()),'version':forge_version},'captureWrapperSha256':sha(wrapper.read_bytes())}
    proof['capturedCompilations']=[]
    for capture in sorted(Path(outputs['captures']).iterdir()):
        m=json.loads((capture/'manifest.json').read_text())
        proof['capturedCompilations'].append({'captureId':m['captureId'],'inputSha256':m['files']['stdin.bin']['sha256'],'outputSha256':m['files']['stdout.bin']['sha256'],'compilerSha256':m['compilerSha256']})
    preflight=work/'preflight.json';preflight.write_text(json.dumps(proof,indent=2))
    manifest=work/'manifest.json'
    run(['python3',Path(__file__).with_name('verify-contract-artifacts.py'),'--preflight',preflight,'--output',manifest])
    return {'DIESIS_ARTIFACT_PREFLIGHT':str(preflight),'DIESIS_ARTIFACT_MANIFEST':str(manifest),'DIESIS_ARTIFACTS_DIR':outputs['out'],'ABI_TYPEGEN':str(typegen)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--contracts',type=Path,required=True);parser.add_argument('--work',type=Path,required=True);parser.add_argument('--environment-output',type=Path,required=True)
    args=parser.parse_args();variables=qualify(args.contracts,args.work.resolve());args.environment_output.write_text(''.join(f'{k}={v}\n' for k,v in variables.items()))
