import assert from 'node:assert/strict';
import test from 'node:test';

import { bybitGet } from '../lib/bybit-api.js';

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

const settings = {
  apiKey: 'key',
  apiSecret: 'secret',
};

test('syncs Bybit server time before signing authenticated requests', async () => {
  const calls = [];
  let signedPayload = '';

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url === 'https://example.test/v5/market/time') {
      return jsonResponse({ retCode: 0, result: {}, time: 100000 });
    }

    return jsonResponse({ retCode: 0, result: { ok: true } });
  };

  const result = await bybitGet('/v5/user/query-api', {}, settings, {
    baseUrl: 'https://example.test',
    fetchImpl,
    now: () => 101500,
    signer: async (payload) => {
      signedPayload = payload;
      return 'signature';
    },
    timeSyncState: {},
  });

  assert.deepEqual(result.result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.test/v5/market/time');
  assert.equal(calls[1].options.headers['X-BAPI-TIMESTAMP'], '100000');
  assert.equal(signedPayload, '100000key5000');
});

test('resyncs server time and retries once on Bybit timestamp errors', async () => {
  const calls = [];
  const signedPayloads = [];

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url === 'https://example.test/v5/market/time') {
      return jsonResponse({ retCode: 0, result: { timeNano: '100000000000' } });
    }

    if (calls.filter((call) => call.url.endsWith('/v5/user/query-api')).length === 1) {
      return jsonResponse({
        retCode: 10002,
        retMsg: 'invalid request, please check your server timestamp or recv_window param',
      });
    }

    return jsonResponse({ retCode: 0, result: { ok: true } });
  };

  const result = await bybitGet('/v5/user/query-api', {}, settings, {
    baseUrl: 'https://example.test',
    fetchImpl,
    now: () => 101500,
    signer: async (payload) => {
      signedPayloads.push(payload);
      return 'signature';
    },
    timeSyncState: {
      offsetMs: 1500,
      syncedAt: 101000,
    },
  });

  assert.deepEqual(result.result, { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers['X-BAPI-TIMESTAMP'], '103000');
  assert.equal(calls[1].url, 'https://example.test/v5/market/time');
  assert.equal(calls[2].options.headers['X-BAPI-TIMESTAMP'], '100000');
  assert.deepEqual(signedPayloads, [
    '103000key5000',
    '100000key5000',
  ]);
});
