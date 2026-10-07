import { describe, expect, it } from 'vitest';
import { createOriginMatcher } from './cors-origin.js';

const matches = createOriginMatcher('https://handoff.example,https://*.handoff.example,http://localhost:5173');
describe('tenant browser origins', () => {
  it.each(['https://handoff.example', 'https://acme.handoff.example', 'http://localhost:5173', undefined])('accepts configured origin %s', origin => {
    expect(matches(origin)).toBe(true);
  });
  it.each(['https://handoff.example.evil.test', 'https://evil-handoff.example', 'https://a.b.handoff.example', 'http://acme.handoff.example', 'https://acme.handoff.example:444', 'https://acme.handoff.example/path', 'https://user@acme.handoff.example', 'null'])('rejects untrusted origin %s', origin => {
    expect(matches(origin)).toBe(false);
  });
  it.each(['*', 'https://*.example/path', 'https://*.*.example', 'file:///tmp/test'])('rejects invalid configuration %s', rule => {
    expect(() => createOriginMatcher(rule)).toThrow();
  });
});
