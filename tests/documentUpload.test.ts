// Unit coverage for server/documentUpload.ts's looksDangerous() — the
// content-sniffing check shared by the documents/plans/cv/messaging upload
// routes (see the security audit's "téléversements sans validation de type"
// finding). Route-level wiring is covered by the relevant Supertest suites
// (e.g. tests/phase7Batch23.test.ts for /api/documents).
import { describe, expect, it } from 'vitest';
import { looksDangerous } from '../server/documentUpload';

describe('looksDangerous', () => {
  it('flags an HTML file regardless of what extension/Content-Type it was uploaded under', () => {
    expect(looksDangerous(Buffer.from('<!DOCTYPE html><html><body>hi</body></html>'))).toBe(true);
    expect(looksDangerous(Buffer.from('<html><head></head><body>hi</body></html>'))).toBe(true);
  });

  it('flags an inline <script> tag', () => {
    expect(looksDangerous(Buffer.from('<script>alert(document.cookie)</script>'))).toBe(true);
  });

  it('flags an SVG (can carry embedded script)', () => {
    expect(looksDangerous(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe(true);
  });

  it('flags a Windows PE/EXE by its MZ header', () => {
    const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(looksDangerous(buf)).toBe(true);
  });

  it('flags a shell script shebang', () => {
    expect(looksDangerous(Buffer.from('#!/bin/bash\nrm -rf /'))).toBe(true);
  });

  it('does not flag a real PDF', () => {
    expect(looksDangerous(Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj'))).toBe(false);
  });

  it('does not flag a real PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(looksDangerous(buf)).toBe(false);
  });

  it('does not flag an OOXML (docx/xlsx) ZIP container', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(looksDangerous(buf)).toBe(false);
  });

  it('does not flag plain text content', () => {
    expect(looksDangerous(Buffer.from('Compte-rendu de réunion du 12 mars.'))).toBe(false);
  });
});
