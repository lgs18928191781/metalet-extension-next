import { mvc } from 'meta-contract'

import { notifyContent } from '@/lib/notify-content'
import { getNetwork } from './network'
import { decrypt, encrypt, signMessage } from './crypto'
import { fetchUtxos } from '../queries/utxos'
import { getStorage, setStorage } from './storage'
import { generateRandomString, raise } from './helpers'
import { fetchSpaceBalance, fetchBtcBalance, doNothing } from '@/queries/balance'
import {
  AddressType,
  deriveAddress,
  deriveAllAddresses,
  derivePrivateKey,
  derivePublicKey,
  inferAddressType,
  deriveSigner,
  deriveBtcPrivateKey,
} from './bip32-deriver'
import { crypto } from 'bitcoinjs-lib'

const CURRENT_ACCOUNT_ID = 'currentAccountId'
// const ACCOUNT_STORAGE_CURRENT_KEY = 'accounts_v2'
const ACCOUNT_STORAGE_CURRENT_KEY = 'accounts_v3'
const ACCOUNT_STORAGE_HISTORY_KEYS = ['accounts', 'accounts_v2']

// TODO put in types.ts
export type Chain = 'btc' | 'mvc'

type DerivedAccountDetail = {
  path: string
  addressType: AddressType
  mainnetAddress: string
  testnetAddress: string
  credential?: {
    address: string
    publicKey: string
    signature: string
  }
}

type ChainDetail = {
  [chain in Chain]: Omit<DerivedAccountDetail, 'credential'>
}

export type Account = {
  id: string
  name: string
  mnemonic: string
  assetsDisplay: string[]
  mvc: DerivedAccountDetail
  btc: DerivedAccountDetail
}
type V1Account = {
  id: string
  name: string
  mnemonic: string
  path: string
  assetsDisplay: string[]
}

// Account Map Serialization
function serializeAccountMap(map: Map<string, Account>): string {
  const obj: { [key: string]: Account } = {}
  for (const [key, value] of map.entries()) {
    obj[key] = value
  }
  return JSON.stringify(obj)
}

// Account Map Deserialization
function deserializeAccountMap(json: string): Map<string, Account> {
  const obj = typeof json === 'string' ? JSON.parse(json) : json
  const map = new Map()
  for (const key in obj) {
    map.set(key, obj[key])
  }
  return map
}

export async function getAccounts(refresh = false): Promise<Map<string, Account>> {
  const accounts = await getStorage(ACCOUNT_STORAGE_CURRENT_KEY, { defaultValue: '{}', isParse: false })

  return deserializeAccountMap(accounts)
}

export async function getAccount(accountId: string): Promise<Account | null> {
  const accounts = await getAccounts()
  if (accounts.size === 0) {
    return null
  }

  const account = accounts.get(accountId)
  if (!account) {
    return null
  }

  return account
}

export async function getCurrentAccount(): Promise<Account | null> {
  const currentAccountId = await getStorage(CURRENT_ACCOUNT_ID)
  if (!currentAccountId) {
    return null
  }

  const account = await getAccount(currentAccountId)

  return account
}

export async function removeCurrentAccount(): Promise<boolean> {
  const accounts = await getAccounts()
  if (accounts.size === 0) {
    return false
  }

  const currentAccountId = await getStorage(CURRENT_ACCOUNT_ID)
  const currentAccount = accounts.get(currentAccountId)
  if (!currentAccount) {
    return false
  }

  accounts.delete(currentAccountId)
  await setStorage(CURRENT_ACCOUNT_ID, '')
  setAccounts(accounts)
  return true
}

export async function connectAccount(accountId: string) {
  const _currentAccount = await getAccount(accountId)
  if (!_currentAccount) {
    return false
  }

  await setStorage(CURRENT_ACCOUNT_ID, accountId)

  const mvcAddress = await getAddress('mvc')
  const btcAddress = await getAddress('btc')
  notifyContent('accountsChanged')({ mvcAddress, btcAddress })

  return true
}

