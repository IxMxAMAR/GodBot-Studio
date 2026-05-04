/**
 * Progressive ReAct JSON-stream parser.
 *
 * The agent's response is a single JSON object shaped like:
 *
 *   { "thought": "...", "action": "tool", "args": {...} }
 *   { "thought": "...", "final_answer": "..." }
 *
 * While the LLM streams tokens, the buffer is incomplete — we still need to
 * extract whatever's parseable so far so the UI can render a "Thinking…"
 * state, then swap to streaming the final_answer the moment it appears.
 *
 * Strategy:
 *   1. Try a full JSON.parse — if it succeeds, return everything.
 *   2. Otherwise, regex-match `"thought":"<chars>` (capturing escaped chars
 *      correctly). If we're still streaming the thought, the match grows
 *      with each token.
 *   3. Match `"final_answer":"<chars>` the same way. ORDERING MATTERS: the
 *      `thought` regex stops at the next unescaped `"`, so a `final_answer`
 *      match implies `thought` has closed.
 *   4. `action` is only matched when its closing quote arrives — partial
 *      tool names should NOT be reported (would mis-route the UI).
 */

export interface ParsedTurn {
  thought: string;          // partial or complete
  finalAnswer: string;      // '' until final_answer field starts streaming
  action: string | null;    // null until the action string is fully closed
  args: object | null;      // null until the args object is fully parseable
  done: boolean;            // true after JSON closes successfully
  raw: string;
}

export function parseStreaming(raw: string): ParsedTurn {
  const result: ParsedTurn = {
    thought: '',
    finalAnswer: '',
    action: null,
    args: null,
    done: false,
    raw,
  };

  // Fast path: complete JSON.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      result.thought = typeof obj.thought === 'string' ? obj.thought : '';
      result.finalAnswer = typeof obj.final_answer === 'string' ? obj.final_answer : '';
      result.action = typeof obj.action === 'string' ? obj.action : null;
      result.args = obj.args && typeof obj.args === 'object' ? obj.args : null;
      result.done = true;
      return result;
    }
  } catch {
    // Fall through to partial parsing.
  }

  // Match `"thought":"<chars>` where <chars> is JSON-string-escaped: each
  // char is either an escape (`\.`) or a non-quote, non-backslash char.
  // The match continues UP TO BUT NOT INCLUDING the next unescaped `"`.
  const thoughtRe = /"thought"\s*:\s*"((?:\\.|[^"\\])*)/;
  const m1 = raw.match(thoughtRe);
  if (m1) {
    result.thought = unescapeJsonString(m1[1]);
  }

  // Same pattern for final_answer. Because `thought` stops at the closing
  // quote, this regex only matches once the thought field is fully closed
  // and we're in (or past) the final_answer field.
  const finalRe = /"final_answer"\s*:\s*"((?:\\.|[^"\\])*)/;
  const m2 = raw.match(finalRe);
  if (m2) {
    result.finalAnswer = unescapeJsonString(m2[1]);
  }

  // `action` value must be fully closed (trailing `"`) before we report it.
  // Partial action names would mis-route the UI.
  const actionRe = /"action"\s*:\s*"((?:\\.|[^"\\])*)"/;
  const m3 = raw.match(actionRe);
  if (m3) {
    result.action = unescapeJsonString(m3[1]);
  }

  return result;
}

/**
 * Apply the small set of JSON string escapes we expect to see in streamed
 * output. Order matters: `\\\\` must be replaced LAST so it doesn't double-process
 * a backslash that was part of a different escape.
 */
function unescapeJsonString(s: string): string {
  // Walk char-by-char to keep escape handling correct.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      switch (next) {
        case 'n': out += '\n'; i++; break;
        case 'r': out += '\r'; i++; break;
        case 't': out += '\t'; i++; break;
        case '"': out += '"'; i++; break;
        case '\\': out += '\\'; i++; break;
        case '/': out += '/'; i++; break;
        case 'b': out += '\b'; i++; break;
        case 'f': out += '\f'; i++; break;
        case 'u': {
          if (i + 5 < s.length) {
            const hex = s.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              i += 5;
              break;
            }
          }
          // Malformed \u — emit literally.
          out += c;
          break;
        }
        default:
          out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}
