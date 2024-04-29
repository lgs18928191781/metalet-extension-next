import { mvcApi } from './request'
import { ComputedRef, Ref } from 'vue'
import { Balance } from './types/balance'
import { useQuery } from '@tanstack/vue-query'
import { SymbolTicker } from '@/lib/asset-symbol'
import { FTAsset, type Asset } from '@/data/assets'
import { Balance_QUERY_INTERVAL } from './constants'

export type Token = {
  codeHash: string
  genesis: string
  name: string
  symbol: SymbolTicker
  decimal: number
  sensibleId: string
  utxoCount: number
  confirmed: number
  confirmedString: string
  unconfirmed: number
  unconfirmedString: string
}

export const fetchMVCTokens = async (address: string): Promise<Token[]> => {
  return await mvcApi<Token[]>(`/contract/ft/address/${address}/balance`).get()
}

export const useMVCAssetsQuery = (
  address: Ref<string>,
  options: { enabled: ComputedRef<boolean>; autoRefresh?: boolean }
) => {
  return useQuery({
    queryKey: ['MVCTokens', { address }],
    queryFn: () => fetchMVCTokens(address.value),
    select: (tokens: Token[]) =>
      tokens.map(
        (token) =>
          ({
            symbol: token.symbol,
            tokenName: token.name,
            isNative: false,
            chain: 'mvc',
            queryable: true,
            decimal: token.decimal,
            contract: 'MetaContract',
            codeHash: token.codeHash,
            genesis: token.genesis,
            logo: `https://y8u3ysgqmvgb0tsg.public.blob.vercel-storage.com/wrapt-coins/${token.symbol.toLowerCase()}.png`,
            balance: {
              total: token.confirmed + token.unconfirmed,
              confirmed: token.confirmed,
              unconfirmed: token.unconfirmed,
            },
          }) as FTAsset
      ),
    refetchInterval: options.autoRefresh ? Balance_QUERY_INTERVAL : undefined,
    ...options,
  })
}

export const useMVCTokenQuery = (
  address: Ref<string>,
  genesis: Ref<string>,
  options: { enabled: ComputedRef<boolean> }
) => {
  return useQuery({
    queryKey: ['MVCTokens', { address }],
    queryFn: () => fetchMVCTokens(address.value),
    select: (tokens: Token[]) => {
      const token = tokens.find((token) => token.genesis === genesis.value)
      if (token) {
        return {
          symbol: token.symbol,
          tokenName: token.name,
          isNative: false,
          chain: 'mvc',
          queryable: true,
          decimal: token.decimal,
          contract: 'MetaContract',
          codeHash: token.codeHash,
          genesis: token.genesis,
          logo: `https://y8u3ysgqmvgb0tsg.public.blob.vercel-storage.com/wrapt-coins/${token.symbol.toLowerCase()}.png`,
          balance: {
            confirmed: token.confirmed,
            unconfirmed: token.unconfirmed,
            total: token.confirmed + token.unconfirmed,
          },
        } as Asset
      }
    },
    refetchInterval: Balance_QUERY_INTERVAL,
    ...options,
  })
}

export const fetchTokens = async (address: string): Promise<Token[]> => {
  const tokens: any = await mvcApi(`/contract/ft/address/${address}/balance`).get()

  return tokens.map((token: any) => {
    // 将codeHash改为小写
    token.codehash = token.codeHash
    delete token.codeHash
    return token
  })
}

export const fetchTokenBalance = async (address: string, genesis: string): Promise<Balance> => {
  const tokens = await mvcApi<Token[]>(`/contract/ft/address/${address}/balance`).get()

  const token = tokens.find((token) => token.genesis === genesis)
  const confirmed = token?.confirmed || 0
  const unconfirmed = token?.unconfirmed || 0
  return {
    confirmed,
    unconfirmed,
    total: confirmed + unconfirmed,
  }
}
