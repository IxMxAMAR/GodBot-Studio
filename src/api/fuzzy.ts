/**
 * Tiny Sublime-style subsequence fuzzy scorer.
 *
 * - Every character of `query` (lowercased) must appear in `candidate`
 *   in order. Otherwise the score is `null` (no match).
 * - Within matching candidates, packed runs score higher than spread-out
 *   ones. We start from a base of `query.length` and add a bonus for
 *   each consecutive match. Subtract the gap between the first match
 *   and start so files where the query is near the start rank above
 *   files where it appears late.
 *
 * Scores are integers; bigger is better. Returns `null` for non-matches.
 *
 * The implementation is deliberately minimal — no skim/fzf-grade ranking
 * — because the @-mention popup only ever displays the top 50 hits, and
 * the workspace walk is already capped at 5000 files. Even a naive O(n·m)
 * pass per candidate is invisibly fast at that scale.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let qi = 0;
  let firstMatch = -1;
  let consecutive = 0;
  let bonus = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      if (firstMatch < 0) firstMatch = ci;
      consecutive++;
      // Bigger reward as the run grows: 1, 2, 3, ...
      bonus += consecutive;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return null;  // not all chars matched in order
  // Penalise late starts so prefix-ish matches rank higher.
  const startPenalty = Math.min(firstMatch, 20);
  return q.length + bonus - startPenalty;
}

/**
 * Rank `candidates` by fuzzy score against `query`, dropping non-matches.
 * Stable for ties (uses the original index order).
 */
export function fuzzyRank<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string,
  limit = 50,
): T[] {
  if (!candidates.length) return [];
  const scored: { item: T; score: number; idx: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const s = fuzzyScore(query, getText(candidates[i]));
    if (s !== null) scored.push({ item: candidates[i], score: s, idx: i });
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, limit).map((s) => s.item);
}
