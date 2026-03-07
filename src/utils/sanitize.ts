const UID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function sanitizeUid(uid: string): boolean {
  return UID_REGEX.test(uid);
}
