/**
 * Shopify Admin API 直接调用模块
 *
 * 用于通过 Admin API Token (shpat_...) 直接查询 Shopify Admin GraphQL API
 * 支持订单查询、商品管理等需要 Admin 权限的操作
 */

const ADMIN_API_VERSION = '2024-01';

/**
 * 执行 Admin GraphQL 查询
 * @param {string} shopDomain - 店铺域名 (如 xxx.myshopify.com)
 * @param {string} adminToken - Admin API Token (shpat_...)
 * @param {string} query - GraphQL 查询
 * @param {object} variables - 查询变量
 * @returns {Promise<object>} 查询结果
 */
async function executeAdminQuery(shopDomain, adminToken, query, variables = {}) {
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const apiUrl = `https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;

  console.log(`\n=== Admin API Request ===`);
  console.log(`Shop: ${domain}`);
  console.log(`URL: ${apiUrl}`);
  console.log(`Query: ${query.substring(0, 200)}...`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken
    },
    body: JSON.stringify({ query, variables })
  });

  const responseText = await response.text();
  console.log(`\n=== Admin API Response ===`);
  console.log(`Status: ${response.status}`);
  console.log(`Body: ${responseText.substring(0, 500)}...`);

  if (!response.ok) {
    throw new Error(`Admin API request failed: ${response.status} ${responseText}`);
  }

  const result = JSON.parse(responseText);

  // 检查 GraphQL 错误
  if (result.errors && result.errors.length > 0) {
    // 检查是否是权限错误
    const accessDenied = result.errors.some(e =>
      e.extensions?.code === 'ACCESS_DENIED' ||
      e.message?.includes('Access denied')
    );
    if (accessDenied) {
      console.warn('Access denied for some fields, returning partial data');
    } else {
      console.error('GraphQL errors:', JSON.stringify(result.errors));
    }
  }

  return result;
}

/**
 * 获取订单列表
 */
async function getOrders(shopDomain, adminToken, options = {}) {
  const { first = 10, query: searchQuery } = options;

  const query = `
    query GetOrders($first: Int!, $query: String) {
      orders(first: $first, reverse: true, query: $query) {
        edges {
          node {
            id
            name
            createdAt
            updatedAt
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            cancelReason
            email
            phone
            note
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalTaxSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 20) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  variant {
                    id
                    title
                    sku
                  }
                }
              }
            }
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            billingAddress {
              firstName
              lastName
              address1
              city
              province
              country
              zip
            }
            fulfillments {
              status
              trackingInfo {
                number
                url
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  return executeAdminQuery(shopDomain, adminToken, query, {
    first,
    query: searchQuery || null
  });
}

/**
 * 根据订单号查询订单
 */
async function getOrderByName(shopDomain, adminToken, orderName) {
  // 移除 # 前缀
  const name = orderName.replace(/^#/, '');

  const query = `
    query GetOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            createdAt
            updatedAt
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            cancelReason
            email
            phone
            note
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            fulfillments {
              status
              trackingInfo {
                number
                url
              }
            }
          }
        }
      }
    }
  `;

  return executeAdminQuery(shopDomain, adminToken, query, { query: `name:${name}` });
}

/**
 * 获取商品列表
 */
async function getProducts(shopDomain, adminToken, options = {}) {
  const { first = 10, query: searchQuery } = options;

  const query = `
    query GetProducts($first: Int!, $query: String) {
      products(first: $first, query: $query) {
        edges {
          node {
            id
            title
            description
            status
            totalInventory
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                }
              }
            }
            images(first: 3) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  return executeAdminQuery(shopDomain, adminToken, query, {
    first,
    query: searchQuery || null
  });
}

/**
 * 获取退款记录
 */
async function getRefunds(shopDomain, adminToken, options = {}) {
  const { first = 10 } = options;

  const query = `
    query GetOrdersWithRefunds($first: Int!) {
      orders(first: $first, query: "financial_status:refunded OR financial_status:partially_refunded") {
        edges {
          node {
            id
            name
            displayFinancialStatus
            refunds {
              id
              createdAt
              note
              totalRefundedSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              refundLineItems(first: 10) {
                edges {
                  node {
                    quantity
                    lineItem {
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  return executeAdminQuery(shopDomain, adminToken, query, { first });
}

/**
 * 获取店铺信息
 */
async function getShopInfo(shopDomain, adminToken) {
  const query = `
    {
      shop {
        name
        email
        myshopifyDomain
        currencyCode
        plan {
          displayName
        }
        billingAddress {
          city
          country
        }
      }
    }
  `;

  return executeAdminQuery(shopDomain, adminToken, query);
}

/**
 * Admin API 工具定义
 * 这些工具会被注册到 MCP 服务中
 */
const ADMIN_TOOLS = [
  {
    name: 'admin_get_orders',
    description: '获取店铺订单列表 (需要 Admin Token)。返回订单信息包括订单号、状态、金额、商品、收货地址等。',
    input_schema: {
      type: 'object',
      properties: {
        first: {
          type: 'number',
          description: '返回的订单数量 (默认 10，最大 50)',
          default: 10
        },
        query: {
          type: 'string',
          description: '搜索查询 (如 "status:open", "financial_status:paid", "fulfillment_status:unfulfilled")'
        }
      }
    }
  },
  {
    name: 'admin_get_order_by_name',
    description: '根据订单号查询订单详情 (需要 Admin Token)。支持带或不带 # 前缀的订单号。',
    input_schema: {
      type: 'object',
      properties: {
        order_name: {
          type: 'string',
          description: '订单号 (如 "#1001" 或 "1001")'
        }
      },
      required: ['order_name']
    }
  },
  {
    name: 'admin_get_products',
    description: '获取店铺商品列表 (需要 Admin Token)。返回商品信息包括标题、描述、价格、库存等。',
    input_schema: {
      type: 'object',
      properties: {
        first: {
          type: 'number',
          description: '返回的商品数量 (默认 10，最大 50)',
          default: 10
        },
        query: {
          type: 'string',
          description: '搜索查询 (如 "status:active", "title:skateboard")'
        }
      }
    }
  },
  {
    name: 'admin_get_refunds',
    description: '获取退款记录 (需要 Admin Token)。返回已退款或部分退款的订单及其退款详情。',
    input_schema: {
      type: 'object',
      properties: {
        first: {
          type: 'number',
          description: '返回的记录数量 (默认 10)',
          default: 10
        }
      }
    }
  },
  {
    name: 'admin_get_shop_info',
    description: '获取店铺基本信息 (需要 Admin Token)。返回店铺名称、邮箱、域名、货币等。',
    input_schema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * 执行 Admin 工具调用
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @param {string} shopDomain - 店铺域名
 * @param {string} adminToken - Admin Token
 * @returns {Promise<object>} 工具执行结果
 */
async function callAdminTool(toolName, args, shopDomain, adminToken) {
  if (!shopDomain) {
    throw new Error('Shop domain is required for Admin API calls. Please provide shop_id parameter.');
  }

  if (!adminToken) {
    throw new Error('Admin token is required for Admin API calls. Please provide admin_token parameter.');
  }

  console.log(`\n=== Admin Tool Call ===`);
  console.log(`Tool: ${toolName}`);
  console.log(`Shop: ${shopDomain}`);
  console.log(`Args: ${JSON.stringify(args)}`);

  switch (toolName) {
    case 'admin_get_orders':
      return getOrders(shopDomain, adminToken, {
        first: Math.min(args.first || 10, 50),
        query: args.query
      });

    case 'admin_get_order_by_name':
      return getOrderByName(shopDomain, adminToken, args.order_name);

    case 'admin_get_products':
      return getProducts(shopDomain, adminToken, {
        first: Math.min(args.first || 10, 50),
        query: args.query
      });

    case 'admin_get_refunds':
      return getRefunds(shopDomain, adminToken, {
        first: Math.min(args.first || 10, 50)
      });

    case 'admin_get_shop_info':
      return getShopInfo(shopDomain, adminToken);

    default:
      throw new Error(`Unknown admin tool: ${toolName}`);
  }
}

/**
 * 检查工具是否是 Admin 工具
 */
function isAdminTool(toolName) {
  return toolName.startsWith('admin_');
}

export {
  executeAdminQuery,
  getOrders,
  getOrderByName,
  getProducts,
  getRefunds,
  getShopInfo,
  ADMIN_TOOLS,
  callAdminTool,
  isAdminTool
};
