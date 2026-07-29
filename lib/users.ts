export const ALLOWED_USERNAMES = ['Mohammed', 'Hossam', 'ANS'] as const;

export type AllowedUsername = (typeof ALLOWED_USERNAMES)[number];

export const USER_PASSWORD_ENV = [
  { username: 'Mohammed', env: 'USER_MOHAMMED_PASSWORD' },
  { username: 'Hossam', env: 'USER_HOSSAM_PASSWORD' },
  { username: 'ANS', env: 'USER_ANS_PASSWORD' },
] as const satisfies ReadonlyArray<{ username: AllowedUsername; env: string }>;

export function isAllowedUsername(value: string): value is AllowedUsername {
  return (ALLOWED_USERNAMES as readonly string[]).includes(value);
}