export async function setV2Accounts(accountsMap: Map<string, Account>): Promise<void> {
  await setStorage(ACCOUNT_STORAGE_HISTORY_KEYS[1], serializeAccountMap(accountsMap))
}

export async function setAccounts(accountsMap: Map<string, Account>): Promise<void> {
  await setStorage(ACCOUNT_STORAGE_CURRENT_KEY, serializeAccountMap(accountsMap))
}

export async function setAccount(account: Account) {
  const accounts = await getAccounts()
  accounts.set(account.id, account)
  setAccounts(accounts)
}

export async function addAccount(newAccount: Omit<Account, 'id' | 'name'>) {
  const accounts = await getAccounts()

  const { mnemonic } = newAccount
  const encryptedMnemonic = encrypt(mnemonic)
  let id: string
  let account = [...accounts.values()].find((account) => account.mnemonic === encryptedMnemonic)

  if (!account) {
    id = generateRandomString(32)
    await setAccount({
      ...newAccount,
      mnemonic: encryptedMnemonic,
      id,
      name: `Account ${accounts.size + 1}`,
    })
  } else {
    id = account.id
  }
  await connectAccount(id)
}

async function getAccountProperty(chain: Chain, key: keyof ChainDetail[Chain]): Promise<string> {
  const account = await getCurrentAccount()

  if (!account) {
    return ''
  }

  return account[chain][key]
}

export async function getAddress(chain: Chain = 'mvc', path?: string): Promise<string> {
  const network = await getNetwork()
  const account = await getCurrentAccount()

  if (chain === 'btc' || !path) {
    return getAccountProperty(chain, network === 'mainnet' ? 'mainnetAddress' : 'testnetAddress')
  }

  // derive mvc address by path
  try {
    const rootPath = await getMvcRootPath()
    const concatPath = `${rootPath}/${path}`

    const mneObj = mvc.Mnemonic.fromString(decrypt(account!.mnemonic))
    const hdpk = mneObj.toHDPrivateKey('', network)
    const privateKey = hdpk.deriveChild(concatPath).privateKey

    return privateKey.toAddress(network).toString()
  } catch (e: any) {
    throw new Error(e.message)
  }
}

export async function getAddressType(chain: Chain = 'mvc'): Promise<string> {
  return getAccountProperty(chain, 'addressType')
}

export async function getMvcRootPath(): Promise<string> {
  const mvcFullPath = await getAccountProperty('mvc', 'path')

  return mvcFullPath.slice(0, mvcFullPath.length - 4)
}

export async function getPrivateKey(chain: Chain = 'mvc') {
  const network = await getNetwork()
  const mnemonic = await getCurrentAccount().then((account) => decrypt(account!.mnemonic))
  const path = await getAccountProperty(chain, 'path')

  return derivePrivateKey({ mnemonic, chain, network, path })
}

export async function getSigner(chain: Chain = 'mvc') {
  const addressType = await getAddressType(chain)
  if (addressType === 'P2TR') {
    const network = await getNetwork()
    const mnemonic = await getCurrentAccount().then((account) => decrypt(account!.mnemonic))
    const path = await getAccountProperty(chain, 'path')
    const node = deriveBtcPrivateKey(mnemonic, path, network)
    const nodeXOnlyPubkey = node.publicKey.subarray(1)
    return node.tweak(crypto.taggedHash('TapTweak', nodeXOnlyPubkey))
  }
  const privateKey = await getPrivateKey(chain)
  return deriveSigner(privateKey)
}

export async function getCredential(
  chain: Chain = 'btc'
): Promise<{ address: string; publicKey: string; signature: string }> {
  const account = (await getCurrentAccount()) ?? raise('No current account')
  const cachedCredential = account[chain]['credential']

  if (cachedCredential) return cachedCredential

  const message = 'metalet.space'
  const wif = await getPrivateKey(chain)
  const privateKey = mvc.PrivateKey.fromWIF(wif)
  const { signature } = signMessage(message, privateKey)
  const address = await getAddress(chain)
  const publicKey = await getPublicKey(chain)
  const newCredential = {
    address,
    publicKey,
    signature,
  }

  // cache credential
  account[chain]['credential'] = newCredential
  await setAccount(account)

  return newCredential
}

