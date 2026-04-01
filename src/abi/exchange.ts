export const diesisSettlementAbi = [
  { type: 'function', name: 'deposit', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'depositDS', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getAccount', inputs: [{ name: 'trader', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'available', type: 'uint256' }, { name: 'lockedInOrders', type: 'uint256' }, { name: 'lockedInMargin', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getTokenBalance', inputs: [{ name: 'trader', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Withdrawal', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const

export const diesisSpotBookAbi = [
  { type: 'function', name: 'placeOrder', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'side', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'orderType', type: 'uint8' }], outputs: [{ name: 'orderId', type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'cancelOrder', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'orderId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'cancelAllOrders', inputs: [{ name: 'marketId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'amendOrder', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'orderId', type: 'bytes32' }, { name: 'newPrice', type: 'uint256' }, { name: 'newAmount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'event', name: 'OrderPlaced', inputs: [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'trader', type: 'address', indexed: true }, { name: 'side', type: 'uint8', indexed: false }, { name: 'price', type: 'uint256', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'orderType', type: 'uint8', indexed: false }] },
  { type: 'event', name: 'OrderCancelled', inputs: [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'trader', type: 'address', indexed: true }] },
  { type: 'event', name: 'OrderFilled', inputs: [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'trader', type: 'address', indexed: true }, { name: 'fillPrice', type: 'uint256', indexed: false }, { name: 'fillAmount', type: 'uint256', indexed: false }, { name: 'remainingAmount', type: 'uint256', indexed: false }, { name: 'isMaker', type: 'bool', indexed: false }] },
  { type: 'event', name: 'BatchAuctionCleared', inputs: [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'clearingPrice', type: 'uint256', indexed: false }, { name: 'totalVolume', type: 'uint256', indexed: false }, { name: 'numFills', type: 'uint256', indexed: false }] },
] as const

export const diesisMarketsAbi = [
  { type: 'function', name: 'createSpotMarket', inputs: [{ name: 'baseToken', type: 'address' }, { name: 'quoteToken', type: 'address' }, { name: 'tickSize', type: 'uint256' }, { name: 'lotSize', type: 'uint256' }, { name: 'bond', type: 'uint256' }], outputs: [{ name: 'marketId', type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getMarket', inputs: [{ name: 'marketId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'marketId', type: 'bytes32' }, { name: 'baseToken', type: 'address' }, { name: 'quoteToken', type: 'address' }, { name: 'marketType', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'tickSize', type: 'uint256' }, { name: 'lotSize', type: 'uint256' }] }], stateMutability: 'view' },
  { type: 'event', name: 'MarketCreated', inputs: [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'baseToken', type: 'address', indexed: false }, { name: 'quoteToken', type: 'address', indexed: false }, { name: 'marketType', type: 'uint8', indexed: false }] },
] as const
