import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, fuzzyRank } from '../src/api/fuzzy.ts';

test('empty query matches anything (score 0)', () => {
  assert.equal(fuzzyScore('', 'foo/bar.ts'), 0);
});

test('rejects when query chars not in candidate', () => {
  assert.equal(fuzzyScore('xyz', 'foo/bar.ts'), null);
});

test('rejects when query order is wrong', () => {
  // 'sf' wants s-then-f; "foo/src" has f-then-s, so a strict
  // subsequence match (s before f) would fail. But "src/foo.ts" has s
  // before f → matches.
  assert.equal(fuzzyScore('sf', 'src/foo.ts') !== null, true);
  assert.equal(fuzzyScore('sf', 'foo/src'), null);
});

test('case-insensitive', () => {
  assert.notEqual(fuzzyScore('CHAT', 'chatpanel.tsx'), null);
});

test('consecutive matches score higher than spread out', () => {
  const consecutive = fuzzyScore('chat', 'chat.tsx');
  const spread = fuzzyScore('chat', 'cxhxaxt.tsx');
  assert.ok(
    (consecutive ?? 0) > (spread ?? 0),
    `expected ${consecutive} > ${spread}`,
  );
});

test('earlier matches score higher than later', () => {
  const early = fuzzyScore('foo', 'foo/bar.ts');
  const late = fuzzyScore('foo', 'a/b/c/d/e/f/o/o/file.ts'); // late, single matches
  assert.ok((early ?? 0) > (late ?? 0));
});

test('fuzzyRank returns top hits in descending score', () => {
  const candidates = [
    { rel: 'src/components/ChatPanel.tsx' },
    { rel: 'tests/parse-stream.test.ts' },
    { rel: 'src/api/fuzzy.ts' },
    { rel: 'README.md' },
  ];
  const out = fuzzyRank('chat', candidates, (c) => c.rel);
  assert.equal(out.length, 1);
  assert.equal(out[0].rel, 'src/components/ChatPanel.tsx');
});

test('fuzzyRank caps at limit', () => {
  const candidates = Array.from({ length: 200 }, (_, i) => ({ rel: `f${i}.ts` }));
  const out = fuzzyRank('f', candidates, (c) => c.rel, 50);
  assert.equal(out.length, 50);
});

test('fuzzyRank drops non-matches', () => {
  const candidates = [{ rel: 'foo.ts' }, { rel: 'bar.ts' }];
  const out = fuzzyRank('xyz', candidates, (c) => c.rel);
  assert.equal(out.length, 0);
});
