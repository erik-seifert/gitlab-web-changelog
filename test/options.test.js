'use strict';

// Pure functions copied from options.js for isolated testing.

const normalizeUrl = (raw) => {
  if (!raw) return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    return null;
  }
};

// ---------- normalizeUrl ----------

describe('normalizeUrl', () => {
  test('returns null for empty string', () => {
    expect(normalizeUrl('')).toBeNull();
  });

  test('returns null for whitespace-only string', () => {
    expect(normalizeUrl('   ')).toBeNull();
  });

  test('returns null for null', () => {
    expect(normalizeUrl(null)).toBeNull();
  });

  test('prepends https when scheme is missing', () => {
    expect(normalizeUrl('gitlab.example.com')).toBe('https://gitlab.example.com');
  });

  test('strips path from full URL', () => {
    expect(normalizeUrl('https://gitlab.example.com/group/project/-/tags')).toBe('https://gitlab.example.com');
  });

  test('strips trailing slash', () => {
    expect(normalizeUrl('https://gitlab.example.com/')).toBe('https://gitlab.example.com');
  });

  test('preserves http scheme', () => {
    expect(normalizeUrl('http://gitlab.local')).toBe('http://gitlab.local');
  });

  test('preserves port number', () => {
    expect(normalizeUrl('https://gitlab.local:8929')).toBe('https://gitlab.local:8929');
  });

  test('trims leading and trailing whitespace', () => {
    expect(normalizeUrl('  https://gitlab.example.com  ')).toBe('https://gitlab.example.com');
  });

  test('is case-insensitive for scheme check', () => {
    expect(normalizeUrl('HTTPS://gitlab.example.com')).toBe('https://gitlab.example.com');
  });
});
