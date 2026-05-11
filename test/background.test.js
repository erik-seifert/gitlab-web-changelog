'use strict';

// Pure functions copied from background.js for isolated testing.

const sanitizeId = (s) => s.replace(/[^a-zA-Z0-9]/g, '_');

const buildMatchPattern = (baseUrl) => {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/*`;
  } catch (e) {
    return null;
  }
};

// ---------- sanitizeId ----------

describe('sanitizeId', () => {
  test('replaces slashes and colons', () => {
    expect(sanitizeId('https://gitlab.example.com')).toBe('https___gitlab_example_com');
  });

  test('replaces dots', () => {
    expect(sanitizeId('gitlab.com')).toBe('gitlab_com');
  });

  test('leaves alphanumerics untouched', () => {
    expect(sanitizeId('abc123')).toBe('abc123');
  });

  test('handles empty string', () => {
    expect(sanitizeId('')).toBe('');
  });
});

// ---------- buildMatchPattern ----------

describe('buildMatchPattern', () => {
  test('builds pattern for https origin', () => {
    expect(buildMatchPattern('https://gitlab.example.com')).toBe('https://gitlab.example.com/*');
  });

  test('builds pattern for http origin with port', () => {
    expect(buildMatchPattern('http://gitlab.local:8080')).toBe('http://gitlab.local:8080/*');
  });

  test('strips path from URL', () => {
    expect(buildMatchPattern('https://gitlab.example.com/group/project')).toBe('https://gitlab.example.com/*');
  });

  test('returns null for invalid URL', () => {
    expect(buildMatchPattern('not-a-url')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(buildMatchPattern('')).toBeNull();
  });
});
