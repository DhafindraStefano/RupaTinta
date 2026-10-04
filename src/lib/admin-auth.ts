import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const COOKIE = 'rt_admin';
const WEEK = 60 * 60 * 24 * 7;

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
};
const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(input: string) {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(sign(input), sign(expected));
}

export function startSession(cookies: AstroCookies) {
  const exp = String(Math.floor(Date.now() / 1000) + WEEK);
  cookies.set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, path: '/admin', maxAge: WEEK,
  });
}

export function endSession(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/admin' });
}

export function isAdmin(cookies: AstroCookies) {
  const [exp, sig] = (cookies.get(COOKIE)?.value ?? '').split('.');
  return !!exp && !!sig && safeEqual(sig, sign(exp)) && Number(exp) > Date.now() / 1000;
}
