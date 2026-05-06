import { getBybitErrorMessage, testConnection } from '../lib/bybit-api.js';
import { hasApiCredentials, normalizeSettings, themeClass } from '../lib/settings.js';
import { readSettings, saveSettings } from '../lib/storage.js';

const form = document.getElementById('settingsForm');
const resultBanner = document.getElementById('resultBanner');
const saveState = document.getElementById('saveState');
const testConnectionButton = document.getElementById('testConnectionButton');

function field(id) {
  return document.getElementById(id);
}

function setBanner(message, type = 'ok') {
  resultBanner.textContent = message;
  resultBanner.hidden = false;
  resultBanner.classList.toggle('is-ok', type === 'ok');
  resultBanner.classList.toggle('is-error', type === 'error');
}

function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(themeClass(theme));
}

function collectSettings() {
  const formData = new FormData(form);
  const positionCategories = formData.getAll('positionCategories');

  return normalizeSettings({
    apiKey: formData.get('apiKey'),
    apiSecret: formData.get('apiSecret'),
    accountType: formData.get('accountType'),
    positionCategories,
    refreshIntervalSeconds: formData.get('refreshIntervalSeconds'),
    theme: formData.get('theme'),
    notificationsEnabled: formData.get('notificationsEnabled') === 'on',
    liquidationAlertPercent: formData.get('liquidationAlertPercent'),
  });
}

function fillForm(settings) {
  field('apiKey').value = settings.apiKey;
  field('apiSecret').value = settings.apiSecret;
  field('accountType').value = settings.accountType;
  field('refreshIntervalSeconds').value = String(settings.refreshIntervalSeconds);
  field('displayCurrency').value = settings.displayCurrency;
  field('theme').value = settings.theme;
  field('categoryLinear').checked = settings.positionCategories.includes('linear');
  field('categoryInverse').checked = settings.positionCategories.includes('inverse');
  field('notificationsEnabled').checked = settings.notificationsEnabled;
  field('liquidationAlertPercent').value = settings.liquidationAlertPercent;
  applyTheme(settings.theme);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function handleSave(event) {
  event.preventDefault();
  const settings = await saveSettings(collectSettings());
  fillForm(settings);
  saveState.textContent = 'сохранено';
  setBanner('Настройки сохранены.', 'ok');
  sendRuntimeMessage({ type: 'settings-updated' }).catch(() => {});
}

async function handleTestConnection() {
  const settings = collectSettings();

  if (!hasApiCredentials(settings)) {
    setBanner('Введите API Key и API Secret.', 'error');
    return;
  }

  testConnectionButton.disabled = true;
  testConnectionButton.textContent = 'Проверяю...';

  try {
    const response = await testConnection(settings);
    const accountType = response?.result?.permissions ? settings.accountType : settings.accountType;
    setBanner(`Подключение успешно, аккаунт: ${accountType}.`, 'ok');
  } catch (error) {
    setBanner(getBybitErrorMessage(error), 'error');
  } finally {
    testConnectionButton.disabled = false;
    testConnectionButton.textContent = 'Проверить соединение';
  }
}

function setupSecretToggles() {
  for (const button of document.querySelectorAll('[data-toggle-secret]')) {
    button.addEventListener('click', () => {
      const input = field(button.dataset.toggleSecret);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }
}

async function init() {
  fillForm(await readSettings());
  setupSecretToggles();
  form.addEventListener('submit', handleSave);
  testConnectionButton.addEventListener('click', handleTestConnection);
  field('theme').addEventListener('change', () => applyTheme(field('theme').value));
  form.addEventListener('input', () => {
    saveState.textContent = 'есть изменения';
  });
}

init().catch((error) => {
  setBanner(getBybitErrorMessage(error), 'error');
});
