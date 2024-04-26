import { getCurrentWallet } from '@/lib/wallet'
import { Chain } from '@metalet/utxo-wallet-service'

export async function process(message: string, encoding?: BufferEncoding): Promise<string> {
  const wallet = await getCurrentWallet(Chain.BTC)
  return wallet.signMessage(message, encoding)
}
