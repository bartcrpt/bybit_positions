export const ACCOUNT_TYPES = ['UNIFIED', 'CONTRACT'];
export const POSITION_CATEGORIES = ['linear', 'inverse'];
export const REFRESH_INTERVALS = [5, 10, 15, 30, 60, 'manual'];
export const THEMES = ['dark', 'light', 'system'];

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  apiSecret: '',
  accountType: 'UNIFIED',
  positionCategories: ['linear'],
  refreshIntervalSeconds: 10,
  displayCurrency: 'USDT',
  theme: 'dark',
  notificationsEnabled: false,
  liquidationAlertPercent: 5,
});

function normalizeAccountType(value) {
  const normalized = String(value ?? '').trim().toUpperCase();

  if (normalized === 'STANDARD' || normalized === 'CONTRACT') {
    return 'CONTRACT';
  }

  if (normalized === 'UNIFIED' || normalized === 'UTA') {
    return 'UNIFIED';
  }

  return DEFAULT_SETTINGS.accountType;
}

function normalizeCategories(value) {
  const values = Array.isArray(value) ? value : [value];
  const filtered = values
    .map((category) => String(category ?? '').trim().toLowerCase())
    .filter((category, index, all) => (
      POSITION_CATEGORIES.includes(category) && all.indexOf(category) === index
    ));

  return filtered.length > 0 ? filtered : [...DEFAULT_SETTINGS.positionCategories];
}

function normalizeRefreshInterval(value) {
  if (value === 'manual') {
    return 'manual';
  }

  const seconds = Number(value);
  return REFRESH_INTERVALS.includes(seconds)
    ? seconds
    : DEFAULT_SETTINGS.refreshIntervalSeconds;
}

function normalizeTheme(value) {
  const theme = String(value ?? '').trim().toLowerCase();
  return THEMES.includes(theme) ? theme : DEFAULT_SETTINGS.theme;
}

function normalizeLiquidationAlertPercent(value) {
  const percent = Number(value);

  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return DEFAULT_SETTINGS.liquidationAlertPercent;
  }

  return percent;
}

export function normalizeSettings(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    apiKey: String(raw.apiKey ?? DEFAULT_SETTINGS.apiKey).trim(),
    apiSecret: String(raw.apiSecret ?? DEFAULT_SETTINGS.apiSecret).trim(),
    accountType: normalizeAccountType(raw.accountType),
    positionCategories: normalizeCategories(raw.positionCategories),
    refreshIntervalSeconds: normalizeRefreshInterval(raw.refreshIntervalSeconds),
    displayCurrency: DEFAULT_SETTINGS.displayCurrency,
    theme: normalizeTheme(raw.theme),
    notificationsEnabled: Boolean(raw.notificationsEnabled),
    liquidationAlertPercent: normalizeLiquidationAlertPercent(raw.liquidationAlertPercent),
  };
}

export function hasApiCredentials(settings) {
  return Boolean(String(settings?.apiKey ?? '').trim() && String(settings?.apiSecret ?? '').trim());
}

export function getAlarmPeriodMinutes(refreshIntervalSeconds) {
  if (refreshIntervalSeconds === 'manual') {
    return null;
  }

  const seconds = Number(refreshIntervalSeconds);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.max(0.5, seconds / 60);
}

export function themeClass(theme) {
  const normalized = normalizeTheme(theme);

  if (normalized === 'system') {
    return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'theme-light'
      : 'theme-dark';
  }

  return normalized === 'light' ? 'theme-light' : 'theme-dark';
}
