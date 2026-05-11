'use strict';

// Pure functions copied from content.js for isolated testing.
// If you change the originals, keep these in sync.

const extractIssueRefs = (message) => {
  const refs = new Set();
  const issueRegex = /(?:^|[^&\w])#(\d+)/g;
  let m;
  while ((m = issueRegex.exec(message)) !== null) {
    refs.add(parseInt(m[1], 10));
  }
  return Array.from(refs);
};

const extractMrRefs = (message) => {
  const refs = new Set();
  const mrRegex = /(?:^|[^&\w])!(\d+)/g;
  let m;
  while ((m = mrRegex.exec(message)) !== null) {
    refs.add(parseInt(m[1], 10));
  }
  return Array.from(refs);
};

const extractIssueFromBranch = (branchName, regex) => {
  if (!branchName || !regex) return null;
  const m = branchName.match(regex);
  return m && m[1] ? parseInt(m[1], 10) : null;
};

// ---------- extractIssueRefs ----------

describe('extractIssueRefs', () => {
  test('picks up a single bare reference', () => {
    expect(extractIssueRefs('Fixes #123')).toEqual([123]);
  });

  test('picks up multiple references in one message', () => {
    const result = extractIssueRefs('Closes #42 and see also #99');
    expect(result).toEqual(expect.arrayContaining([42, 99]));
    expect(result).toHaveLength(2);
  });

  test('deduplicates the same issue mentioned twice', () => {
    expect(extractIssueRefs('#7 and again #7')).toEqual([7]);
  });

  test('ignores HTML entity refs like &#123;', () => {
    expect(extractIssueRefs('entity &#123; here')).toEqual([]);
  });

  test('ignores word-embedded hashes like issue#5', () => {
    expect(extractIssueRefs('issue#5 is bad')).toEqual([]);
  });

  test('returns empty array when no refs present', () => {
    expect(extractIssueRefs('just a normal commit message')).toEqual([]);
  });

  test('handles reference at start of string', () => {
    expect(extractIssueRefs('#1 initial commit')).toEqual([1]);
  });

  test('handles newline-separated refs in full commit body', () => {
    const msg = 'Big fix\n\nCloses #10\nRelated: #20';
    const result = extractIssueRefs(msg);
    expect(result).toEqual(expect.arrayContaining([10, 20]));
  });
});

// ---------- extractMrRefs ----------

describe('extractMrRefs', () => {
  test('picks up a single MR reference', () => {
    expect(extractMrRefs('See !456')).toEqual([456]);
  });

  test('does not pick up issue refs', () => {
    expect(extractMrRefs('Fixes #123')).toEqual([]);
  });

  test('ignores word-embedded bangs like mr!5', () => {
    expect(extractMrRefs('mr!5 is wrong')).toEqual([]);
  });

  test('returns empty array when no MR refs present', () => {
    expect(extractMrRefs('no refs here')).toEqual([]);
  });
});

// ---------- extractIssueFromBranch ----------

describe('extractIssueFromBranch', () => {
  const simpleRegex   = /^(\d+)[-_]/;          // 757-fix-graphql-field
  const prefixedRegex = /(?:^|\/)(\d+)[-_]/;   // feature/757-fix-graphql-field

  test('extracts from plain branch name (simple regex)', () => {
    expect(extractIssueFromBranch('757-fix-graphql-field', simpleRegex)).toBe(757);
  });

  test('extracts from prefixed branch name (prefix regex)', () => {
    expect(extractIssueFromBranch('feature/757-fix-graphql-field', prefixedRegex)).toBe(757);
  });

  test('prefixed regex also works on plain branch names', () => {
    expect(extractIssueFromBranch('757-fix-graphql-field', prefixedRegex)).toBe(757);
  });

  test('simple regex returns null for prefixed branch', () => {
    expect(extractIssueFromBranch('feature/757-fix-graphql-field', simpleRegex)).toBeNull();
  });

  test('returns null when branch has no leading number', () => {
    expect(extractIssueFromBranch('main', simpleRegex)).toBeNull();
    expect(extractIssueFromBranch('fix-something', simpleRegex)).toBeNull();
  });

  test('requires a separator after the number', () => {
    // bare number without dash/underscore should not match
    expect(extractIssueFromBranch('757', simpleRegex)).toBeNull();
  });

  test('returns null for null branch name', () => {
    expect(extractIssueFromBranch(null, simpleRegex)).toBeNull();
  });

  test('returns null when regex is null (fallback disabled)', () => {
    expect(extractIssueFromBranch('757-fix', null)).toBeNull();
  });

  test('works with underscore separator', () => {
    expect(extractIssueFromBranch('42_add-dark-mode', simpleRegex)).toBe(42);
  });

  test('deep nested prefix path', () => {
    expect(extractIssueFromBranch('team/feature/99-refactor', prefixedRegex)).toBe(99);
  });
});
