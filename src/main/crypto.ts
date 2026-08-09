/**
 * crypto.ts — 加密模块
 *
 * 职责：提供密码管理器所需的全部加密功能
 *   - PBKDF2 密钥派生（从主密码 + 随机盐 → 256-bit AES 密钥）
 *   - AES-256-GCM 加密/解密（带认证标签，防篡改）
 *   - 密码学安全随机密码生成
 *
 * 加密方案概述：
 *   主密码 ──→ PBKDF2(SHA-512, 100,000 迭代) + 随机盐 ──→ 256-bit 密钥
 *   明文 ──→ AES-256-GCM(密钥, 随机IV) ──→ { 密文, IV, authTag }
 *
 *   AES-256-GCM 是一种认证加密模式，同时提供：
 *     - 机密性（数据加密，无法被未授权者读取）
 *     - 完整性（authTag 验证数据是否被篡改）
 *     - 真实性（authTag 验证数据确实来自知道密钥的一方）
 *
 * 安全参数选择依据：
 *   - PBKDF2 迭代次数 100,000：NIST 推荐的最低值，在安全性和性能间平衡
 *   - SHA-512：抗碰撞性强，HMAC-SHA512 作为 PRF 安全性好
 *   - AES-256：256-bit 密钥，即使量子计算也提供 128-bit 安全强度
 *   - GCM 模式：认证加密，可检测篡改，硬件加速支持（AES-NI）
 */

import crypto from 'crypto'

/** PBKDF2 迭代次数 — 100,000 次，增加暴力破解成本 */
const PBKDF2_ITERATIONS = 100_000

/** 密钥长度 — 32 字节 = 256 bits（AES-256 标准密钥长度） */
const KEY_LENGTH = 32

/** 哈希算法 — SHA-512，用于 PBKDF2 的 HMAC 伪随机函数 */
const DIGEST = 'sha512'

/**
 * 从主密码派生 AES-256 加密密钥
 *
 * 使用 PBKDF2（Password-Based Key Derivation Function 2）算法：
 *   - 通过多次迭代哈希（100,000 次）大幅增加暴力破解成本
 *   - 随机盐值确保相同密码在不同保险库中产生不同密钥
 *   - SHA-512 提供 512-bit 内部状态，安全性优于 SHA-256
 *
 * @param password - 用户主密码（明文）
 * @param salt - 随机盐值（32 字节 Buffer），创建保险库时随机生成并存储
 * @returns 32 字节（256-bit）的派生密钥 Buffer
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST)
}

/**
 * 使用 AES-256-GCM 加密明文
 *
 * GCM（Galois/Counter Mode）特点：
 *   - 每次加密生成随机 IV（16 字节），确保相同明文产生不同密文
 *   - 生成 authTag 用于解密时验证数据完整性和真实性
 *   - 支持关联数据（AAD），本实现未使用此特性
 *
 * @param plaintext - 要加密的明文字符串
 * @param key - 32 字节 AES-256 密钥 Buffer
 * @returns 包含 iv（hex）、ciphertext（hex）、authTag（hex）的对象
 */
export function encrypt(
  plaintext: string,
  key: Buffer
): { iv: string; ciphertext: string; authTag: string } {
  // 生成 16 字节（128-bit）随机初始化向量
  // 随机 IV 是关键安全设计：即使同一条目被多次保存，每次密文也完全不同
  const iv = crypto.randomBytes(16)

  // 创建 AES-256-GCM 加密器
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  // 加密明文（UTF-8 编码），拼接加密输出和最终块
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  // 获取 GCM 认证标签（16 字节），用于解密时验证数据未被篡改
  const authTag = cipher.getAuthTag()

  return {
    iv: iv.toString('hex'),               // Buffer → hex 字符串
    ciphertext: encrypted.toString('hex'), // Buffer → hex 字符串
    authTag: authTag.toString('hex')       // Buffer → hex 字符串
  }
}

