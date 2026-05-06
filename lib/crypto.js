function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256Hex(message, secret, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API is unavailable.');
  }

  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoImpl.subtle.sign('HMAC', key, encoder.encode(message));

  return bytesToHex(signature);
}
