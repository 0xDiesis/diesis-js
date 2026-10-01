# Changelog

## Unreleased

- Public ABI barrels now export AssociationVerifierV1Abi, DiesisEpochAuthorityAbi,
  TransferVerifierV1Abi and WithdrawVerifierV1Abi alongside the existing contracts.
- Code generation requires explicit qualified preflight, manifest and artifact
  paths plus an independently verified raw abi-typegen 0.7.0 executable. Dependency
  installation denies the generator download script and provides no implicit binary.
- CI builds published JavaScript and declarations explicitly after quality checks.
