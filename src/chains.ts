import { type Chain, type ChainFormatters, defineChain } from 'viem'

type ChainDefinition<Config extends Chain> = ReturnType<
  typeof defineChain<ChainFormatters, Config>
>

const mainnet = {
  id: 1980,
  name: 'Diesis',
  nativeCurrency: { name: 'DS', symbol: 'DS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.diesis.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Diesis Explorer', url: 'https://explorer.diesis.xyz' },
  },
} as const satisfies Chain

const testnet = {
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
} as const satisfies Chain

export const diesis: ChainDefinition<typeof mainnet> = defineChain(mainnet)
export const diesisTestnet: ChainDefinition<typeof testnet> =
  defineChain(testnet)
