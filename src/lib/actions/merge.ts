import { FEEB } from '@/data/config'
import { getNetwork } from '../network'
import { getCurrentWallet } from '../wallet'
import { Chain } from '@metalet/utxo-wallet-service'
import { API_NET, API_TARGET, Wallet } from 'meta-contract'
import { getDefaultMVCTRate } from '@/queries/transaction'

export async function process() {
  const network: API_NET = (await getNetwork()) as API_NET
  const chainWallet = await getCurrentWallet(Chain.MVC)
  const purse = chainWallet.getPrivateKey()
  const feeb = await getDefaultMVCTRate()

  const wallet = new Wallet(purse, network, feeb, API_TARGET.APIMVC)

  type TransferResult = {
    id: number
    txid: string
    txHex: string
    routeCheckTxHex?: string
  }
  const results: TransferResult[] = []
  const txids: string[] = []

  const mergeRes = await wallet.merge()
  results.push({
    id: 1,
    txid: mergeRes.txId,
    txHex: mergeRes.txHex,
  })
  txids.push(mergeRes.txId)

  return { res: results, txids, broadcasted: true }
}
