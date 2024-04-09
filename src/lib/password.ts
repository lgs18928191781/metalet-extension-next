import hash from 'object-hash'
import CryptoJS from 'crypto-js'
import useStorage from './storage'
import { notifyBg } from './notify-bg'

const Locked_Key = 'locked'
const Password_Key = 'password'

const storage = useStorage()

export async function getPassword() {
  return await storage.get(Password_Key)
}

export async function hasPassword() {
  return !!(await getPassword())
}

export async function checkPassword(credential: string) {
  const password = await getPassword()
  return hash(credential) === password || CryptoJS.SHA256(credential).toString() === password
}

export async function setPassword(password: string) {
  // const hashed = hash(password)
  const hashed = CryptoJS.SHA256(password).toString()
  await storage.set(Password_Key, hashed)
}

export async function lock() {
  await storage.set(Locked_Key, true)
  await notifyBg('lock')()
}

export async function isLocked() {
  return await !!storage.get(Locked_Key)
}

export async function unlock(password: string) {
  const isCorrect = await checkPassword(password)
  if (!isCorrect) {
    throw new Error('Password incorrect')
  }
  await storage.set(Locked_Key, false)
  await notifyBg('unlock')()
}

type PasswordManager = {
  has: () => Promise<boolean>
  get: () => Promise<string | undefined>
  set: (password: string) => Promise<void>
  lock: () => Promise<void>
  unlock: (password: string) => Promise<void>
  isLocked: () => Promise<boolean>
  check: (credential: string) => Promise<boolean>
}
const passwordManager = {} as PasswordManager
passwordManager.has = hasPassword
passwordManager.get = getPassword
passwordManager.set = setPassword
passwordManager.lock = lock
passwordManager.unlock = unlock
passwordManager.isLocked = isLocked
passwordManager.check = checkPassword

export default passwordManager
