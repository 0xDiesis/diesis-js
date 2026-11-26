#!/usr/bin/env python3
"""Qualify captured solc JSON against pinned Git, locked archives and Forge artifacts.

This is a provenance/consistency verifier, not a Solidity compiler or EVM verifier.
No network or compiler/generator execution. Python 3.11+ standard library only.
"""
import argparse
import copy
import ast
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import tarfile
import tomllib
import zipfile


CONTRACTS_REVISION = 'f0f9df1408efcf9bd8b996266ec91504e5e1e372'
GENERATOR_SOURCE = 'fbf6f7468c952863f2318a450520ac0933cbd65d'
GENERATOR_INTEGRITY = 'sha512-65WfWmjtwff3cP031oVM1ARmyFmeCuLvTPOjHzUccVYA+4nmbym5BzARO8oLkvhTQIwsXVDJlx1CZuOItdUHkg=='
# From checksums.json in the SRI-pinned, provenance-verified npm package.
GENERATOR_ARCHIVES = {
    'aarch64-apple-darwin': 'eadb57b6629980470ed7f7be0605df242eae2f12b8988fd9c4acf2fb7ce15860',
    'x86_64-unknown-linux-gnu': 'ac05b8edc9516c115711315e6cfd87dc854f33de2fced09aa8001d482e145802',
}
FORGEDS_SOURCE = '4ca15fcba25aa61a1b436d28b428e30b459f3d56'
# Archive and executable pins from the contracts repository's setup action.
FORGEDS_DIGESTS = {
    '39c4b0fd5ab8cd7ee2b411a1e0a5ac8519a5566bdd25d50f90ae9bd47ab01f63':
        'a94c0565fc86a3cc91b73b745bfa76dfb5dfafbaf3beaba536b36651fd9e044d',
    'a1341d56a7fc743b4d87853596baaf0931a6e4348106def1a6994bc793c5b62f':
        '236083c70a100792a61206fb48aa082813671c0e5623bf11d7d0a03ea02ded5d',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(Path(path).read_bytes(), object_pairs_hook=unique)


def regular(path):
    path = Path(path)
    require(not path.is_symlink() and path.is_file(), f'not a regular file: {path}')
    return path.read_bytes()


def verify_generator(generator):
    require(generator['sourceCommit'] == GENERATOR_SOURCE, 'generator source mismatch')
    require(generator['version'] == 'abi-typegen 0.9.3', 'generator version mismatch')
    require(generator['packageIntegrity'] == GENERATOR_INTEGRITY, 'generator package integrity mismatch')
    archive = regular(generator['archivePath'])
    pinned = GENERATOR_ARCHIVES.get(generator['target'])
    require(sha(archive) == pinned == generator['archiveSha256'], 'generator release archive mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as release:
        binaries = [member for member in release if member.name == 'abi-typegen']
        require(len(binaries) == 1 and binaries[0].isfile(), 'unique generator executable required')
        binary_digest = sha(release.extractfile(binaries[0]).read())
    require(sha(regular(generator['path'])) == binary_digest == generator['binarySha256'], 'generator binary hash mismatch')


def verify_forgeds(forge):
    require(forge['sourceCommit'] == FORGEDS_SOURCE, 'forgeds source mismatch')
    require('Commit SHA: ' + FORGEDS_SOURCE in forge['version'].splitlines(), 'forgeds version mismatch')
    pinned = FORGEDS_DIGESTS.get(forge['archiveSha256'])
    require(sha(regular(forge['path'])) == pinned == forge['sha256'], 'forgeds binary hash mismatch')


def safe_relative(name):
    require(isinstance(name, str) and name and '\\' not in name, f'invalid source path: {name}')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and str(p) == name, f'invalid source path: {name}')
    return name


def git(checkout, *args):
    # Explicit work-tree is mandatory: shared submodule config can point elsewhere.
    return subprocess.check_output(['git', f'--work-tree={checkout}', '-C', str(checkout), *args])


TOKEN = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_$][\w$]*|[^\s]')


