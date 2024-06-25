import { getCurrentWallet } from '../../wallet'
import { Chain, ScriptType, SignType } from '@metalet/utxo-wallet-service'
import { type AddressType, scripts } from '@/lib/bip32-deriver'
import { getBtcUtxos } from '@/queries/utxos'

export interface MRC20DeployParams {
  body: {
    tick: string
    tokenName: string
    decimals: string
    amtPerMint: string
    mintCount: string
    premineCount: string
    blockheight: string
    metadata?: string
    qual: {
      path?: string
      count?: string
      lvl?: string
    }
  }
  flag?: 'metaid' | 'testid'
  revealAddr?: string
  commitFeeRate: number
  revealFeeRate: number
  changeAddress?: string
  revealOutValue?: number
  preMined?: {
    address: string
    satoshis: number
  }
  service?: {
    address: string
    satoshis: string
  }
}

export async function process(params: MRC20DeployParams): Promise<
  | {
      name: string
      path: string
      addressType: AddressType
    }
  | undefined
> {
  const wallet = await getCurrentWallet(Chain.BTC)
  const utxos = await getBtcUtxos(wallet.getAddress(), wallet.getScriptType() === ScriptType.P2PKH)
  return wallet.signTx(SignType.MRC20_DEPLOY, {
    ...params,
    utxos,
  })
}
