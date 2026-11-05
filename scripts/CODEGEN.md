# Qualified contract code generation

Generation requires explicit absolute `DIESIS_ARTIFACT_PREFLIGHT`,
`DIESIS_ARTIFACT_MANIFEST`, `DIESIS_ARTIFACTS_DIR` and `ABI_TYPEGEN` paths.
`ABI_TYPEGEN` must select an independently verified raw executable whose digest,
version and source match the manifest. The SDK owns the exact 0.9.1 package pin,
but script-free installation does not download its raw binary. Neither the npm
shim nor a missing package bin directory is used as a fallback.
Both helpers recompute manifest validity through the real
`scripts/verify-contract-artifacts.py`; missing helpers or mismatches fail closed.

`pnpm codegen` generates all 45 vendored viem ABIs from these qualified artifacts
and the five public wrapper targets from the same artifact directory. `pnpm
codegen:check` generates fresh intermediates and checks byte equality without
editing tracked outputs. It does not compile, read contracts/src/abi, invoke the
contracts package, or default to an existing out directory.

`qualify-contract-inputs.py` accepts exact contracts
`17f837ac61c4e1088fb4acbb95e45d6f1d7b8e9d` on Linux x86_64 or macOS arm64.
It verifies locked dependency archives, Forge 1.8.3/source cae51ad, Solar
0.3.0/source e7a91fc7 (Solidity 0.8.38), and abi-typegen 0.9.1 package integrity,
npm signatures/provenance, and platform archive checksums. It performs one
offline source-only build. The capture wrapper adapts Solar's declared compatible
version to Forge's solc banner format; compiler inputs and outputs remain exact.
The verifier checks those captured bytes against pinned source, dependencies,
metadata, bytecode, and ABIs before generation. Forge's typed metadata projection
omits Solar's compiler name and inserts absent license fields as null; raw
metadata is compared without normalization.

The macOS arm64 path was executed for this revision. Linux CI uses the same
checks but needs its own execution result. No package publication or deployed
network validation is implied. Preserve generated-source, SDK quality, consumer,
provenance and independent review gates.
