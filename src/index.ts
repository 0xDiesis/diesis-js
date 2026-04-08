// Chain definitions
export { diesis, diesisTestnet } from './chains.js'

// Addresses
export * as addresses from './addresses.js'

// Client action decorators
export { diesisPublicActions, type DiesisPublicActions } from './actions/public.js'
export { diesisWalletActions, type DiesisWalletActions } from './actions/wallet.js'

// Exchange
export { marketId } from './exchange/utils.js'
export { exchangePublicActions } from './exchange/actions.js'
export * from './exchange/types.js'

// Intents
export { signOrderIntent, signTradingKeyAuthorization } from './intents/signing.js'
export type { OrderIntent, SignedOrderIntent, TradingKeyAuthorization } from './intents/types.js'

// Bundles
export { bundleActions } from './bundles/actions.js'
export { ExecutionFlags, BUNDLE_ONLY_SENTINEL } from './bundles/types.js'
export type { BundleResult, PreparedBundle } from './bundles/types.js'

// Patronage
export { patronageActions } from './patronage/actions.js'
export type { PatronFund } from './patronage/actions.js'

// Staking
export { stakingReadActions, stakingWriteActions } from './staking/actions.js'
export type { StakingReadActions, StakingWriteActions, ValidatorInfo, PositionInfo } from './staking/actions.js'

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
