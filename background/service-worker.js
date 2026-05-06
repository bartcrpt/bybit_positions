import { fetchMonitorSnapshot } from '../lib/bybit-api.js';
import { hasApiCredentials, getAlarmPeriodMinutes } from '../lib/settings.js';
import { createErrorState, createMonitorState, getBadgeState } from '../lib/state.js';
import {
  readCachedState,
  readPreviousPositionKeys,
  readSettings,
  saveCachedState,
  savePreviousPositionKeys,
} from '../lib/storage.js';

const REFRESH_ALARM = 'bybit-monitor-refresh';
const OPTIONS_CONTEXT_MENU = 'bybit-monitor-options';

async function setBadge(state) {
  const badge = getBadgeState(state);
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

function positionKey(position) {
  return `${position.category}:${position.symbol}:${position.direction}`;
}

function createNotification(id, title, message) {
  return chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: 1,
  });
}

async function maybeNotify(settings, state) {
  if (!settings.notificationsEnabled) {
    await savePreviousPositionKeys(state.positions.map(positionKey));
    return;
  }

  for (const position of state.positions) {
    if (
      position.liquidationDistancePercent !== null
      && position.liquidationDistancePercent <= settings.liquidationAlertPercent
    ) {
      createNotification(
        `liq-${positionKey(position)}`,
        `${position.symbol}: близко к ликвидации`,
        `До ликвидации примерно ${position.liquidationDistancePercent.toFixed(2)}%.`,
      );
    }
  }

  const previousKeys = await readPreviousPositionKeys();
  const currentKeys = state.positions.map(positionKey);
  const closedKeys = previousKeys.filter((key) => !currentKeys.includes(key));

  for (const key of closedKeys) {
    createNotification(
      `closed-${key}-${Date.now()}`,
      'Позиция закрылась',
      key.replaceAll(':', ' '),
    );
  }

  await savePreviousPositionKeys(currentKeys);
}

async function refreshAndCache({ notify = false } = {}) {
  const settings = await readSettings();

  if (!hasApiCredentials(settings)) {
    const state = createErrorState({ retMsg: 'Missing credentials' });
    await setBadge(state);
    return state;
  }

  try {
    const snapshot = await fetchMonitorSnapshot(settings);
    const state = createMonitorState(snapshot);
    await saveCachedState(state);
    await setBadge(state);

    if (notify) {
      await maybeNotify(settings, state);
    }

    return state;
  } catch (error) {
    const cached = await readCachedState().catch(() => null);
    const state = createErrorState(error, cached);
    await saveCachedState(state).catch(() => {});
    await setBadge(state);
    return state;
  }
}

async function scheduleRefresh() {
  const settings = await readSettings();
  await chrome.alarms.clear(REFRESH_ALARM);
  const periodInMinutes = getAlarmPeriodMinutes(settings.refreshIntervalSeconds);

  if (periodInMinutes) {
    await chrome.alarms.create(REFRESH_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }
}

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: OPTIONS_CONTEXT_MENU,
      title: 'Настройки Bybit Positions Monitor',
      contexts: ['action'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  scheduleRefresh();
  refreshAndCache();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRefresh();
  refreshAndCache();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshAndCache({ notify: true });
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === OPTIONS_CONTEXT_MENU) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  (async () => {
    if (message.type === 'settings-updated') {
      await scheduleRefresh();
      const state = await refreshAndCache();
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === 'refresh-now') {
      const state = await refreshAndCache({ notify: false });
      sendResponse({ ok: true, state });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
