function fallbackFingerprint(value) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x85ebca77];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let part = 0; part < hashes.length; part += 1) {
      hashes[part] = Math.imul(hashes[part] ^ code, primes[part]) >>> 0;
    }
  }
  return hashes.map((hash) => hash.toString(16).padStart(8, '0')).join('');
}

async function sha256(value) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    return fallbackFingerprint(value);
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function prepareFinancialIntent(operation, payload) {
  const storageKey = `pending-intent:${operation}`;
  const fingerprint = await sha256(JSON.stringify(payload));
  const previous = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (previous?.fingerprint === fingerprint && previous?.requestId) return previous.requestId;
  const intent = { requestId: createRequestId(), fingerprint, createdAt: new Date().toISOString() };
  sessionStorage.setItem(storageKey, JSON.stringify(intent));
  return intent.requestId;
}

export function resolveFinancialIntent(operation) {
  sessionStorage.removeItem(`pending-intent:${operation}`);
}
