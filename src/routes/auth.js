/**
 * OAuth 认证路由
 * 处理 Shopify Customer Account API 的 OAuth 回调
 */

import { Router } from 'express';
import { generateAuthUrl, exchangeCodeForToken } from '../auth.js';
import { getCodeVerifier, storeCustomerToken, getCustomerToken, getCustomerAccountUrls } from '../db.js';

const router = Router();

/**
 * GET /auth/login
 * 发起 OAuth 认证流程
 * 
 * Query params:
 * - session_id: 会话 ID (必填)
 * - shop_id: 商店 ID，如 xxx.myshopify.com (必填)
 * 
 * 会重定向到 Shopify 认证页面
 */
router.get('/login', async (req, res) => {
  try {
    const { session_id, shop_id } = req.query;

    if (!session_id || !shop_id) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'session_id and shop_id are required'
      });
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;

    if (!clientId) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'SHOPIFY_CLIENT_ID is not configured'
      });
    }

    // 默认权限范围
    const scopes = process.env.SHOPIFY_CUSTOMER_SCOPES || 
      'customer_read_customers,customer_read_orders';

    const authResult = await generateAuthUrl({
      sessionId: session_id,
      shopId: shop_id,
      clientId,
      redirectUri,
      scopes: scopes.split(',').map(s => s.trim())
    });

    console.log('Redirecting to auth URL...');
    res.redirect(authResult.url);

  } catch (error) {
    console.error('Error initiating OAuth:', error);
    res.status(500).json({
      error: 'OAuth initiation failed',
      message: error.message
    });
  }
});

/**
 * GET /auth/callback
 * OAuth 回调处理
 * Shopify 认证完成后会重定向到这里
 */
router.get('/callback', async (req, res) => {
  console.log('\n========== OAuth Callback ==========');
  console.log('Query params:', req.query);

  try {
    const { code, state, error, error_description } = req.query;

    // 检查错误
    if (error) {
      console.error('OAuth error:', error, error_description);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Failed</title></head>
        <body style="font-family: system-ui; text-align: center; padding-top: 100px;">
          <h2>Authentication Failed</h2>
          <p style="color: red;">${error}: ${error_description || 'Unknown error'}</p>
          <p>Please close this window and try again.</p>
        </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Failed</title></head>
        <body style="font-family: system-ui; text-align: center; padding-top: 100px;">
          <h2>Authentication Failed</h2>
          <p style="color: red;">Missing authorization code or state</p>
        </body>
        </html>
      `);
    }

    // 解析 state 获取 sessionId 和 shopId
    const [sessionId, shopId] = state.split('-');
    console.log('Session ID:', sessionId);
    console.log('Shop ID:', shopId);

    // 获取 code verifier
    const verifierRecord = getCodeVerifier(state);
    if (!verifierRecord) {
      console.error('Code verifier not found for state:', state);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Failed</title></head>
        <body style="font-family: system-ui; text-align: center; padding-top: 100px;">
          <h2>Authentication Failed</h2>
          <p style="color: red;">Session expired. Please try again.</p>
        </body>
        </html>
      `);
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;

    // 用授权码换取 token
    const tokenData = await exchangeCodeForToken({
      code,
      state,
      codeVerifier: verifierRecord.verifier,
      shopId,
      clientId,
      redirectUri
    });

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

    // 存储 token
    storeCustomerToken(
      sessionId,
      shopId,
      tokenData.access_token,
      expiresAt,
      tokenData.refresh_token
    );

    console.log('Token stored successfully for session:', sessionId);

    // 返回成功页面，自动关闭窗口
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <script>
          window.onload = function() {
            document.getElementById('message').style.display = 'block';
            setTimeout(function() {
              window.close();
              document.getElementById('fallback').style.display = 'block';
            }, 1500);
          }
        </script>
        <style>
          body { font-family: system-ui, sans-serif; text-align: center; padding-top: 100px; }
          #message { display: none; }
          #fallback { display: none; margin-top: 20px; }
          .success { color: green; font-size: 18px; }
        </style>
      </head>
      <body>
        <div id="message">
          <h2>✅ Authentication Successful!</h2>
          <p class="success">You've been authenticated successfully</p>
          <p>This window will close automatically.</p>
        </div>
        <div id="fallback">
          <p>If this window didn't close automatically, you can close it and return to your conversation.</p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Failed</title></head>
      <body style="font-family: system-ui; text-align: center; padding-top: 100px;">
        <h2>Authentication Failed</h2>
        <p style="color: red;">${error.message}</p>
        <p>Please close this window and try again.</p>
      </body>
      </html>
    `);
  }
});

/**
 * GET /auth/status
 * 检查认证状态
 * 
 * Query params:
 * - session_id: 会话 ID
 */
router.get('/status', (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({
      error: 'Missing session_id parameter'
    });
  }

  const token = getCustomerToken(session_id);

  if (token) {
    res.json({
      status: 'authorized',
      expires_at: token.expiresAt.toISOString(),
      shop_id: token.shop_id
    });
  } else {
    res.json({
      status: 'unauthorized'
    });
  }
});

/**
 * GET /auth/url
 * 获取认证 URL (不直接重定向)
 * 
 * Query params:
 * - session_id: 会话 ID (必填)
 * - shop_id: 商店 ID (必填)
 */
router.get('/url', async (req, res) => {
  try {
    const { session_id, shop_id } = req.query;

    if (!session_id || !shop_id) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'session_id and shop_id are required'
      });
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;

    if (!clientId) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'SHOPIFY_CLIENT_ID is not configured'
      });
    }

    const scopes = process.env.SHOPIFY_CUSTOMER_SCOPES || 
      'customer_read_customers,customer_read_orders';

    const authResult = await generateAuthUrl({
      sessionId: session_id,
      shopId: shop_id,
      clientId,
      redirectUri,
      scopes: scopes.split(',').map(s => s.trim())
    });

    res.json({
      auth_url: authResult.url,
      state: authResult.state
    });

  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      error: 'Failed to generate auth URL',
      message: error.message
    });
  }
});

export default router;

