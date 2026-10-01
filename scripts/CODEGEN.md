# Qualified contract code generation

Generation requires explicit absolute `DIESIS_ARTIFACT_PREFLIGHT`,
`DIESIS_ARTIFACT_MANIFEST`, `DIESIS_ARTIFACTS_DIR` and `ABI_TYPEGEN` paths.
`ABI_TYPEGEN` must select an independently verified raw executable whose digest,
version and source match the manifest. The SDK owns the exact 0.7.0 package pin,
but script-free installation does not download its raw binary. Neither the npm
shim nor a missing package bin directory is used as a fallback.
Both helpers recompute manifest validity through the real
`scripts/verify-contract-artifacts.py`; missing helpers or mismatches fail closed.

`pnpm codegen` generates all 45 vendored viem ABIs from these qualified artifacts
and the five public wrapper targets from the same artifact directory. `pnpm
codegen:check` generates fresh intermediates and checks byte equality without
editing tracked outputs. It does not compile, read contracts/src/abi, invoke the
contracts package, or default to an existing out directory.

CI invokes `qualify-contract-inputs.py` against exact contracts e905d65, on Linux
x86_64 only. It installs locked checksum-verified dependency archives, verifies
Forge 1.8.3/source cae51ad and official solc 0.8.35+47b9dedd, verifies the npm07
registry integrity/signatures/provenance and platform archive checksum, and runs
one offline source-only build through the captured compiler. Full captured inputs
and outputs are independently checked before generation. No caches, Permit2,
submodules, circuits, test compile, retry, or contracts-owned generator is used.
The Homebrew/macOS qualification and Linux CI are distinct platform records.

The portable Linux path is source-reviewed locally and tested with fake data;
actual Linux tool execution and hosted CI remain separate qualification gates.
Do not describe fake-fixture success as a successful compile or publication.
Root owns accepted artifact generation and publication. Preserve generated-source,
full SDK quality, consumer, provenance and independent review gates.
