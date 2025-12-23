/**
 * 数据库模块 - 使用 SQLite 存储 customer token
 * 从 shop-chat-agent 迁移并简化
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'tokens.db');

// 确保数据目录存在
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库
const db = new Database(DB_PATH);

// 创建表
db.exec(`
  -- 客户 Token 表
  CREATE TABLE IF NOT EXISTS customer_tokens (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Code Verifier 表 (用于 PKCE)
  CREATE TABLE IF NOT EXISTS code_verifiers (
    id TEXT PRIMARY KEY,
    state TEXT UNIQUE NOT NULL,
    verifier TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );

  -- Customer Account URLs 表 (存储每个 shop 的认证 URL)
  CREATE TABLE IF NOT EXISTS customer_account_urls (
    id TEXT PRIMARY KEY,
    shop_id TEXT UNIQUE NOT NULL,
    mcp_api_url TEXT,
    authorization_url TEXT,
    token_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 索引
  CREATE INDEX IF NOT EXISTS idx_customer_tokens_session ON customer_tokens(session_id);
  CREATE INDEX IF NOT EXISTS idx_customer_tokens_shop ON customer_tokens(shop_id);
  CREATE INDEX IF NOT EXISTS idx_code_verifiers_state ON code_verifiers(state);
`);

console.log('Database initialized at:', DB_PATH);

/**
 * 生成唯一 ID
 */
function generateId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 存储 Code Verifier (用于 PKCE 认证)
 * @param {string} state - OAuth state 参数
 * @param {string} verifier - Code verifier
 * @returns {Object} 保存的记录
 */
export function storeCodeVerifier(state, verifier) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10分钟过期

  const stmt = db.prepare(`
    INSERT INTO code_verifiers (id, state, verifier, expires_at)
    VALUES (?, ?, ?, ?)
  `);

  const id = generateId('cv_');
  stmt.run(id, state, verifier, expiresAt.toISOString());

  return { id, state, verifier, expiresAt };
}

/**
 * 获取并删除 Code Verifier
 * @param {string} state - OAuth state 参数
 * @returns {Object|null} Code verifier 记录
 */
export function getCodeVerifier(state) {
  const stmt = db.prepare(`
    SELECT * FROM code_verifiers 
    WHERE state = ? AND expires_at > datetime('now')
  `);

  const record = stmt.get(state);

  if (record) {
    // 使用后删除，防止重放攻击
    const deleteStmt = db.prepare('DELETE FROM code_verifiers WHERE id = ?');
    deleteStmt.run(record.id);
  }

  return record || null;
}

/**
 * 存储客户 Access Token
 * @param {string} sessionId - 会话 ID
 * @param {string} shopId - 商店 ID
 * @param {string} accessToken - Access token
 * @param {Date} expiresAt - 过期时间
 * @param {string} refreshToken - Refresh token (可选)
 * @returns {Object} 保存的记录
 */
export function storeCustomerToken(sessionId, shopId, accessToken, expiresAt, refreshToken = null) {
  // 先检查是否已存在
  const existingStmt = db.prepare(`
    SELECT id FROM customer_tokens WHERE session_id = ?
  `);
  const existing = existingStmt.get(sessionId);

  if (existing) {
    // 更新现有记录
    const updateStmt = db.prepare(`
      UPDATE customer_tokens 
      SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
      WHERE session_id = ?
    `);
    updateStmt.run(accessToken, refreshToken, expiresAt.toISOString(), sessionId);
    return { id: existing.id, sessionId, shopId, accessToken, expiresAt };
  }

  // 创建新记录
  const insertStmt = db.prepare(`
    INSERT INTO customer_tokens (id, session_id, shop_id, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const id = generateId('ct_');
  insertStmt.run(id, sessionId, shopId, accessToken, refreshToken, expiresAt.toISOString());

  return { id, sessionId, shopId, accessToken, expiresAt };
}

/**
 * 获取客户 Token (通过 session ID)
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} Token 记录 (仅返回未过期的)
 */
export function getCustomerToken(sessionId) {
  const stmt = db.prepare(`
    SELECT * FROM customer_tokens 
    WHERE session_id = ? AND expires_at > datetime('now')
  `);

  const record = stmt.get(sessionId);
  if (record) {
    record.expiresAt = new Date(record.expires_at);
  }
  return record || null;
}

/**
 * 获取客户 Token (通过 shop ID) - 获取最新的有效 token
 * @param {string} shopId - 商店 ID
 * @returns {Object|null} Token 记录
 */
export function getCustomerTokenByShop(shopId) {
  const stmt = db.prepare(`
    SELECT * FROM customer_tokens 
    WHERE shop_id = ? AND expires_at > datetime('now')
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  const record = stmt.get(shopId);
  if (record) {
    record.expiresAt = new Date(record.expires_at);
  }
  return record || null;
}

/**
 * 存储 Customer Account URLs
 * @param {Object} params - 参数
 */
export function storeCustomerAccountUrls({ shopId, mcpApiUrl, authorizationUrl, tokenUrl }) {
  const existingStmt = db.prepare('SELECT id FROM customer_account_urls WHERE shop_id = ?');
  const existing = existingStmt.get(shopId);

  if (existing) {
    const updateStmt = db.prepare(`
      UPDATE customer_account_urls 
      SET mcp_api_url = ?, authorization_url = ?, token_url = ?, updated_at = datetime('now')
      WHERE shop_id = ?
    `);
    updateStmt.run(mcpApiUrl, authorizationUrl, tokenUrl, shopId);
    return { id: existing.id, shopId, mcpApiUrl, authorizationUrl, tokenUrl };
  }

  const insertStmt = db.prepare(`
    INSERT INTO customer_account_urls (id, shop_id, mcp_api_url, authorization_url, token_url)
    VALUES (?, ?, ?, ?, ?)
  `);

  const id = generateId('cau_');
  insertStmt.run(id, shopId, mcpApiUrl, authorizationUrl, tokenUrl);

  return { id, shopId, mcpApiUrl, authorizationUrl, tokenUrl };
}

/**
 * 获取 Customer Account URLs
 * @param {string} shopId - 商店 ID
 * @returns {Object|null} URLs 记录
 */
export function getCustomerAccountUrls(shopId) {
  const stmt = db.prepare('SELECT * FROM customer_account_urls WHERE shop_id = ?');
  return stmt.get(shopId) || null;
}

/**
 * 清理过期数据
 */
export function cleanupExpired() {
  const tokenStmt = db.prepare(`DELETE FROM customer_tokens WHERE expires_at <= datetime('now')`);
  const verifierStmt = db.prepare(`DELETE FROM code_verifiers WHERE expires_at <= datetime('now')`);
  
  const tokenResult = tokenStmt.run();
  const verifierResult = verifierStmt.run();
  
  console.log(`Cleanup: removed ${tokenResult.changes} expired tokens, ${verifierResult.changes} expired verifiers`);
}

// 每小时清理一次过期数据
setInterval(cleanupExpired, 60 * 60 * 1000);

export default db;

