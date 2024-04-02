import useStorage from './storage'
import { mvc } from 'meta-contract'
import { crypto } from 'bitcoinjs-lib'
import { signMessage } from './crypto'
import { fetchUtxos } from '../queries/utxos'
import { notifyContent } from '@/lib/notify-content'
import { getBtcNetwork, getNetwork } from './network'
import { generateRandomString, raise } from './helpers'
import { fetchSpaceBalance, fetchBtcBalance, doNothing } from '@/queries/balance'
import {
  AddressType,
  deriveAddress,
  derivePrivateKey,
  derivePublicKey,
  inferAddressType,
  deriveSigner,
  deriveBtcPrivateKey,
  deriveAllAddresses,
} from './bip32-deriver'

const CURRENT_ACCOUNT_ID = 'currentAccountId'
const V0_ACCOUNT_STORAGE_KEY = 'currentAccount'
const V1_ACCOUNTS_STORAGE_KEY = 'accounts'
const V2_ACCOUNTS_STORAGE_KEY = 'accounts_v2'
// const ACCOUNTS_STORAGE_CURRENT_KEY = V3_ACCOUNTS_STORAGE_KEY
// const ACCOUNT_STORAGE_HISTORY_KEYS = [V1_ACCOUNTS_STORAGE_KEY, V2_ACCOUNTS_STORAGE_KEY]

const storage = useStorage()

// TODO put in types.ts
export type Chain = 'btc' | 'mvc'

