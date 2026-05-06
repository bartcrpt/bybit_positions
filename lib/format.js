const EMPTY = '—';

export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedPrefix(number, signed) {
  return signed && number > 0 ? '+' : '';
}

export function formatMoney(value, options = {}) {
  const {
    currency = 'USDT',
    signed = false,
    digits = 2,
  } = options;
  const number = toFiniteNumber(value);

  if (number === null) {
    return EMPTY;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);

  return `${signedPrefix(number, signed)}${formatted} ${currency}`;
}

export function formatPercent(value, options = {}) {
  const { signed = false, digits = 2 } = options;
  const number = toFiniteNumber(value);

  if (number === null) {
    return EMPTY;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);

  return `${signedPrefix(number, signed)}${formatted}%`;
}

export function formatNumber(value, options = {}) {
  const { digits = 4 } = options;
  const number = toFiniteNumber(value);

  if (number === null) {
    return EMPTY;
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
  }).format(number);
}

export function formatPrice(value) {
  const number = toFiniteNumber(value);

  if (number === null) {
    return EMPTY;
  }

  const digits = Math.abs(number) >= 1 ? 2 : 6;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

export function formatAge(timestamp, now = Date.now()) {
  const time = toFiniteNumber(timestamp);

  if (time === null) {
    return 'не обновлялось';
  }

  const diffSeconds = Math.max(0, Math.floor((now - time) / 1000));

  if (diffSeconds < 60) {
    return `обновлено ${diffSeconds} сек назад`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `обновлено ${diffMinutes} мин назад`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `обновлено ${diffHours} ч назад`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `обновлено ${diffDays} дн назад`;
}

export function formatDateTime(timestamp) {
  const time = toFiniteNumber(timestamp);

  if (time === null) {
    return EMPTY;
  }

  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return EMPTY;
  }

  const pad = (value) => String(value).padStart(2, '0');

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(' ');
}

export function maskSecret(secret) {
  const value = String(secret ?? '');

  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 4)}****...****${value.slice(-4)}`;
}

export function signedClass(value) {
  const number = toFiniteNumber(value);

  if (number === null || number === 0) {
    return 'is-neutral';
  }

  return number > 0 ? 'is-positive' : 'is-negative';
}
