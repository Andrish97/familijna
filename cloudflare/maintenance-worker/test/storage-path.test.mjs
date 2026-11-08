import test from 'node:test';
import assert from 'node:assert/strict';
import { safeStorageName, isSafeAttachmentPath, uploadToStorage } from '../src/lib/core/storage.js';

// E24 (2026-11): nazwa załącznika z obcego maila nie może wyjść poza message-attachments.
test('safeStorageName zostawia jeden bezpieczny człon', () => {
  for (const evil of ['/../../user-logos/u/x.svg', '..', '../..', 'a/../../b', '..\\..\\x', '%2e%2e/x', 'x?y#z']) {
    const n = safeStorageName(evil);
    assert.match(n, /^[\w.\-]+$/);
    assert.ok(!n.startsWith('.'));
    assert.ok(isSafeAttachmentPath(`message-attachments/inbound_1_${n}`));
  }
  assert.equal(safeStorageName('zdjęcie 1.png'), 'zdj_cie_1.png');
  assert.equal(safeStorageName(''), 'file');
});

test('isSafeAttachmentPath odrzuca inne buckety i człony kropkowe', () => {
  assert.ok(isSafeAttachmentPath('message-attachments/form_1_a.pdf'));
  for (const p of ['user-logos/x.svg', 'message-attachments/../user-logos/x', 'message-attachments/a/b',
    'message-attachments/..', 'message-attachments/inbound_1_/../../user-logos/x', 'message-attachments/a?b']) {
    assert.equal(isSafeAttachmentPath(p), false, p);
  }
});

test('uploadToStorage nie wysyła żądania dla złej ścieżki', async () => {
  const orig = globalThis.fetch; let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };
  try {
    await assert.rejects(uploadToStorage({}, 'message-attachments/inbound_1_/../../user-logos/u/x.svg', 'eA==', 'image/svg+xml'), /bad_path/);
    assert.equal(called, false);
  } finally { globalThis.fetch = orig; }
});