export type DerivedAccountDetail = {
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
  name?: string
  mnemonic: string
  path: string // mvc coin type
  assetsDisplay?: string[]
  btcPath?: string // btc hd full path
  btcType?: AddressType
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
function deserializeAccountMap(accounts: Record<string, Account>): Map<string, Account> {
  const map = new Map()
  for (const key in accounts) {
    map.set(key, accounts[key])
  }
  return map
}

interface SyncCurrentAccount {
  address: string
  mnemonicStr: string
  alias?: string
}

export async function hasV0Account(): Promise<boolean> {
  // TODO: get IndexDB data
  const storage = useStorage('sync')
  return !!(await storage.get<SyncCurrentAccount>(V0_ACCOUNT_STORAGE_KEY))
}

export async function getV0Account(): Promise<SyncCurrentAccount | undefined> {
  //TODO: get IndexDB data
  const storage = useStorage('sync')
  return await storage.get<SyncCurrentAccount>(V0_ACCOUNT_STORAGE_KEY)
}

export async function hasLegacyAccounts(): Promise<boolean> {
  return !!(await storage.get<Record<string, V1Account>>(V1_ACCOUNTS_STORAGE_KEY))
}

export async function getLegacyAccountsObj(): Promise<Record<string, V1Account>> {
  return await storage.get<Record<string, V1Account>>(V1_ACCOUNTS_STORAGE_KEY, {
    defaultValue: {},
  })
}

export async function getLegacyAccounts(): Promise<V1Account[]> {
  const v1Accounts = await getLegacyAccountsObj()
  return Object.values(v1Accounts)
}

export async function hasV2Accounts(): Promise<boolean> {
  return !!(await storage.get<Record<string, Account>>(V2_ACCOUNTS_STORAGE_KEY))
}

export async function getV2AccountsObj(): Promise<Record<string, Account>> {
  return await storage.get<Record<string, Account>>(V2_ACCOUNTS_STORAGE_KEY, {
    defaultValue: {},
  })
}

export async function getV2Accounts() {
  const v2Accounts = await getV2AccountsObj()
  return deserializeAccountMap(v2Accounts)
}

export async function setV2Accounts(accountsMap: Map<string, Account>) {
  await storage.set(V2_ACCOUNTS_STORAGE_KEY, serializeAccountMap(accountsMap))
}

export async function getAccountsVersionKey(): Promise<string> {
  return V2_ACCOUNTS_STORAGE_KEY
}

export async function getAccounts(): Promise<Map<string, Account>> {
  const currentKey = await getAccountsVersionKey()
  const accounts = await storage.get<Record<string, Account>>(currentKey, {
    defaultValue: {},
  })
  return deserializeAccountMap(accounts)
}

export async function getAccount(accountId: string): Promise<Account | undefined> {
  const accounts = await getAccounts()
  if (accounts.size === 0) {
    return
  }

  const account = accounts.get(accountId)
  if (!account) {
    return
  }

  return account
}

export async function getCurrentAccountId() {
  return await storage.get(CURRENT_ACCOUNT_ID)
}

export async function getCurrentAccount() {
  const currentAccountId = await getCurrentAccountId()
  if (!currentAccountId) {
    return
  }
  return await getAccount(currentAccountId)
}

export async function removeCurrentAccount(): Promise<boolean> {
  const accounts = await getAccounts()
  if (accounts.size === 0) {
    return false
  }

  const currentAccountId = await getCurrentAccountId()
  if (!currentAccountId) {
    return false
  }
  const currentAccount = accounts.get(currentAccountId)
  if (!currentAccount) {
    return false
  }

  accounts.delete(currentAccountId)
  await storage.delete(CURRENT_ACCOUNT_ID)
  setAccounts(accounts)
  return true
}

export async function connectAccount(accountId: string) {
  const _currentAccount = await getAccount(accountId)
  if (!_currentAccount) {
    return false
  }

  await storage.set(CURRENT_ACCOUNT_ID, accountId)

  const mvcAddress = await getAddress('mvc')
  const btcAddress = await getAddress('btc')
  notifyContent('accountsChanged')({ mvcAddress, btcAddress })

  return true
}

export async function setAccounts(accountsMap: Map<string, Account>): Promise<void> {
  const currentKey = await getAccountsVersionKey()
  await storage.set(currentKey, serializeAccountMap(accountsMap))
}

export async function setAccount(account: Account) {
  const accounts = await getAccounts()
  accounts.set(account.id, account)
  setAccounts(accounts)
}

export async function addAccount(newAccount: Omit<Account, 'id' | 'name'>) {
  const accounts = await getAccounts()

  const { mnemonic } = newAccount
  let id: string
  let account = [...accounts.values()].find((account) => account.mnemonic === mnemonic)

  if (!account) {
    id = generateRandomString(32)
    await setAccount({
      ...newAccount,
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

    const mneObj = mvc.Mnemonic.fromString(account!.mnemonic)
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
  const path = await getAccountProperty(chain, 'path')
  const mnemonic = await getCurrentAccount().then((account) => account!.mnemonic)

  return derivePrivateKey({ mnemonic, chain, network, path })
}

export async function getSigner(chain: Chain = 'mvc', treehash?: string) {
  const addressType = await getAddressType(chain)
  if (addressType === 'P2TR') {
    const network = await getNetwork()
    const mnemonic = await getCurrentAccount().then((account) => account!.mnemonic)
    const path = await getAccountProperty(chain, 'path')
    const node = deriveBtcPrivateKey(mnemonic, path, network)
    const nodeXOnlyPubkey = node.publicKey.subarray(1)
    if (treehash) {
      const withTreehash = Buffer.concat([nodeXOnlyPubkey, Buffer.from(treehash, 'hex')])
      return node.tweak(crypto.taggedHash('TapTweak', withTreehash))
    }

    return node.tweak(crypto.taggedHash('TapTweak', nodeXOnlyPubkey))
  }
  const btcNetwork = await getBtcNetwork()
  const privateKey = await getPrivateKey(chain)
  return deriveSigner(privateKey, btcNetwork)
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
  const mnemonic = await getCurrentAccount().then((account) => account!.mnemonic)

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
  const mneObj = mvc.Mnemonic.fromString(account.mnemonic)
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
  const mnemonic = account.mnemonic
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
  const v2Records = await getAccounts()

  // find out if there are any old records that exists in v1 but not in v2, judged by mnemonic
  const v1Mnemonics = v1Records.map((record) => record.mnemonic)
  const v2Mnemonics = Array.from(v2Records.values()).map((record) => record.mnemonic)

  return v1Mnemonics.some((mne) => !v2Mnemonics.includes(mne))
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
  await setAccounts(v2Accounts)
}

type AccountManager = {
  all: () => Promise<Map<string, Account>>
  getCurrent: () => Promise<Account | undefined>
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