export async function getPublicKey(chain: Chain = 'mvc', path?: string): Promise<string> {
  const network = await getNetwork()
  const mnemonic = await getCurrentAccount().then((account) => decrypt(account!.mnemonic))

  if (!path) {
    const fullPath = await getAccountProperty(chain, 'path')

    return derivePublicKey({ mnemonic, chain, network, path: fullPath })
  }

  // derive mvc public key by path
  try {
    const rootPath = await getMvcRootPath()
    const concatPath = `${rootPath}/${path}`

    const mneObj = mvc.Mnemonic.fromString(mnemonic)
    const hdpk = mneObj.toHDPrivateKey('', network)
    const privateKey = hdpk.deriveChild(concatPath).privateKey

    return privateKey.toPublicKey().toString()
  } catch (e: any) {
    throw new Error(e.message)
  }
}

export async function getXPublicKey() {
  const account = await getCurrentAccount()
  if (!account) {
    return ''
  }

  const network = await getNetwork()
  const mneObj = mvc.Mnemonic.fromString(decrypt(account!.mnemonic))
  const rootPath = await getMvcRootPath()
  const xPublicKey = mneObj.toHDPrivateKey('', network).deriveChild(rootPath).xpubkey.toString()

  return xPublicKey
}

export async function getBalance(chain: Chain = 'mvc', address?: string) {
  const account = await getCurrentAccount()

  if (!account) {
    return null
  }

  if (!address) {
    address = await getAddress(chain)
  }

  switch (chain) {
    case 'mvc':
      return fetchSpaceBalance(address)
    case 'btc':
      return fetchBtcBalance(address)
    default: {
      return doNothing(address)
    }
  }
}

export async function getUtxos(chain: Chain = 'mvc', params?: { path?: string }) {
  const account = await getCurrentAccount()
  if (!account) {
    return null
  }
  const address = await getAddress(chain, params?.path)
  return await fetchUtxos(chain, address)
}

export async function updateName(name: string) {
  const account = await getCurrentAccount()
  if (!account) {
    return
  }

  account.name = name
  await setAccount(account)
}

export async function updateBtcPath(path: string) {
  const account = await getCurrentAccount()
  if (!account) {
    return
  }

  // derive new address
  const mnemonic = decrypt(account!.mnemonic)
  const mainnetAddress = deriveAddress({ mnemonic, chain: 'btc', network: 'mainnet', path })
  const testnetAddress = deriveAddress({ mnemonic, chain: 'btc', network: 'testnet', path })
  account.btc = {
    path,
    addressType: inferAddressType(path),
    mainnetAddress,
    testnetAddress,
  }

  await setAccount(account)
}

export async function needsMigrationV2(): Promise<boolean> {
  const v1Records = await getLegacyAccounts()
  const v2Records = await getV2Accounts()
  const v3Records = await getAccounts()

  // find out if there are any old records that exists in v1 but not in v2, judged by mnemonic
  const v1Mnemonics = v1Records.map((record) => record.mnemonic)
  const v2Mnemonics = Array.from(v2Records.values()).map((record) => record.mnemonic)
  const v3Mnemonics = Array.from(v3Records.values()).map((record) => record.mnemonic)

  return v1Mnemonics.some((mne) => !v2Mnemonics.includes(mne)) ||
    v1Mnemonics.some((mne) => !v3Mnemonics.includes(encrypt(mne))) ||
    v2Mnemonics.some((mne) => !v3Mnemonics.includes(encrypt(mne)))
}

export async function getLegacyAccounts(): Promise<V1Account[]> {
  const legacyAccounts = await getStorage(ACCOUNT_STORAGE_HISTORY_KEYS[0], { isParse: true })
  if (!legacyAccounts) {
    return []
  }

  return Object.values(legacyAccounts)
}