def imports(content):
    # Tokenize comments and string literals before recognizing import statements.
    # All four Solidity import forms use precisely one string literal. Fail closed
    # on unsupported escapes rather than claim closure from a partial scan.
    tokens = [t for t in TOKEN.findall(content) if not t.startswith(('//', '/*'))]
    result = []
    for i, token in enumerate(tokens):
        if token != 'import':
            continue
        end = i + 1
        while end < len(tokens) and tokens[end] != ';':
            end += 1
        require(end < len(tokens), 'unterminated import')
        literals = [t for t in tokens[i + 1:end] if t.startswith(('"', "'"))]
        require(len(literals) == 1, 'unsupported import syntax')
        require('\\' not in literals[0], 'unsupported escaped import path')
        name = ast.literal_eval(literals[0])
        require(isinstance(name, str) and name.isascii(), 'unsupported import path')
        result.append(name)
    return result


def remap(source, imported, mappings):
    name = posixpath.normpath(posixpath.join(posixpath.dirname(source), imported)) if imported.startswith('.') else imported
    candidates = []
    for mapping in mappings:
        require(isinstance(mapping, str) and mapping.count('=') == 1, 'invalid remapping')
        left, target = mapping.split('=')
        context, prefix = left.split(':', 1) if ':' in left else ('', left)
        require(prefix, 'empty remapping prefix')
        if source.startswith(context) and name.startswith(prefix):
            candidates.append((len(context), len(prefix), target + name[len(prefix):]))
    if candidates:
        candidates.sort(reverse=True)
        best = candidates[0]
        require(all(c[:2] != best[:2] or c[2] == best[2] for c in candidates), 'ambiguous remapping')
        name = best[2]
    return safe_relative(posixpath.normpath(name))


def abi_bytes(abi):
    require(isinstance(abi, list), 'invalid ABI')
    normalized = [dict(entry) for entry in abi]
    for entry in normalized:
        if entry.get('outputs') == []:
            entry.pop('outputs')
        if entry.get('type') in ['receive', 'fallback'] and entry.get('inputs') == []:
            entry.pop('inputs')
    return canonical(sorted(normalized, key=lambda entry: canonical(entry)))


def forge_metadata(value):
    # Forge stores rawMetadata losslessly but its typed metadata projection drops
    # these fields. Normalize only that documented representation; raw stays exact.
    result = copy.deepcopy(value)
    # The typed projection omits Solar's compiler name and
    # inserts null for absent source licenses. rawMetadata remains byte-exact.
    result.get('compiler', {}).pop('name', None)
    for source in result.get('sources', {}).values():
        if source.get('license') is None:
            source.pop('license', None)
    settings = result.get('settings', {})
    if 'remappings' in settings:
        settings['remappings'] = [x.removeprefix(':') for x in settings['remappings']]
    output = result.get('output', {})
    if 'abi' in output:
        output['abi'] = json.loads(abi_bytes(output['abi']))
    for doc in ['devdoc', 'userdoc']:
        if doc in output:
            output[doc] = {k: v for k, v in output[doc].items() if k in ['kind', 'methods', 'version']}
    return result


def bytecode(value):
    require(isinstance(value, dict) and isinstance(value.get('object'), str), 'missing bytecode')
    result = dict(value)
    result['object'] = result['object'].removeprefix('0x')
    if result.get('immutableReferences') == {}:
        result.pop('immutableReferences')
    return result


