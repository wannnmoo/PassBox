/**
 * vault.ts — 保险库核心模块
 *
 * 职责：管理保险库的完整生命周期
 *   - 创建保险库（首次使用时，生成随机 salt → 派生密钥 → 加密空条目列表 → 写入文件）
 *   - 解锁保险库（读取文件 → 用 salt 派生密钥 → 尝试解密 → 验证密码正确性 → 加载条目到内存）
 *   - 锁定保险库（清空内存中的密钥和条目数据，防止内存泄露）
 *   - 修改主密码（验证旧密码 → 生成新 salt → 重新加密 → 覆盖文件）
 *   - 条目 CRUD（增删改查 + 拖拽排序）
 *
 * 安全设计：
 *   - 所有密码数据仅在解锁后存于内存中，锁定后立即清空
 *   - 每次保存都会生成新的随机 IV（初始化向量），防止相同明文产生相同密文
 *   - 列表查询时密码字段返回掩码 "••••••••"，只有 getEntry 返回完整密码
 */

import crypto from 'crypto'
import { deriveKey, encrypt, decrypt } from './crypto'
import { vaultExists, readVault, writeVault } from './store'

/**
 * 密码条目接口
 * 每个条目代表用户保存的一条密码记录（如网站登录信息）
 */
export interface PasswordEntry {
  id: string           // 唯一标识，使用 crypto.randomUUID() 生成
  service: string      // 服务名称，例如 "Google", "GitHub"
  username: string     // 用户名或邮箱
  password: string     // 明文密码（仅在内存中存储，写入文件前会加密）
  url?: string         // 可选：关联网址
  notes?: string       // 可选：备注信息
  order: number        // 排序序号，用于拖拽排序
  createdAt: number    // 创建时间戳（毫秒）
  updatedAt: number    // 最后更新时间戳（毫秒）
}

/** 保险库文件的存储格式（保存在 vault.dat 中，全部为 hex 字符串） */
interface VaultData {
  salt: string         // PBKDF2 随机盐值（hex 编码）
  iv: string           // AES-256-GCM 初始化向量（hex 编码）
  authTag: string      // GCM 认证标签，用于验证数据完整性和真实性
  ciphertext: string   // 加密后的密文（hex 编码）
}

/** 保险库运行时状态（仅存在于内存中，锁定后清空） */
interface VaultState {
  isUnlocked: boolean  // 是否已解锁
  key: Buffer | null   // 派生密钥（256-bit），锁定后置为 null
  entries: PasswordEntry[]  // 内存中的解密条目列表
}

/** 保险库全局状态，模块级单例 */
const state: VaultState = {
  isUnlocked: false,
  key: null,
  entries: []
}

/**
 * 创建新的保险库
 *
 * 仅在首次使用、尚不存在保险库文件时调用。
 * 流程：生成 32 字节随机盐 → PBKDF2 派生密钥 → 加密空条目列表 → 写入 vault.dat
 *
 * @param masterPassword - 用户设置的主密码（明文）
 */
export function createVault(masterPassword: string): void {
  // 生成 32 字节（256-bit）的随机盐值，确保相同密码产生不同密钥
  const salt = crypto.randomBytes(32)
  const key = deriveKey(masterPassword, salt)
  const entries: PasswordEntry[] = []

  // 将空条目列表序列化为 JSON 并加密
  const plaintext = JSON.stringify(entries)
  const { iv, ciphertext, authTag } = encrypt(plaintext, key)

  const vaultData: VaultData = {
    salt: salt.toString('hex'),  // Buffer → hex 字符串，便于 JSON 存储
    iv,
    authTag,
    ciphertext
  }

  writeVault(JSON.stringify(vaultData))

  // 创建后立即解锁，用户无需再次输入密码
  state.isUnlocked = true
  state.key = key
  state.entries = entries
}

/**
 * 尝试解锁保险库
 *
 * 流程：
 *   1. 检查 vault.dat 是否存在
 *   2. 读取文件，解析 JSON，提取 salt
 *   3. 用主密码 + salt 派生密钥
 *   4. 尝试解密 —— 解密成功 = 密码正确，解密失败（GCM authTag 不匹配）= 密码错误
 *   5. 如果成功，执行数据迁移（确保旧数据的 order 字段存在）
 *
 * @param masterPassword - 用户输入的主密码
 * @returns true 表示密码正确、解锁成功；false 表示密码错误或文件损坏
 */
