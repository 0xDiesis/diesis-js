# Changelog

## Unreleased

- Exchange reads now match native RPC responses. `getMarkets`, `getOrderBook`,
  `getAccount`, `getTrades` and `estimateFill` return indexed envelopes: use `.data`
  for values and retain `blockNumber`, `blockHash` and `indexDigest` for provenance.
  `getMarket` and `getMarketDeploymentState` can return `null`; operator balances
  are `bigint`. Recent trades expose price, quantity, side and block number.
- Replace the incompatible `exchange.deployPerp` payload helper and the unregistered
  `exchange.proposeMetadataUpdate` RPC convenience with reviewed direct contract
  calls. The native `exchange_deployPerp` RPC accepts a signed envelope and returns
  an action hash and status; the removed helper sent a different payload and expected
  a market ID. `createPerpLifecycle` supplies ordinary operator listing, bond, deployment,
  promotion and V1/V2 initialization transactions using generated contract ABIs.
  It estimates gas, reads the pending nonce and checks the wallet context before
  dispatch. Its queue coordinates only calls made through that lifecycle instance.
- Exchange type migration: `PerpDeploymentState` is now a flat storage record,
  `DeployPerpParams` is removed, and `OrderBook` includes `marketId`.
  `TradingAccount` exposes required token balances and order/position counts instead
  of the former aggregate `available`, `lockedInOrders` and `lockedInMargin` fields.
  `TokenBalance`, `FundingRateInfo`, `InsuranceFundStatus` and `MarkPrice` amounts
  use `bigint`. Unsafe JSON numbers are rejected instead of silently rounded.
- Pricing arithmetic and explicit `pricingVersion: 1` DXA2 encoding are prospective
  source support. Node `44bed910b4fd18c29e287ecd49a12982a90ac5bb` rejects their
  `0x04` flag. Transaction preparation, signing and submission reject version 1
  until the coordinated native implementation and cross-language admission vectors
  are qualified. Raw encoding remains available for independent fixtures. Omitted or zero pricing
  versions retain legacy DXA2 bytes. Priced registration, initialization and RPC
  reads remain pending native interfaces and qualified generated contract artifacts.

- Public ABI barrels now export AssociationVerifierV1Abi, DiesisEpochAuthorityAbi,
  TransferVerifierV1Abi and WithdrawVerifierV1Abi alongside the existing contracts.
- Code generation requires explicit qualified preflight, manifest and artifact
  paths plus an independently verified raw abi-typegen 0.7.0 executable. Dependency
  installation denies the generator download script and provides no implicit binary.
- CI builds published JavaScript and declarations explicitly after quality checks.