def verify(preflight_path):
    preflight = load(preflight_path)
    checkout = Path(preflight['checkout']).resolve(strict=True)
    revision = preflight['contractsRevision']
    require(revision == CONTRACTS_REVISION, 'wrong contracts revision')
    require(git(checkout, 'rev-parse', revision).decode().strip() == revision, 'Git revision mismatch')
    tracked = git(checkout, 'ls-tree', '-r', '-z', revision).split(b'\0')
    sources = {}
    tracked_files = {}
    for row in filter(None, tracked):
        header, name_bytes = row.split(b'\t', 1)
        mode, kind, oid = header.split()
        name = name_bytes.decode()
        if kind == b'blob':
            tracked_files[name] = (mode, oid)
            if name.endswith('.sol'):
                require(mode in (b'100644', b'100755'), f'symlink source: {name}')
                sources[name] = git(checkout, 'cat-file', 'blob', oid.decode())
    def pinned(name):
        require(name in tracked_files, f'missing pinned file: {name}')
        return git(checkout, 'cat-file', 'blob', tracked_files[name][1].decode())
    names = [line.strip() for line in pinned('abi-contracts.txt').decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    require(len(names) == len(set(names)) and names, 'duplicate ABI names')
    locked = tomllib.loads(pinned('soldeer.lock').decode())['dependencies']
    lock_map = {(x['name'], x['version']): x for x in locked}
    dependencies = load(preflight['dependencyManifest'])
    require(len(dependencies) == len(lock_map), 'dependency lock coverage mismatch')
    dep_receipts = []
    seen_deps = set()
    for dependency in dependencies:
        identity = (dependency['name'], dependency['version'])
        require(identity in lock_map and identity not in seen_deps, 'dependency identity mismatch')
        seen_deps.add(identity)
        lock = lock_map[identity]
        require((dependency['archiveSha256'], dependency['lockIntegrity'], dependency['url']) == (lock['checksum'], lock['integrity'], lock['url']), 'dependency lock mismatch')
        archive = Path(dependency['archivePath'])
        require(sha(regular(archive)) == lock['checksum'], 'dependency archive hash mismatch')
        root = Path(dependency['root'])
        require(not root.is_symlink(), 'dependency root symlink')
        relative_root = root.resolve(strict=True).relative_to(checkout).as_posix()
        listed = {safe_relative(x['path']): x['sha256'] for x in dependency['files']}
        require(len(listed) == len(dependency['files']), 'duplicate dependency file')
        with zipfile.ZipFile(archive) as z:
            entries = [x for x in z.infolist() if not x.is_dir()]
            require(len({x.filename for x in entries}) == len(entries), 'duplicate archive entry')
            require({safe_relative(x.filename) for x in entries} == set(listed), 'dependency archive file coverage mismatch')
            for info in entries:
                require(((info.external_attr >> 16) & 0o170000) != 0o120000, 'archive symlink')
                data = z.read(info)
                require(sha(data) == listed[info.filename], 'dependency archive content mismatch')
                disk = root / info.filename
                require(disk.resolve(strict=True).is_relative_to(root.resolve()), 'dependency path escape')
                require(sha(regular(disk)) == listed[info.filename], 'dependency disk content mismatch')
                if info.filename.endswith('.sol'):
                    name = relative_root + '/' + info.filename
                    require(name not in sources, 'duplicate source identity')
                    sources[name] = data
        dep_receipts.append({'name':identity[0], 'version':identity[1], 'archiveSha256':lock['checksum'], 'fileHashes':listed})
    generator = preflight['generator']
    verify_generator(generator)
    forge = preflight['forge']
    verify_forgeds(forge)
    compiler = preflight['solc']
    require(sha(regular(compiler['path'])) == compiler['sha256'], 'compiler hash mismatch')
    require(compiler['longVersion'] == '0.8.38+commit.e7a91fc7.solar.0.3.0', 'compiler version mismatch')
    accepted_remappings = [line.strip() for line in pinned('remappings.txt').decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    all_inputs, outputs, capture_receipts = {}, {}, []
    capture_root = Path(preflight['outputs']['captures'])
    require(not capture_root.is_symlink(), 'capture root symlink')
    stages = sorted(capture_root.iterdir())
    require(stages, 'missing compiler captures')
    anchors = {x['captureId']:x for x in preflight['capturedCompilations']}
    require(len(anchors) == len(preflight['capturedCompilations']) and set(anchors) == {stage.name for stage in stages}, 'capture anchor coverage mismatch')
    for stage in stages:
        require(stage.is_dir() and not stage.is_symlink() and not stage.name.startswith('.'), 'incomplete capture directory')
        manifest = load(stage / 'manifest.json')
        require(manifest['version'] == 1 and manifest['captureId'] == stage.name, 'capture identity mismatch')
        require(manifest['compilerSha256'] == compiler['sha256'] and Path(manifest['compiler']).resolve() == Path(compiler['path']).resolve(), 'capture compiler mismatch')
        require(manifest['exitCode'] == 0 and manifest['signal'] is None and not manifest['receivedSignals'], 'compiler exit/signals failed')
        require('--standard-json' in manifest['argv'] and Path(manifest['cwd']).resolve() == checkout, 'capture argv/cwd mismatch')
        for filename in ['stdin.bin', 'stdout.bin', 'stderr.bin']:
            data = regular(stage / filename)
            require(manifest['files'][filename] == {'sha256':sha(data), 'bytes':len(data)}, 'capture bytes/hash mismatch')
        require(anchors[stage.name] == {'captureId':stage.name, 'inputSha256':manifest['files']['stdin.bin']['sha256'], 'outputSha256':manifest['files']['stdout.bin']['sha256'], 'compilerSha256':manifest['compilerSha256']}, 'capture differs from trusted preflight anchor')
        incoming, outgoing = load(stage / 'stdin.bin'), load(stage / 'stdout.bin')
        require(incoming['language'] == 'Solidity', 'wrong compiler language')
        settings = incoming['settings']
        require(settings.get('optimizer', {}).get('enabled') is True and settings['optimizer'].get('runs') == 200 and settings.get('viaIR') is True and settings.get('evmVersion') == 'osaka', 'wrong compiler settings')
        mappings = settings.get('remappings', [])
        require(sorted(mappings) == sorted(accepted_remappings), 'remappings differ from pinned source')
        selection = settings.get('outputSelection', {})
        selected = selection.get('*', {}).get('*', [])
        for field in ['abi', 'metadata', 'evm.bytecode.object', 'evm.bytecode.sourceMap', 'evm.bytecode.linkReferences', 'evm.deployedBytecode.object', 'evm.deployedBytecode.sourceMap', 'evm.deployedBytecode.linkReferences']:
            require(any(field == x or field.startswith(x + '.') or x == '*' for x in selected), 'incomplete global outputSelection: ' + field)
        require('ast' in selection.get('*', {}).get('', []), 'incomplete source outputSelection')
        supplied = incoming['sources']
        require(supplied and set(outgoing.get('sources', {})) == set(supplied), 'compiler output source coverage mismatch')
        require(not any(x.get('severity') == 'error' for x in outgoing.get('errors', [])), 'compiler reported errors')
        for name, entry in supplied.items():
            safe_relative(name)
            require(set(entry) == {'content'} and isinstance(entry['content'], str), 'source must contain inline content only')
            data = entry['content'].encode()
            require(name in sources and sources[name] == data, 'input source differs from pinned Git/archive: ' + name)
            require(name not in all_inputs or all_inputs[name] == sha(data), 'conflicting captured source')
            all_inputs[name] = sha(data)
            for imported in imports(entry['content']):
                resolved = remap(name, imported, mappings)
                require(resolved in supplied, f'missing transitive import: {name} -> {resolved}')
        for source, contracts in outgoing.get('contracts', {}).items():
            require(source in supplied, 'compiler emitted unprovided source')
            for name, contract in contracts.items():
                identity = source + ':' + name
                require(identity not in outputs or outputs[identity] == contract, 'conflicting compiler identity')
                outputs[identity] = contract
        capture_receipts.append({'captureId':stage.name, 'manifestSha256':sha(regular(stage/'manifest.json')), 'files':manifest['files'], 'settings':settings})
    artifact_root = Path(preflight['outputs']['out'])
    require(not artifact_root.is_symlink(), 'artifact root symlink')
    files = sorted(artifact_root.rglob('*.json'))
    for path in files:
        require(not any(parent.is_symlink() for parent in [path, *path.parents] if parent.is_relative_to(artifact_root)), 'artifact symlink path')
    artifacts = {}
    for name in names:
        identities = [identity for identity in outputs if identity.rsplit(':', 1)[1] == name]
        require(len(identities) == 1, 'missing or duplicate compiler contract name: ' + name)
        identity = identities[0]
        source, _ = identity.rsplit(':', 1)
        require(source.startswith('src/') and source in tracked_files, 'ABI contract outside pinned src: ' + identity)
        matched = [file for file in files if file.stem == name]
        require(len(matched) == 1, 'missing or duplicate artifact identity: ' + identity)
        path = matched[0]
        artifact, compiled = load(path), outputs[identity]
        raw_metadata = compiled.get('metadata')
        require(isinstance(raw_metadata, str), 'missing compiler metadata')
        metadata = json.loads(raw_metadata)
        require(metadata['compiler']['version'] == compiler['longVersion'], 'metadata compiler version mismatch')
        require(metadata['settings']['compilationTarget'] == {source:name}, 'metadata qualified identity mismatch')
        require(artifact.get('rawMetadata') == raw_metadata and forge_metadata(artifact.get('metadata')) == forge_metadata(metadata), 'artifact metadata mismatch: ' + identity)
        require(abi_bytes(artifact['abi']) == abi_bytes(compiled['abi']), 'artifact ABI mismatch: ' + identity)
        require(isinstance(compiled['evm'].get('methodIdentifiers'), dict) and artifact.get('methodIdentifiers') == compiled['evm']['methodIdentifiers'], 'artifact method identifiers mismatch: ' + identity)
        for field in ['bytecode', 'deployedBytecode']:
            require(bytecode(artifact[field]) == bytecode(compiled['evm'][field]), 'artifact ' + field + ' mismatch: ' + identity)
        artifacts[identity] = {'artifactPath':path.relative_to(artifact_root).as_posix(), 'artifactSha256':sha(regular(path)), 'abiSha256':sha(abi_bytes(compiled['abi'])), 'metadataSha256':sha(raw_metadata.encode()), 'bytecodeSha256':sha(canonical(bytecode(compiled['evm']['bytecode']))), 'deployedBytecodeSha256':sha(canonical(bytecode(compiled['evm']['deployedBytecode'])))}
    return {
        'version': 1,
        'preflightSha256': sha(regular(preflight_path)),
        'contractsRevision': revision,
        'compiler': compiler,
        'forge': forge,
        'generator': generator,
        'dependencies': dep_receipts,
        'inputSources': dict(sorted(all_inputs.items())),
        'captures': capture_receipts,
        'artifacts': artifacts,
        'artifactRoot': str(artifact_root.resolve()),
        'selectedArtifacts': [
            {
                'contract': identity.rsplit(':', 1)[1],
                'source': identity.rsplit(':', 1)[0],
                'path': entry['artifactPath'],
                'sha256': entry['artifactSha256'],
                'abiSha256': entry['abiSha256'],
            }
            for identity, entry in artifacts.items()
        ],
        'limitations': [
            'Consistency and pinned-input provenance only. Does not establish compiler or generator correctness, EVM execution, or deployment.',
            'Import lexer supports literal ASCII Solidity import forms; escaped paths and ambiguous remappings fail closed. No import callback/network resolution allowed.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preflight', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--output', type=Path)
    mode.add_argument('--check', type=Path)
    args = parser.parse_args()
    result = verify(args.preflight)
    if args.check:
        require(load(args.check) == result, 'qualification manifest differs from freshly verified inputs/artifacts')
        return
    # Immutable final manifest: do not overwrite a prior qualification tuple.
    with args.output.open('x') as output:
        json.dump(result, output, indent=2, sort_keys=True)
        output.write('\n')


if __name__ == '__main__':
    main()
