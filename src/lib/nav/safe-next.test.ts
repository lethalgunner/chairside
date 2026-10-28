import { describe, expect, it } from 'vitest';
import { isSignedOutResult, loginHref, NEXT_MAX_LENGTH, safeNext } from './safe-next';

describe('safeNext: where sign-in may send you (T29, CTO open-redirect rule)', () => {
  it.each([
    '/',
    '/patients',
    '/patients/abc?x=1',
    '/bills/new?patient=0b6c1a2e-1111-4222-8333-444455556666',
    '/patients?q=a%20b',
    '/patients?q=a%2Fb',
    '/day-close#cash',
  ])('accepts the same-origin path %s', (v) => {
    expect(safeNext(v)).toBe(v);
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/patients'],
    ['slash-backslash', '/\\evil'],
    ['backslash-slash', '\\/evil.com'],
    ['backslash later in the path', '/patients\\..\\x'],
    ['http scheme', 'http://evil.com'],
    ['https scheme', 'https://evil.com/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['upper-case scheme', 'JavaScript:alert(1)'],
    ['data scheme', 'data:text/html,hi'],
    ['no leading slash', 'patients'],
    ['encoded double slash', '%2F%2Fevil.com'],
    ['encoded second slash', '/%2Fevil.com'],
    ['encoded backslash', '/%5Cevil'],
    ['lower-case encoded backslash', '/%5cevil'],
    ['double-encoded slash', '/%252Fevil.com'],
    ['double-encoded backslash', '/%255Cevil'],
    ['malformed escape', '/patients?q=%E0%A4%A'],
    ['tab between slashes', '/\t/evil.com'],
    ['newline', '/patients\nSet-Cookie: x'],
    ['carriage return', '/\r/evil.com'],
    ['NUL', '/patients\u0000'],
    ['DEL', '/patients\u007f'],
    ['encoded tab', '/%09/evil.com'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => {
    expect(safeNext(v)).toBe('/');
  });

  it('rejects anything longer than 512 characters', () => {
    const ok = `/${'a'.repeat(NEXT_MAX_LENGTH - 1)}`;
    expect(safeNext(ok)).toBe(ok);
    expect(safeNext(`${ok}a`)).toBe('/');
  });

  it('rejects values that are not one string (missing, repeated params)', () => {
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext(null)).toBe('/');
    expect(safeNext(['/patients', '//evil.com'])).toBe('/');
    expect(safeNext(42)).toBe('/');
  });
});

describe('loginHref', () => {
  it('carries the page and the reason', () => {
    expect(loginHref('/bills/new?patient=abc', true)).toBe('/login?next=%2Fbills%2Fnew%3Fpatient%3Dabc&reason=expired');
  });

  it('says nothing about being signed out to someone who never signed in', () => {
    expect(loginHref('/patients', false)).toBe('/login?next=%2Fpatients');
  });

  it('drops a home or unsafe next', () => {
    expect(loginHref('/', false)).toBe('/login');
    expect(loginHref('//evil.com', true)).toBe('/login?reason=expired');
    expect(loginHref(null, false)).toBe('/login');
  });
});

describe('isSignedOutResult', () => {
  it('recognises only the signed-out marker', () => {
    expect(isSignedOutResult({ ok: false, error: 'x', signedOut: true })).toBe(true);
    expect(isSignedOutResult({ ok: false, error: 'x' })).toBe(false);
    expect(isSignedOutResult({ signedOut: 'true' })).toBe(false);
    expect(isSignedOutResult(null)).toBe(false);
    expect(isSignedOutResult(undefined)).toBe(false);
  });
});
