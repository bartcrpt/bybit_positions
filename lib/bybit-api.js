import { hmacSha256Hex } from './crypto.js';
import { hasApiCredentials, normalizeSettings } from './settings.js';

export const API_BASE_URL = 'https://api.bybit.com';
export const RECV_WINDOW = 5000;
export const TIME_SYNC_TTL_MS = 5 * 60 * 1000;

const DEFAULT_TIME_SYNC_STATE = {
  offsetMs: 0,
  syncedAt: 0,
  promise: null,
};

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

function toFiniteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function extractBybitServerTimestamp(payload) {
  const topLevelTime = toFiniteTimestamp(payload?.time);
  if (topLevelTime) {
    return topLevelTime;
  }

  const resultTime = toFiniteTimestamp(payload?.result?.time);
  if (resultTime) {
    return resultTime;
  }

  const timeSecond = toFiniteTimestamp(payload?.result?.timeSecond);
  if (timeSecond) {
    return Math.round(timeSecond * 1000);
  }

  const timeNano = toFiniteTimestamp(payload?.result?.timeNano);
  if (timeNano) {
    return Math.round(timeNano / 1000000);
  }

  return null;
}

export function isBybitTimestampError(error) {
  const code = Number(error?.retCode ?? error?.status ?? error?.code);
  const message = String(error?.retMsg ?? error?.message ?? '').toLowerCase();

  return code === 10002
    || message.includes('server timestamp')
    || message.includes('req_timestamp')
    || message.includes('recv_window');
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

async function syncBybitServerTime(options) {
  const {
    baseUrl = API_BASE_URL,
    fetchImpl = globalThis.fetch,
    signal,
    now = Date.now,
    force = false,
    timeSyncState = DEFAULT_TIME_SYNC_STATE,
  } = options;

  if (!fetchImpl) {
    throw new Error('fetch API is unavailable.');
  }

  const currentTime = now();
  if (!force && timeSyncState.syncedAt && currentTime - timeSyncState.syncedAt < TIME_SYNC_TTL_MS) {
    return timeSyncState.offsetMs || 0;
  }

  if (!force && timeSyncState.promise) {
    return timeSyncState.promise;
  }

  timeSyncState.promise = (async () => {
    const startedAt = now();
    const payload = await requestJson(`${baseUrl}/v5/market/time`, fetchImpl, {
      method: 'GET',
      signal,
    });
    const endedAt = now();
    const serverTimestamp = extractBybitServerTimestamp(payload);

    if (!serverTimestamp) {
      throw createBybitError({ retMsg: 'Invalid Bybit server time response' }, 0);
    }

    const localMidpoint = startedAt + ((endedAt - startedAt) / 2);
    timeSyncState.offsetMs = Math.round(serverTimestamp - localMidpoint);
    timeSyncState.syncedAt = endedAt;

    return timeSyncState.offsetMs;
  })();

  try {
    return await timeSyncState.promise;
  } finally {
    timeSyncState.promise = null;
  }
}

function getSignedTimestamp(now, timeSyncState) {
  return Math.trunc(now() + (timeSyncState.offsetMs || 0));
}

export async function bybitGet(endpoint, params = {}, settings = {}, options = {}) {
  const {
    auth = true,
    baseUrl = API_BASE_URL,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    signer = hmacSha256Hex,
    signal,
    timeSyncState = DEFAULT_TIME_SYNC_STATE,
    skipTimeSync = false,
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

    if (!skipTimeSync) {
      await syncBybitServerTime({
        baseUrl,
        fetchImpl,
        signal,
        now,
        timeSyncState,
      });
    }

    Object.assign(headers, await createSignedHeaders({
      apiKey: normalizedSettings.apiKey,
      apiSecret: normalizedSettings.apiSecret,
      queryString,
      timestamp: getSignedTimestamp(now, timeSyncState),
      signer,
    }));
  }

  try {
    return await requestJson(url, fetchImpl, {
      method: 'GET',
      headers,
      signal,
    });
  } catch (error) {
    if (!auth || skipTimeSync || !isBybitTimestampError(error)) {
      throw error;
    }

    await syncBybitServerTime({
      baseUrl,
      fetchImpl,
      signal,
      now,
      force: true,
      timeSyncState,
    });

    const retryHeaders = await createSignedHeaders({
      apiKey: normalizedSettings.apiKey,
      apiSecret: normalizedSettings.apiSecret,
      queryString,
      timestamp: getSignedTimestamp(now, timeSyncState),
      signer,
    });

    return requestJson(url, fetchImpl, {
      method: 'GET',
      headers: retryHeaders,
      signal,
    });
  }
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
