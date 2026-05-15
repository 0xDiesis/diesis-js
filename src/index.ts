// Chain definitions
export { diesis, diesisTestnet } from './chains.js'

// Addresses
export * as addresses from './addresses.js'

// Client action decorators
export {
  diesisPublicActions,
  type DiesisPublicActions,
} from './actions/public.js'
export {
  diesisWalletActions,
  type DiesisWalletActions,
} from './actions/wallet.js'

// Exchange
export { marketId } from './exchange/utils.js'
export {
  DiesisErc20FactoryAbi,
  erc20Symbol,
  exchangePublicActions,
  exchangeWalletActions,
} from './exchange/actions.js'
export type {
  Erc20FactoryDeployParams,
  ExchangePublicActions,
  ExchangeWalletActions,
} from './exchange/actions.js'
export * from './exchange/types.js'

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
export { OrderFlags } from './intents/types.js'
export type {
  OrderIntentAccount,
  OrderIntent,
  RegisterTradingKeyParameters,
  RevokeTradingKeyParameters,
  SignedOrderIntent,
  TradingKeyAuthorization,
} from './intents/index.js'

// Bundles
export { bundleActions } from './bundles/actions.js'
export { ExecutionFlags, BUNDLE_ONLY_SENTINEL } from './bundles/types.js'
export type {
  BundleFailure,
  BundleMember,
  BundleMemberRole,
  BundleOrdering,
  BundleStatus,
  BundleStatusResult,
  PreparedBundle,
  SubmitBundleResult,
} from './bundles/types.js'

// Patronage
export { patronageActions } from './patronage/actions.js'
export type { GasGrant } from './patronage/actions.js'

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
export {
  BootstrapConfigAbi,
  DiesisConfigAbi,
  IDiesisSettlementAbi,
  IDiesisSpotBookAbi,
  IDiesisMarketsAbi,
  DiesisStakingAbi,
  DiesisPatronAbi,
  IDiesisBootstrapOracleAbi,
  IDiesisPositionAbi,
  ILiquidStakedDSAbi,
  IWrappedDSAbi,
  DiesisShieldedPoolAbi,
  DiesisPrivacyPoolsAbi,
} from './abi/index.js'