export function unlockVault(masterPassword: string): boolean {
  if (!vaultExists()) return false

  try {
    const raw = readVault()
    const vaultData: VaultData = JSON.parse(raw)
    const salt = Buffer.from(vaultData.salt, 'hex')
    const key = deriveKey(masterPassword, salt)

    // 尝试解密：AES-256-GCM 的 authTag 验证会自动检测密码错误
    // 如果密码错误，authTag 不匹配，decrypt() 会抛出异常
    const plaintext = decrypt(vaultData.ciphertext, key, vaultData.iv, vaultData.authTag)
    const entries: PasswordEntry[] = JSON.parse(plaintext)

    // 数据迁移：为旧版本（没有 order 字段的条目）补充 order
    // 这是向后兼容措施，旧版本创建的保险库不会有 order 字段
    entries.forEach((e, i) => {
      if (e.order === undefined) e.order = i
    })

    state.isUnlocked = true
    state.key = key
    state.entries = entries
    return true
  } catch {
    // 任何异常（JSON 解析失败、解密失败等）都视为解锁失败
    return false
  }
}

/**
 * 修改主密码
 *
 * 流程：
 *   1. 从文件读取当前 vaultData，提取原始 salt
 *   2. 用旧密码派生密钥，尝试解密 —— 验证旧密码正确性
 *   3. 生成新随机 salt，用新密码派生新密钥
 *   4. 重新加密当前内存中的条目列表
 *   5. 写入新 vaultData 覆盖文件
 *
 * @param oldPassword - 当前主密码
 * @param newPassword - 新主密码
 * @returns true 表示修改成功；false 表示旧密码错误
 * @throws 如果保险库未解锁，抛出 Error
 */
export function changeMasterPassword(oldPassword: string, newPassword: string): boolean {
  if (!state.isUnlocked) throw new Error('Vault is locked')

  try {
    const raw = readVault()
    const vaultData: VaultData = JSON.parse(raw)
    const salt = Buffer.from(vaultData.salt, 'hex')

    // 第一步：验证旧密码 —— 用旧密码派生密钥并尝试解密
    const oldKey = deriveKey(oldPassword, salt)
    decrypt(vaultData.ciphertext, oldKey, vaultData.iv, vaultData.authTag)

    // 第二步：旧密码正确，用新密码重新加密
    const newSalt = crypto.randomBytes(32)          // 生成新的随机盐
    const newKey = deriveKey(newPassword, newSalt)  // 用新密码派生新密钥

    const plaintext = JSON.stringify(state.entries)
    const { iv, ciphertext, authTag } = encrypt(plaintext, newKey)

    // 第三步：覆盖写入新的 vaultData
    writeVault(JSON.stringify({
      salt: newSalt.toString('hex'),
      iv,
      authTag,
      ciphertext
    }))

    // 更新内存中的密钥
    state.key = newKey
    return true
  } catch {
    return false
  }
}

/**
 * 锁定保险库
 *
 * 清空内存中所有解密后的数据：密钥置 null，条目列表置空数组。
 * 锁定后只有重新输入正确的主密码才能访问数据。
 * 注意：调用前应考虑对 key Buffer 做显式清零（fill(0)）以防止密钥残留在内存中。
 */
export function lockVault(): void {
  state.isUnlocked = false
  state.key = null
  state.entries = []
}

/**
 * 将当前内存中的条目列表加密并写入文件
 *
 * 每次保存都生成新的随机 IV，确保即使条目内容相同，密文也不同。
 * 这是一个内部函数，所有修改条目的操作最终都会调用它。
 *
 * @throws 如果保险库未解锁或 key 为 null，抛出 Error
 */
function saveVault(): void {
  if (!state.isUnlocked || !state.key) {
    throw new Error('Vault is not unlocked')
  }

  const raw = readVault()
  const vaultData: VaultData = JSON.parse(raw)

  const plaintext = JSON.stringify(state.entries)
  const { iv, ciphertext, authTag } = encrypt(plaintext, state.key)

  // 只更新变化的部分（iv、authTag、ciphertext），salt 保持不变
  vaultData.iv = iv
  vaultData.authTag = authTag
  vaultData.ciphertext = ciphertext

  writeVault(JSON.stringify(vaultData))
}

/**
 * 检查保险库当前是否处于解锁状态
 */
export function isUnlocked(): boolean {
  return state.isUnlocked
}

/**
 * 检查保险库文件（vault.dat）是否存在
 * 用于判断用户是首次使用还是已有保险库
 */
export function hasVault(): boolean {
  return vaultExists()
}

