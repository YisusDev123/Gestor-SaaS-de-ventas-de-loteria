import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function createPublicId() {
  let value = BigInt(`0x${randomBytes(16).toString('hex')}`);
  let result = '';
  for (let index = 0; index < 26; index += 1) {
    result = ALPHABET[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}
