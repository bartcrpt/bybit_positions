import { hmacSha256Hex } from './crypto.js';
import { hasApiCredentials, normalizeSettings } from './settings.js';

export const API_BASE_URL = 'https://api.bybit.com';
export const RECV_WINDOW = 5000;

export function buildQueryString(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export async function createSignedHeaders(options) {
  const {
    apiKey,
    apiSecret,
    queryString = '',
    timestamp = Date.now(),
    recvWindow = RECV_WINDOW,
    signer = hmacSha256Hex,
  } = options;
  const payload = `${timestamp}${apiKey}${recvWindow}${queryString}`;
  const sign = await signer(payload, apiSecret);

  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-SIGN': sign,
    'X-BAPI-SIGN-TYPE': '2',
    'X-BAPI-TIMESTAMP': String(timestamp),
    'X-BAPI-RECV-WINDOW': String(recvWindow),
  };
}

export function getTodayClosedPnlRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  return {
    startTime: start.getTime(),
    endTime: now.getTime(),
  };
}

export function getBybitErrorMessage(error) {
  const code = Number(error?.retCode ?? error?.status ?? error?.code);
  const message = String(error?.retMsg ?? error?.message ?? '').toLowerCase();

  if ([10003, 10004, 10005, 33004, 403].includes(code) || message.includes('api key')) {
    return 'Ключ невалиден или отозван. Проверьте настройки.';
  }

  if (code === 10010 || message.includes('ip')) {
    return 'Ваш IP не разрешён для этого API-ключа.';
  }

  if (code === 10006 || code === 429 || message.includes('rate') || message.includes('too many')) {
    return 'Слишком частые запросы, жду...';
  }

  if (error?.name === 'AbortError' || message.includes('network') || message.includes('fetch')) {
    return 'Нет связи с Bybit. Проверьте интернет-соединение.';
  }

  if (error?.retMsg) {
    return error.retMsg;
  }

  return 'Пустой или неожиданный ответ Bybit. Данные могут быть устаревшими.';
}

export function createBybitError(payload, status) {
  const error = new Error(getBybitErrorMessage({ ...payload, status }));
  error.retCode = payload?.retCode;
  error.retMsg = payload?.retMsg;
  error.status = status;
  error.userMessage = error.message;
  return error;
}

async function requestJson(url, fetchImpl, options) {
  const response = await fetchImpl(url, options);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    throw createBybitError({ retMsg: 'Invalid JSON response' }, response.status);
  }

  if (!response.ok || Number(payload?.retCode ?? 0) !== 0) {
    throw createBybitError(payload, response.status);
  }

  return payload;
}

export async function bybitGet(endpoint, params = {}, settings = {}, options = {}) {
  const {
    auth = true,
    baseUrl = API_BASE_URL,
    fetchImpl = globalThis.fetch,
    signal,
  } = options;
  const normalizedSettings = normalizeSettings(settings);
  const queryString = buildQueryString(params);
  const url = `${baseUrl}${endpoint}${queryString ? `?${queryString}` : ''}`;
  const headers = {};

  if (!fetchImpl) {
    throw new Error('fetch API is unavailable.');
  }

  if (auth) {
    if (!hasApiCredentials(normalizedSettings)) {
      throw createBybitError({ retCode: 'MISSING_CREDENTIALS', retMsg: 'Missing credentials' }, 0);
    }

    Object.assign(headers, await createSignedHeaders({
      apiKey: normalizedSettings.apiKey,
      apiSecret: normalizedSettings.apiSecret,
      queryString,
    }));
  }

  return requestJson(url, fetchImpl, {
    method: 'GET',
    headers,
    signal,
  });
}

export function fetchWalletBalance(settings, options = {}) {
  return bybitGet('/v5/account/wallet-balance', {
    accountType: settings.accountType,
  }, settings, options);
}

export function fetchPositions(settings, category, options = {}) {
  return bybitGet('/v5/position/list', {
    category,
    settleCoin: category === 'linear' ? 'USDT' : undefined,
  }, settings, options);
}

export function fetchClosedPnl(settings, category, options = {}) {
  return bybitGet('/v5/position/closed-pnl', {
    category,
    ...getTodayClosedPnlRange(),
    limit: 50,
  }, settings, options);
}

export function fetchTickers(category, options = {}) {
  return bybitGet('/v5/market/tickers', {
    category,
  }, {}, {
    ...options,
    auth: false,
  });
}

export function testConnection(settings, options = {}) {
  return bybitGet('/v5/user/query-api', {}, settings, options);
}

export async function fetchMonitorSnapshot(settings, options = {}) {
  const normalizedSettings = normalizeSettings(settings);

  if (!hasApiCredentials(normalizedSettings)) {
    throw createBybitError({ retCode: 'MISSING_CREDENTIALS', retMsg: 'Missing credentials' }, 0);
  }

  const walletBalance = await fetchWalletBalance(normalizedSettings, options);

  const entries = await Promise.all(normalizedSettings.positionCategories.map(async (category) => {
    const [positions, closedPnl, tickers] = await Promise.all([
      fetchPositions(normalizedSettings, category, options),
      fetchClosedPnl(normalizedSettings, category, options),
      fetchTickers(category, options),
    ]);

    return [category, { positions, closedPnl, tickers }];
  }));

  return {
    walletBalance,
    positionsByCategory: Object.fromEntries(entries.map(([category, data]) => [category, data.positions])),
    closedPnlByCategory: Object.fromEntries(entries.map(([category, data]) => [category, data.closedPnl])),
    tickersByCategory: Object.fromEntries(entries.map(([category, data]) => [category, data.tickers])),
    fetchedAt: Date.now(),
  };
}