/**
 * 获取所有条目列表（密码已掩码处理）
 *
 * 出于安全考虑，列表视图中的密码字段被替换为 "••••••••"。
 * 只有通过 getEntry() 才能获取完整密码。
 * 返回结果按 order 字段升序排列。
 *
 * @returns 密码掩码后的条目数组（新数组，不影响原数据）
 * @throws 如果保险库未解锁，抛出 Error
 */
export function listEntries(): PasswordEntry[] {
  if (!state.isUnlocked) throw new Error('Vault is locked')
  return [...state.entries]
    .sort((a, b) => a.order - b.order)  // 按 order 升序排列
    .map((e) => ({
      ...e,
      password: '••••••••'  // 掩码替换，防止密码在列表中泄露
    }))
}

/**
 * 获取单个条目的完整信息（含明文密码）
 *
 * @param id - 条目 ID
 * @returns 完整条目对象（含明文密码），找不到返回 undefined
 * @throws 如果保险库未解锁，抛出 Error
 */
export function getEntry(id: string): PasswordEntry | undefined {
  if (!state.isUnlocked) throw new Error('Vault is locked')
  return state.entries.find((e) => e.id === id)
}

/**
 * 创建新条目
 *
 * 自动生成 UUID、设置 order 为当前末尾位置、设置创建/更新时间戳。
 *
 * @param entry - 不包含 id/order/createdAt/updatedAt 的条目数据
 * @returns 完整的 PasswordEntry 对象（含自动生成的字段）
 * @throws 如果保险库未解锁，抛出 Error
 */
export function createEntry(entry: Omit<PasswordEntry, 'id' | 'order' | 'createdAt' | 'updatedAt'>): PasswordEntry {
  if (!state.isUnlocked) throw new Error('Vault is locked')

  const now = Date.now()
  const newEntry: PasswordEntry = {
    ...entry,
    id: crypto.randomUUID(),            // 生成 UUID v4
    order: state.entries.length,        // 新条目排在最后
    createdAt: now,
    updatedAt: now
  }

  state.entries.push(newEntry)
  saveVault()  // 立即持久化到文件
  return newEntry
}

/**
 * 更新现有条目
 *
 * 支持部分更新（只传需要修改的字段），保留不可变字段（id、createdAt），自动更新 updatedAt。
 *
 * @param id - 要更新的条目 ID
 * @param updates - 部分字段更新（可包含 service/username/password/url/notes/order）
 * @returns 更新后的完整条目，找不到条目返回 undefined
 * @throws 如果保险库未解锁，抛出 Error
 */
export function updateEntry(
  id: string,
  updates: Partial<Omit<PasswordEntry, 'id' | 'createdAt'>>
): PasswordEntry | undefined {
  if (!state.isUnlocked) throw new Error('Vault is locked')

  const index = state.entries.findIndex((e) => e.id === id)
  if (index === -1) return undefined

  // 合并更新内容，保护 id 和 createdAt 不被覆盖
  state.entries[index] = {
    ...state.entries[index],
    ...updates,
    id: state.entries[index].id,                          // 保持原 ID
    createdAt: state.entries[index].createdAt,            // 保持原创建时间
    updatedAt: Date.now()                                 // 更新修改时间
  }

  saveVault()
  return state.entries[index]
}

/**
 * 重新排序条目
 *
 * 接收一个按新顺序排列的条目 ID 数组，批量更新各条目的 order 字段。
 * 用于拖拽排序后的持久化。
 *
 * @param orderedIds - 按新顺序排列的条目 ID 数组
 * @throws 如果保险库未解锁，抛出 Error
 */
export function reorderEntries(orderedIds: string[]): void {
  if (!state.isUnlocked) throw new Error('Vault is locked')

  // 遍历 ID 数组，将索引位置赋值给对应条目的 order 字段
  orderedIds.forEach((id, index) => {
    const entry = state.entries.find((e) => e.id === id)
    if (entry) {
      entry.order = index
    }
  })

  saveVault()
}

/**
 * 删除条目
 *
 * 从内存数组中移除匹配 ID 的条目，并立即保存到文件。
 * 删除操作不可撤销 —— 调用方应在此之前进行确认。
 *
 * @param id - 要删除的条目 ID
 * @returns true 表示删除成功；false 表示未找到该条目
 * @throws 如果保险库未解锁，抛出 Error
 */
export function deleteEntry(id: string): boolean {
  if (!state.isUnlocked) throw new Error('Vault is locked')

  const index = state.entries.findIndex((e) => e.id === id)
  if (index === -1) return false

  state.entries.splice(index, 1)
  saveVault()
  return true
}