/**
 * 使用 AES-256-GCM 解密密文
 *
 * GCM 解密过程会自动验证 authTag：
 *   - 如果密钥错误或数据被篡改，authTag 不匹配 → 抛出异常
 *   - 如果密钥正确且数据完整，authTag 匹配 → 返回明文
 *
 * @param ciphertext - 密文（hex 字符串）
 * @param key - 32 字节 AES-256 密钥 Buffer
 * @param iv - 初始化向量（hex 字符串）
 * @param authTag - GCM 认证标签（hex 字符串）
 * @returns 解密后的明文字符串
 * @throws 如果 authTag 验证失败（密码错误或数据被篡改），抛出异常
 */
export function decrypt(
  ciphertext: string,
  key: Buffer,
  iv: string,
  authTag: string
): string {
  // 创建 AES-256-GCM 解密器
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))

  // 设置认证标签 — 解密时会自动验证
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))

  // 解密密文（hex → Buffer → UTF-8 字符串）
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final()  // 此处会验证 authTag，失败则抛出异常
  ])

  return decrypted.toString('utf8')
}

/**
 * 生成密码学安全的随机密码
 *
 * 使用 crypto.randomBytes()（基于系统熵源）作为随机源，保证不可预测性。
 * 与 Math.random() 不同，crypto.randomBytes() 是密码学安全的。
 *
 * 生成策略：
 *   1. 拒绝采样（rejection sampling）从字符集中均匀随机选取字符，消除取模偏差
 *   2. 确保每种选定的字符类型至少出现一次（例如至少一个大写字母）
 *   3. 用保证存在的字符替换密码前 N 位，其余位置保持随机
 *
 * @param options - 密码生成选项
 * @param options.length - 密码长度，默认 20 位
 * @param options.uppercase - 包含大写字母 A-Z，默认 true
 * @param options.lowercase - 包含小写字母 a-z，默认 true
 * @param options.numbers - 包含数字 0-9，默认 true
 * @param options.symbols - 包含特殊符号，默认 true
 * @returns 生成的随机密码字符串
 */
export function generatePassword(options: {
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  numbers?: boolean
  symbols?: boolean
} = {}): string {
  const {
    length = 20,         // 默认 20 位密码
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true
  } = options

  // 构建字符池：只包含用户选定的字符类型
  const pools: string[] = []
  if (lowercase) pools.push('abcdefghijklmnopqrstuvwxyz')
  if (uppercase) pools.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  if (numbers) pools.push('0123456789')
  if (symbols) pools.push('!@#$%^&*()_+-=[]{}|;:,.<>?')

  // 没有选择任何字符类型，返回空字符串
  if (pools.length === 0) return ''

  // 合并所有字符池为一个完整字符集
  const charset = pools.join('')

  // 拒绝采样（rejection sampling）：只接受小于 limit 的随机字节，
  // 消除 `% charset.length` 的取模偏差，保证每个字符等概率出现。
  // 使用随机字节池 + 游标，避免逐字符调用 crypto.randomBytes。
  let bytes = crypto.randomBytes(256)
  let pos = 0
  const randomChar = (cs: string): string => {
    const limit = Math.floor(256 / cs.length) * cs.length
    let b = 0
    do {
      if (pos >= bytes.length) {
        bytes = crypto.randomBytes(256)
        pos = 0
      }
      b = bytes[pos++]
    } while (b >= limit)
    return cs[b % cs.length]
  }

  // 先保证每种选定的字符类型至少出现一次（"保证存在"字符）
  const required = pools.map((pool) => randomChar(pool))

  // 长度不能小于字符类型数，否则无法容纳所有"保证存在"字符
  const safeLength = Math.max(length, required.length)
  let password = ''
  for (let i = 0; i < safeLength; i++) {
    password += randomChar(charset)
  }

  // 用保证存在的字符替换密码前 N 位，确保密码策略合规
  return required.join('') + password.slice(required.length)
}