export async function getV2Accounts(): Promise<Map<string, Account>> {
  const v2Accounts = await getStorage(ACCOUNT_STORAGE_HISTORY_KEYS[1], { defaultValue: '{}', isParse: false })
  if (!v2Accounts) {
    return new Map()
  }

  return deserializeAccountMap(v2Accounts)
}

export async function migrateV2(): Promise<void> {
  const v1Accounts = await getLegacyAccounts()
  const v2Accounts = await getAccounts()
  const v2AccountsArr = Array.from(v2Accounts.values())
  if (!v1Accounts) {
    return
  }
  const v1AccountsIds = v1Accounts.map((account) => account.id)

  // loop through v1 accounts, see if there are any accounts that are not in v2
  for (let i = 0; i < v1AccountsIds.length; i++) {
    const v1AccountId = v1AccountsIds[i]
    const v1Account = v1Accounts.find((account) => account.id === v1AccountId)

    if (!v1Account) {
      continue
    }

    // check if account already exists in v2
    const accountHasMigrated = v2AccountsArr.some((account) => account.mnemonic === v1Account.mnemonic)

    if (accountHasMigrated) {
      continue
    }

    const deriveChainPath = v1Account.path
    const path = `m/44'/${deriveChainPath}'/0'/0/0`
    const rndNameId = generateRandomString(4)

    const allAddresses = deriveAllAddresses({
      mnemonic: v1Account.mnemonic,
      btcPath: path,
      mvcPath: path,
    })

    const newAccount = {
      id: v1AccountId,
      name: v1Account.name || `Account ${rndNameId}`,
      mnemonic: v1Account.mnemonic,
      assetsDisplay: ['SPACE', 'BTC'],
      mvc: {
        path,
        addressType: 'P2PKH',
        mainnetAddress: allAddresses.mvcMainnetAddress,
        testnetAddress: allAddresses.mvcTestnetAddress,
      } as DerivedAccountDetail,
      btc: {
        path,
        addressType: 'P2PKH',
        mainnetAddress: allAddresses.btcMainnetAddress,
        testnetAddress: allAddresses.btcTestnetAddress,
      } as DerivedAccountDetail,
    }
    v2Accounts.set(v1AccountId, newAccount)
  }

  // set new accounts map
  await setV2Accounts(v2Accounts)
}

export async function migrateV3(): Promise<void> {
  const accounts = await getStorage(ACCOUNT_STORAGE_HISTORY_KEYS[1], { defaultValue: '{}', isParse: false })

  const accountsMap = deserializeAccountMap(accounts)
  for (let [v3AccountId, v3Account] of accountsMap.entries()) {
    // encryte mnemonic
    v3Account.mnemonic = encrypt(v3Account.mnemonic)
    accountsMap.set(v3AccountId, v3Account)
  }
  // set new accounts map
  await setAccounts(accountsMap)
}

type AccountManager = {
  all: () => Promise<Map<string, Account>>
  getCurrent: () => Promise<Account | null>
  removeCurrent: () => Promise<boolean>
  set: (account: Account) => Promise<void>
  add: (account: Omit<Account, 'id' | 'name'>) => Promise<void>
  connect: (accountId: string) => Promise<boolean>
  getPublicKey: (chain: Chain, path?: string) => Promise<string>
  getBalance: (chain: Chain, address?: string) => Promise<Awaited<ReturnType<typeof fetchSpaceBalance>> | null>
  getAddress: (chain: Chain, path?: string) => Promise<any>
  getXPublicKey: () => Promise<string | null>
  getUtxos: (chain: Chain, params?: any) => Promise<any>
  updateName: (name: string) => Promise<void>
}

const accountManager = {} as AccountManager
accountManager.all = getAccounts
accountManager.getCurrent = getCurrentAccount
accountManager.set = setAccount
accountManager.add = addAccount
accountManager.connect = connectAccount
accountManager.getAddress = getAddress
accountManager.getPublicKey = getPublicKey
accountManager.getXPublicKey = getXPublicKey
accountManager.getBalance = getBalance
accountManager.getUtxos = getUtxos
accountManager.removeCurrent = removeCurrentAccount
accountManager.updateName = updateName

export default accountManager