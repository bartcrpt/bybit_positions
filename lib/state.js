import { getBybitErrorMessage } from './bybit-api.js';

export const PNL_POSITIVE = '#00c853';
export const PNL_NEGATIVE = '#ff1744';
export const PNL_NEUTRAL = '#7a7f8b';

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstListItem(payload) {
  return payload?.result?.list?.[0] ?? {};
}

function payloadList(payload) {
  return Array.isArray(payload?.result?.list) ? payload.result.list : [];
}

function safePercent(numerator, denominator) {
  const top = numberOrZero(numerator);
  const bottom = numberOrZero(denominator);

  return bottom === 0 ? 0 : (top / bottom) * 100;
}

function buildTickerMap(tickersByCategory = {}) {
  return Object.fromEntries(Object.entries(tickersByCategory).map(([category, payload]) => {
    const tickers = payloadList(payload);
    return [
      category,
      Object.fromEntries(tickers.map((ticker) => [ticker.symbol, ticker])),
    ];
  }));
}

function sideToDirection(side) {
  const normalized = String(side ?? '').toLowerCase();

  if (normalized === 'buy' || normalized === 'long') {
    return 'Long';
  }

  if (normalized === 'sell' || normalized === 'short') {
    return 'Short';
  }

  return side || '—';
}

function liquidationDistancePercent(direction, markPrice, liqPrice) {
  const mark = numberOrZero(markPrice);
  const liquidation = numberOrZero(liqPrice);

  if (!mark || !liquidation) {
    return null;
  }

  if (direction === 'Long') {
    return Math.max(0, ((mark - liquidation) / mark) * 100);
  }

  if (direction === 'Short') {
    return Math.max(0, ((liquidation - mark) / mark) * 100);
  }

  return null;
}

function normalizePosition(position, category, tickerMap) {
  const ticker = tickerMap?.[category]?.[position.symbol] ?? {};
  const direction = sideToDirection(position.side);
  const markPrice = numberOrZero(position.markPrice || ticker.markPrice || ticker.lastPrice);
  const unrealizedPnl = numberOrZero(position.unrealisedPnl ?? position.unrealizedPnl);
  const positionValue = numberOrZero(position.positionValue);
  const margin = numberOrZero(position.positionIM ?? position.positionBalance ?? position.positionMargin);

  return {
    category,
    symbol: position.symbol ?? '—',
    direction,
    directionTag: direction === 'Short' ? 'SHORT' : 'LONG',
    size: numberOrZero(position.size),
    entryPrice: numberOrZero(position.avgPrice ?? position.entryPrice),
    markPrice,
    unrealizedPnl,
    pnlPercent: safePercent(unrealizedPnl, positionValue),
    roiPercent: safePercent(unrealizedPnl, margin),
    leverage: numberOrZero(position.leverage),
    liqPrice: numberOrZero(position.liqPrice),
    margin,
    takeProfit: numberOrZero(position.takeProfit),
    stopLoss: numberOrZero(position.stopLoss),
    openedAt: Number(position.createdTime || position.updatedTime || 0) || null,
    liquidationDistancePercent: liquidationDistancePercent(direction, markPrice, position.liqPrice),
  };
}

function normalizePositions(positionsByCategory = {}, tickersByCategory = {}) {
  const tickerMap = buildTickerMap(tickersByCategory);

  return Object.entries(positionsByCategory)
    .flatMap(([category, payload]) => payloadList(payload)
      .filter((position) => numberOrZero(position.size) > 0)
      .map((position) => normalizePosition(position, category, tickerMap)));
}

function sumClosedPnl(closedPnlByCategory = {}) {
  return Object.values(closedPnlByCategory)
    .flatMap((payload) => payloadList(payload))
    .reduce((total, record) => total + numberOrZero(record.closedPnl), 0);
}

function normalizeWallet(walletBalance) {
  const wallet = firstListItem(walletBalance);
  const usdtCoin = wallet.coin?.find?.((coin) => coin.coin === 'USDT') ?? {};
  const equity = numberOrZero(wallet.totalEquity ?? usdtCoin.equity);
  const availableBalance = numberOrZero(
    wallet.totalAvailableBalance
      ?? usdtCoin.availableToWithdraw
      ?? usdtCoin.walletBalance,
  );
  const usedMargin = numberOrZero(
    wallet.totalInitialMargin
      ?? (equity && availableBalance ? equity - availableBalance : 0),
  );

  return {
    equity,
    availableBalance,
    usedMargin,
  };
}

export function createMonitorState(snapshot = {}) {
  const {
    walletBalance,
    positionsByCategory = {},
    closedPnlByCategory = {},
    tickersByCategory = {},
    fetchedAt = Date.now(),
  } = snapshot;
  const positions = normalizePositions(positionsByCategory, tickersByCategory);
  const wallet = normalizeWallet(walletBalance);
  const totalUnrealizedPnl = positions.reduce((total, position) => total + position.unrealizedPnl, 0);
  const closedPnlToday = sumClosedPnl(closedPnlByCategory);

  return {
    connected: true,
    fetchedAt,
    errorMessage: '',
    summary: {
      ...wallet,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent: safePercent(totalUnrealizedPnl, wallet.equity),
      closedPnlToday,
    },
    positions,
  };
}

export function createErrorState(error, cachedState = null) {
  const baseState = cachedState ?? {
    fetchedAt: null,
    summary: {
      equity: 0,
      totalUnrealizedPnl: 0,
      totalUnrealizedPnlPercent: 0,
      closedPnlToday: 0,
      availableBalance: 0,
      usedMargin: 0,
    },
    positions: [],
  };

  return {
    ...baseState,
    connected: false,
    stale: Boolean(cachedState),
    errorMessage: getBybitErrorMessage(error),
  };
}

export function getBadgeState(state) {
  const positionCount = state?.positions?.length ?? 0;

  if (!state?.connected || positionCount === 0) {
    return { text: '', color: PNL_NEUTRAL };
  }

  return {
    text: String(positionCount),
    color: numberOrZero(state.summary?.totalUnrealizedPnl) >= 0 ? PNL_POSITIVE : PNL_NEGATIVE,
  };
}
