export const diesisStakingAbi = [
  { type: 'function', name: 'stake', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'unstake', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getStake', inputs: [{ name: 'validator', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const
