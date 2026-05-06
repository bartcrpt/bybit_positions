import { fetchMonitorSnapshot } from '../lib/bybit-api.js';
import {
  formatAge,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPrice,
  signedClass,
} from '../lib/format.js';
import { getBadgeState, createErrorState, createMonitorState } from '../lib/state.js';
import { hasApiCredentials, themeClass } from '../lib/settings.js';
import { readCachedState, readSettings, saveCachedState } from '../lib/storage.js';

const elements = {};
let settings = null;
let refreshTimer = null;
let ageTimer = null;
let lastState = null;

function byId(id) {
  return document.getElementById(id);
}

function captureElements() {
  for (const id of [
    'availableBalance',
    'closedPnlToday',
    'connectionDot',
    'emptyPositionsState',
    'equityValue',
    'errorState',
    'errorText',
    'lastUpdated',
    'loadingState',
    'needsSettingsState',
    'noticeBanner',
    'openSettingsButton',
    'optionsButton',
    'positionsList',
    'refreshButton',
    'retryButton',
    'totalUnrealizedPnl',
    'totalUnrealizedPnlPercent',
    'usedMargin',
  ]) {
    elements[id] = byId(id);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function maybePrice(value) {
  return Number(value) > 0 ? formatPrice(value) : '—';
}

function setVisible(target, visible) {
  target.hidden = !visible;
}

function showOnly(panel) {
  for (const item of [
    elements.loadingState,
    elements.needsSettingsState,
    elements.errorState,
    elements.emptyPositionsState,
    elements.positionsList,
  ]) {
    setVisible(item, item === panel);
  }
}

function applyTheme() {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(themeClass(settings?.theme));
}

function setConnection(connected) {
  elements.connectionDot.classList.toggle('is-online', Boolean(connected));
  elements.connectionDot.classList.toggle('is-offline', connected === false);
}

function renderSummary(state) {
  const summary = state.summary;
  const pnlClass = signedClass(summary.totalUnrealizedPnl);

  elements.equityValue.textContent = formatMoney(summary.equity);
  elements.totalUnrealizedPnl.textContent = formatMoney(summary.totalUnrealizedPnl, { signed: true });
  elements.totalUnrealizedPnl.className = pnlClass;
  elements.totalUnrealizedPnlPercent.textContent = `(${formatPercent(summary.totalUnrealizedPnlPercent, { signed: true })})`;
  elements.totalUnrealizedPnlPercent.className = pnlClass;
  elements.closedPnlToday.textContent = formatMoney(summary.closedPnlToday, { signed: true });
  elements.closedPnlToday.className = signedClass(summary.closedPnlToday);
  elements.availableBalance.textContent = formatMoney(summary.availableBalance);
  elements.usedMargin.textContent = formatMoney(summary.usedMargin);
}

function positionTemplate(position) {
  const sideClass = position.direction === 'Short' ? 'short' : 'long';

  return `
    <article class="position-card">
      <header class="position-card__head">
        <span class="symbol">${escapeHtml(position.symbol)}</span>
        <span class="position-tags">
          <span class="side-tag ${sideClass}">${escapeHtml(position.directionTag)}</span>
          <span class="leverage-tag">${formatNumber(position.leverage, { digits: 2 })}x</span>
        </span>
      </header>
      <div class="position-card__body">
        <div class="position-row"><span>Размер</span><strong>${formatNumber(position.size, { digits: 6 })}</strong></div>
        <div class="position-row"><span>Вход</span><strong>${formatPrice(position.entryPrice)}</strong></div>
        <div class="position-row"><span>Маркировка</span><strong>${formatPrice(position.markPrice)}</strong></div>
        <div class="position-row position-row--pnl">
          <span>PnL</span>
          <strong class="${signedClass(position.unrealizedPnl)}">${formatMoney(position.unrealizedPnl, { signed: true })} (${formatPercent(position.pnlPercent, { signed: true })})</strong>
        </div>
        <div class="position-row"><span>ROI</span><strong class="${signedClass(position.roiPercent)}">${formatPercent(position.roiPercent, { signed: true })}</strong></div>
        <div class="position-row"><span>Маржа</span><strong>${formatMoney(position.margin)}</strong></div>
        <div class="position-row"><span>Ликв.</span><strong>${maybePrice(position.liqPrice)}</strong></div>
        <div class="position-row"><span>TP / SL</span><strong>${maybePrice(position.takeProfit)} / ${maybePrice(position.stopLoss)}</strong></div>
        <div class="position-row"><span>Открыта</span><strong>${formatDateTime(position.openedAt)}</strong></div>
      </div>
    </article>
  `;
}

function renderPositions(positions) {
  elements.positionsList.replaceChildren();
  elements.positionsList.insertAdjacentHTML('beforeend', positions.map(positionTemplate).join(''));
}

async function applyBadge(state) {
  const badge = getBadgeState(state);

  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

function updateLastUpdated() {
  elements.lastUpdated.textContent = formatAge(lastState?.fetchedAt);
}

function renderState(state) {
  lastState = state;
  renderSummary(state);
  setConnection(state.connected);
  updateLastUpdated();

  if (state.errorMessage && state.stale) {
    elements.noticeBanner.textContent = `${state.errorMessage} Показаны последние кэшированные данные.`;
    setVisible(elements.noticeBanner, true);
  } else {
    setVisible(elements.noticeBanner, false);
  }

  if (state.errorMessage && !state.stale) {
    elements.errorText.textContent = state.errorMessage;
    showOnly(elements.errorState);
  } else if (state.positions.length === 0) {
    showOnly(elements.emptyPositionsState);
  } else {
    renderPositions(state.positions);
    showOnly(elements.positionsList);
  }

  applyBadge(state).catch(() => {});
}

function showNeedsSettings() {
  setConnection(false);
  setVisible(elements.noticeBanner, false);
  showOnly(elements.needsSettingsState);
}

function setRefreshing(refreshing) {
  elements.refreshButton.classList.toggle('is-refreshing', refreshing);
  elements.refreshButton.disabled = refreshing;
}

async function refreshData() {
  if (!hasApiCredentials(settings)) {
    showNeedsSettings();
    return;
  }

  setRefreshing(true);

  try {
    const snapshot = await fetchMonitorSnapshot(settings);
    const state = createMonitorState(snapshot);
    await saveCachedState(state);
    renderState(state);
  } catch (error) {
    const cached = await readCachedState().catch(() => null);
    renderState(createErrorState(error, cached));
  } finally {
    setRefreshing(false);
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);

  if (settings.refreshIntervalSeconds === 'manual') {
    return;
  }

  refreshTimer = setInterval(refreshData, Number(settings.refreshIntervalSeconds) * 1000);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function init() {
  captureElements();
  settings = await readSettings();
  applyTheme();

  elements.refreshButton.addEventListener('click', refreshData);
  elements.retryButton.addEventListener('click', refreshData);
  elements.optionsButton.addEventListener('click', openOptions);
  elements.openSettingsButton.addEventListener('click', openOptions);

  const cached = await readCachedState().catch(() => null);

  if (cached) {
    renderState(cached);
  } else if (!hasApiCredentials(settings)) {
    showNeedsSettings();
  } else {
    showOnly(elements.loadingState);
  }

  await refreshData();
  scheduleRefresh();
  clearInterval(ageTimer);
  ageTimer = setInterval(updateLastUpdated, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    captureElements();
    renderState(createErrorState(error));
  });
});
