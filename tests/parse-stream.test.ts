import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStreaming } from '../src/api/react-stream.ts';

test('empty string', () => {
  const r = parseStreaming('');
  assert.equal(r.thought, '');
  assert.equal(r.finalAnswer, '');
  assert.equal(r.action, null);
  assert.equal(r.args, null);
  assert.equal(r.done, false);
});

test('partial thought (still streaming first field)', () => {
  const r = parseStreaming('{"thought": "let me look at the');
  assert.equal(r.thought, 'let me look at the');
  assert.equal(r.finalAnswer, '');
  assert.equal(r.done, false);
});

test('thought with escaped chars', () => {
  const r = parseStreaming('{"thought": "line1\\nline2\\"quoted');
  assert.equal(r.thought, 'line1\nline2"quoted');
});

test('empty thought', () => {
  const r = parseStreaming('{"thought": "","final_answer":"hi"');
  assert.equal(r.thought, '');
  assert.equal(r.finalAnswer, 'hi');
});

test('thought containing the literal substring "final_answer" does not leak into finalAnswer', () => {
  // The regex MUST require thought's closing quote before matching final_answer.
  // Here the thought is still open and contains the word final_answer; finalAnswer should stay ''.
  const r = parseStreaming('{"thought": "I should call final_answer next');
  assert.equal(r.thought, 'I should call final_answer next');
  assert.equal(r.finalAnswer, '');
});

test('complete thought, partial final_answer', () => {
  const r = parseStreaming('{"thought":"hi","final_answer":"the answer is');
  assert.equal(r.thought, 'hi');
  assert.equal(r.finalAnswer, 'the answer is');
  assert.equal(r.done, false);
});

test('complete final_answer (full JSON parses)', () => {
  const r = parseStreaming('{"thought":"x","final_answer":"42"}');
  assert.equal(r.thought, 'x');
  assert.equal(r.finalAnswer, '42');
  assert.equal(r.done, true);
});

test('complete action with args', () => {
  const r = parseStreaming('{"thought":"read","action":"read_file","args":{"path":"x"}}');
  assert.equal(r.thought, 'read');
  assert.equal(r.action, 'read_file');
  assert.deepEqual(r.args, { path: 'x' });
  assert.equal(r.done, true);
});

test('partial action (closing quote not yet received) does not report', () => {
  const r = parseStreaming('{"thought":"go","action":"read_fil');
  assert.equal(r.action, null);
});

test('action with closing quote, args still streaming', () => {
  const r = parseStreaming('{"thought":"go","action":"read_file","args":{"pa');
  assert.equal(r.action, 'read_file');
  assert.equal(r.args, null);  // partial JSON — only set on full parse
});

test('malformed top-level JSON returns empty fields, not done', () => {
  const r = parseStreaming('this is not json');
  assert.equal(r.thought, '');
  assert.equal(r.finalAnswer, '');
  assert.equal(r.action, null);
  assert.equal(r.done, false);
});

test('handles \\u-escaped chars', () => {
  const r = parseStreaming('{"thought":"caf\\u00e9 time');
  assert.equal(r.thought, 'café time');
});

test('raw is preserved verbatim', () => {
  const raw = '{"thought":"x","final_answer":"y"}';
  const r = parseStreaming(raw);
  assert.equal(r.raw, raw);
});

test('multi-line thought via real newlines after escape', () => {
  const r = parseStreaming('{"thought":"line1\\nline2"}');
  assert.equal(r.thought, 'line1\nline2');
  assert.equal(r.done, true);
});
