// Chain definitions
export { diesis, diesisTestnet } from './chains.js'

// Addresses
export * as addresses from './addresses.js'
export {
  diesisContracts,
  type DiesisContractName,
} from './abi/bindings/contracts.js'

// Names
export {
  diesisNamehash,
  genesisPrecompileNames,
  nameServiceContracts,
  nameServiceRecordTypes,
  normalizeDiesisName,
  resolveGenesisPrecompileName,
  reverseResolveGenesisPrecompile,
} from './names.js'
export type { GenesisPrecompileName, NameServiceRecordType } from './names.js'

// Client action decorators
export {
  diesisPublicActions,
  type DiesisPublicActions,
  type RuntimeCapabilities,
  type PipelineStatus,
  type TransactionStatus,
  type TransactionLifecycle,
  type LifecycleStatus,
  type ExchangeActionStatus,
} from './actions/public.js'
export {
  diesisWalletActions,
  type DiesisWalletActions,
  type SyncTransactionReceipt,
} from './actions/wallet.js'

// Exchange
export * from './exchange/index.js'

// Intents
export {
  ORDER_INTENT_TYPES,
  getOrderIntentDomain,
  getOrderIntentTypedData,
  registerTradingKey,
  revokeTradingKey,
  signOrderIntent,
  signOrderIntentWithAccount,
  signTradingKeyAuthorization,
} from './intents/signing.js'
export {
  CANCEL_INTENT_TYPES,
  buildSignedCancelIntent,
  getCancelIntentDomain,
  getCancelIntentTypedData,
  signCancelIntent,
} from './intents/cancel.js'
export { OrderFlags } from './intents/types.js'
export type {
  BuildSignedCancelIntentArgs,
  OrderIntentAccount,
  OrderIntent,
  CancelIntent,
  CancelIntentAccount,
  RegisterTradingKeyParameters,
  RevokeTradingKeyParameters,
  SignedOrderIntent,
  SignedCancelIntent,
  TradingKeyAuthorization,
} from './intents/index.js'

// Bundles
export {
  bundleActions,
  BUNDLE_PLAN_TAG,
  BUNDLE_MEMBER_CONSENT_TYPES,
  canonicalBundle,
  consentDigest,
  consentDomain,
  encodeReserveBundle,
  ExecutionFlags,
  flagsFromWire,
  flagsToWire,
  planHash,
  planToWire,
  reservationValue,
  signMemberConsent,
} from './bundles/index.js'
export type {
  BundleConsentAccount,
  BundleFailure,
  BundleLifecycle,
  BundleManifestEntry,
  BundleMember,
  BundleMemberConsent,
  BundleMemberRole,
  BundleOrdering,
  BundlePaymentOutcome,
  BundlePaymentTerms,
  BundlePlan,
  BundleStatus,
  BundleStatusResult,
  ConsentDigestParams,
  PreparedBundle,
  StealthBundleInput,
  SubmitBundleInput,
  SubmitBundleMember,
  SubmitBundleResult,
} from './bundles/index.js'

// Patronage
export {
  patronageActions,
  campaignIdFor,
  campaignVoucherDigest,
  campaignVoucherDomain,
  CAMPAIGN_VOUCHER_TYPES,
  encodeClaimCampaignVoucher,
  encodeRegisterCampaign,
  encodeRevokeCampaignVoucher,
  encodeRotateCampaignOwner,
  encodeSetCampaignRevoked,
  signCampaignVoucher,
} from './patronage/index.js'
export type {
  CampaignVoucherAccount,
  CampaignVoucherV1,
  GasGrant,
} from './patronage/index.js'

// Settlement router
export {
  encodeRouterDeposit,
  encodeRouterWithdraw,
  encodeSetTokenAllowed,
  settlementRouter,
} from './settlement/index.js'

// Privacy
export { privacyReadActions, privacyWriteActions } from './privacy/actions.js'
export type {
  PrivacyProvider,
  PrivacyReadActions,
  PrivacyWriteActions,
  ShieldedPoolState,
} from './privacy/actions.js'

// Staking
export { stakingReadActions, stakingWriteActions } from './staking/actions.js'
export type {
  StakingReadActions,
  StakingWriteActions,
  ValidatorInfo,
  PositionInfo,
} from './staking/actions.js'

// ABIs
//
// Re-exported as a whole rather than as a hand-listed subset. The ABI barrel is
// generated from the contract artifacts, so any list restated here silently
// falls behind the moment a contract is added — the two drift apart with no
// error at either end. Forwarding the barrel makes the top level track
// generation by construction. `export *` is static, so tree-shaking and the
// emitted declarations are unaffected.
export * from './abi/index.js'

export * from './exchange/actions-v2-results.js'
