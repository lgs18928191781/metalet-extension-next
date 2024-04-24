import connector from '../../connector'
import { getCurrentWallet } from '../../wallet'
import { getCurrentAccountId } from '../../account'
import { Chain } from '@metalet/utxo-wallet-service'

interface AccountInfo {
  address: string
  pubKey: string
}

export async function process(_: unknown, host: string): Promise<AccountInfo> {
  const wallet = await getCurrentWallet(Chain.BTC)
  const currentAccountId = await getCurrentAccountId()
  if (!wallet || !currentAccountId) {
    return { address: '', pubKey: '' }
  }
  await connector.connect(currentAccountId, host)
  const address = wallet.getAddress()
  const pubKey = wallet.getPublicKeyHex()
  return { address, pubKey }
}
