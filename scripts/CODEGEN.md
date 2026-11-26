# Qualified contract code generation

Generation requires explicit absolute `DIESIS_ARTIFACT_PREFLIGHT`,
`DIESIS_ARTIFACT_MANIFEST`, `DIESIS_ARTIFACTS_DIR` and `ABI_TYPEGEN` paths.
`ABI_TYPEGEN` must select an independently verified raw executable whose digest,
version and source match the manifest. The SDK owns the exact 0.9.3 package pin,
but script-free installation does not download its raw binary. Neither the npm
shim nor a missing package bin directory is used as a fallback.
Both helpers recompute manifest validity through the real
`scripts/verify-contract-artifacts.py`; missing helpers or mismatches fail closed.

`pnpm codegen` generates all 47 vendored viem ABIs from these qualified artifacts
and the five public wrapper targets from the same artifact directory. `pnpm
codegen:check` generates fresh intermediates and checks byte equality without
editing tracked outputs. It does not compile, read contracts/src/abi, invoke the
contracts package, or default to an existing out directory.

`qualify-contract-inputs.py` accepts exact contracts
`f0f9df1408efcf9bd8b996266ec91504e5e1e372` on Linux x86_64 or macOS arm64.
Use a fresh copy of that revision because qualification installs the locked
Soldeer dependencies into the checkout. Pass `--contracts`, `--work`, and
`--environment-output` to the script and export the resulting paths before
running `pnpm codegen`.

Qualification verifies the `forgeds` release at `4ca15fc`, Solar 0.3.0 at
`e7a91fc` (Solidity 0.8.38), and the abi-typegen 0.9.3 npm signature, SLSA
provenance, package integrity, and platform archive checksum. It performs one
offline source-only build with a fresh `forgeds` home. The capture wrapper
adapts Solar's version banner and records the exact compiler inputs and outputs.
Before generation, the verifier checks those captures against pinned Git source
and dependency archives, compares the resulting metadata, bytecode, and ABIs,
and checks the `forgeds` and generator executables against the release pins.
