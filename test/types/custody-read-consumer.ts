import { createPublicClient, http, type Address } from 'viem'
import {
  exchangePublicActions,
  type IndexedResponse,
  type CustodyRead,
  type AccountCustody,
  type CustodyAsset,
  type CustodyMargin,
  type CustodyCoverage,
  type CustodyGap,
  type GetAccountCustodyParams,
} from '../../src/exchange/index.js'
const client = createPublicClient({
  transport: http('http://127.0.0.1:8545'),
}).extend(exchangePublicActions)
const query: GetAccountCustodyParams = {
  address: '0x1111111111111111111111111111111111111111' as Address,
}
const response: Promise<IndexedResponse<CustodyRead>> =
  client.exchange.getAccountCustody(query)
void response.then((indexed) => {
  const account: AccountCustody = indexed.data.value
  const assets: CustodyAsset[] = account.assets
  const markets: CustodyMargin[] = account.margins
  const coverage: CustodyCoverage = account.coverage
  const gaps: CustodyGap[] = coverage.gaps
  const anchor: bigint = indexed.blockNumber
  const generation: bigint = indexed.data.indexGeneration
  for (const asset of assets) {
    const raw: bigint = asset.accountValueRaw
    const locked: bigint = asset.lockedBalance
    void [raw, locked]
  }
  for (const market of markets) {
    const reserve: bigint = market.reservedUserMargin
    void reserve
  }
  for (const gap of gaps) {
    const end: bigint = gap.toBlock
    void end
  }
  void [anchor, generation]
})
// @ts-expect-error requires a viem address, never an unsafe numeric identity
client.exchange.getAccountCustody({ address: 42 })
// @ts-expect-error only the address is a query input; clients cannot select completeness
client.exchange.getAccountCustody({ address: query.address, complete: true })
