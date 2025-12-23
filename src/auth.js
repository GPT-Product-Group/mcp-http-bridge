/**
 * OAuth 认证模块
 * 处理 Shopify Customer Account API 的 OAuth 流程
 */

import crypto from 'crypto';
import { storeCodeVerifier, getCustomerAccountUrls, storeCustomerAccountUrls } from './db.js';

/**
 * 生成随机字符串
 * @param {number} length - 长度
 * @returns {string}
 */
function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

/**
 * 生成 PKCE Code Verifier
 * @returns {string}
 */
function generateCodeVerifier() {
  return generateRandomString(64);
}

/**
 * 生成 PKCE Code Challenge
 * @param {string} verifier - Code verifier
 * @returns {string}
 */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * 从商店 URL 获取 Customer Account API URLs
 * @param {string} shopDomain - 商店域名 (如 xxx.myshopify.com)
 * @returns {Object} URLs
 */
export function getCustomerApiUrls(shopDomain) {
  // 移除协议前缀
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  
  // 构建 account 域名
  // xxx.myshopify.com -> xxx.account.myshopify.com
  const accountDomain = domain.replace(/(\.myshopify\.com)$/, '.account$1');
  
  return {
    mcpApiUrl: `https://${accountDomain}/customer/api/mcp`,
    authorizationUrl: `https://${accountDomain}/customer/api/oauth/authorize`,
    tokenUrl: `https://${accountDomain}/customer/api/oauth/token`
  };
}

/**
 * 生成 OAuth 认证 URL
 * @param {Object} params - 参数
 * @param {string} params.sessionId - 会话 ID
 * @param {string} params.shopId - 商店 ID (如 xxx.myshopify.com)
 * @param {string} params.clientId - Shopify App Client ID
 * @param {string} params.redirectUri - 回调 URL
 * @param {string[]} params.scopes - 权限范围
 * @returns {Promise<Object>} { url, state, codeVerifier }
 */
export async function generateAuthUrl({ sessionId, shopId, clientId, redirectUri, scopes }) {
  // 获取或存储 Customer Account URLs
  let urls = getCustomerAccountUrls(shopId);
  
  if (!urls) {
    const apiUrls = getCustomerApiUrls(shopId);
    urls = storeCustomerAccountUrls({
      shopId,
      ...apiUrls
    });
  }

  // 生成 PKCE 参数
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 生成 state (包含 sessionId 和 shopId，用于回调时识别)
  const state = `${sessionId}-${shopId}`;

  // 存储 code verifier
  storeCodeVerifier(state, codeVerifier);

  // 构建授权 URL
  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  const authUrl = `${urls.authorization_url}?${authParams.toString()}`;

  console.log('Generated auth URL:', authUrl);

  return {
    url: authUrl,
    state,
    codeVerifier
  };
}

/**
 * 用授权码换取 Access Token
 * @param {Object} params - 参数
 * @param {string} params.code - 授权码
 * @param {string} params.state - OAuth state
 * @param {string} params.codeVerifier - PKCE code verifier
 * @param {string} params.shopId - 商店 ID
 * @param {string} params.clientId - Shopify App Client ID
 * @param {string} params.redirectUri - 回调 URL
 * @returns {Promise<Object>} Token 响应
 */
export async function exchangeCodeForToken({ code, state, codeVerifier, shopId, clientId, redirectUri }) {
  const urls = getCustomerAccountUrls(shopId);
  
  if (!urls) {
    throw new Error(`Customer account URLs not found for shop: ${shopId}`);
  }

  const requestBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  console.log('Exchanging code for token at:', urls.token_url);
  console.log('Request body:', requestBody.toString());

  const response = await fetch(urls.token_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token exchange failed:', response.status, errorText);
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const tokenData = await response.json();
  console.log('Token exchange successful, expires_in:', tokenData.expires_in);

  return tokenData;
}

export default {
  generateAuthUrl,
  exchangeCodeForToken,
  getCustomerApiUrls
};

