/** 16 random bytes in base64url: 22 characters. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
