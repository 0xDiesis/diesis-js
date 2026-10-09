import { defineChain } from 'viem'

export const diesis = defineChain({
  id: 1980,
  name: 'Diesis',
  nativeCurrency: { name: 'DS', symbol: 'DS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.diesis.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Diesis Explorer', url: 'https://explorer.diesis.xyz' },
  },
})

export const diesisTestnet = defineChain({
  id: 19803,
  name: 'Diesis Testnet',
  nativeCurrency: { name: 'DS', symbol: 'DS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.diesis.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'Diesis Testnet Explorer',
      url: 'https://explorer.testnet.diesis.xyz',
    },
  },
  testnet: true,
})
