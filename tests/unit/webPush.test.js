// E29: szyfrowanie Web Push (RFC 8291) i podpis VAPID (RFC 8292) w module
// funkcji push-send. Wektor z RFC 8291 (Appendix A) + odszyfrowanie tak, jak
// robi to przeglądarka, + weryfikacja podpisu JWT kluczem publicznym.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  encryptPayload, vapidAuthorization, buildPushRequest, b64urlDecode, b64urlEncode,
} from '../../supabase/functions/_shared/web-push.js';

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// Odszyfrowanie po stronie urządzenia (node:crypto, niezależnie od modułu).
function decrypt(body, uaPrivate, uaPublic, auth) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'ostatni rekord kończy się bajtem 0x02');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

function newDevice() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { priv: ecdh.getPrivateKey(), pub: ecdh.getPublicKey(), auth: crypto.randomBytes(16) };
}

test('RFC 8291 Appendix A: identyczny wynik dla danych z RFC', async () => {
  const out = await encryptPayload(RFC.plaintext, RFC.uaPublic, RFC.auth, {
    serverKeys: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate }, salt: RFC.salt,
  });
  assert.equal(b64urlEncode(out), RFC.body);
  assert.equal(decrypt(Buffer.from(out), b64urlDecode(RFC.uaPrivate), Buffer.from(b64urlDecode(RFC.uaPublic)), Buffer.from(b64urlDecode(RFC.auth))), RFC.plaintext);
});

test('losowe klucze i sól: urządzenie odszyfrowuje treść (także polskie znaki)', async () => {
  const dev = newDevice();
  const payload = JSON.stringify({ title: 'Zbieranie pytań zakończone', body: 'Nowe pytania: 85 · gry: 4 · PL — żółć' });
  const a = await encryptPayload(payload, b64urlEncode(dev.pub), b64urlEncode(dev.auth));
  const b = await encryptPayload(payload, b64urlEncode(dev.pub), b64urlEncode(dev.auth));
  assert.notEqual(b64urlEncode(a), b64urlEncode(b), 'każde szyfrowanie inne');
  assert.equal(decrypt(Buffer.from(a), dev.priv, dev.pub, dev.auth), payload);
});

test('złe klucze urządzenia i za długa treść są odrzucane', async () => {
  const dev = newDevice();
  await assert.rejects(encryptPayload('x', 'AAAA', b64urlEncode(dev.auth)), /invalid_p256dh/);
  await assert.rejects(encryptPayload('x', b64urlEncode(dev.pub), 'AAAA'), /invalid_auth/);
  await assert.rejects(encryptPayload('x'.repeat(4080), b64urlEncode(dev.pub), b64urlEncode(dev.auth)), /payload_too_large/);
});

test('VAPID: JWT ES256 z aud = origin usługi, podpis zgodny z kluczem publicznym', async () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const vapid = { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(ecdh.getPrivateKey()), subject: 'mailto:kontakt@familijna.app' };
  const now = 1_800_000_000;
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now);
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, header);
  assert.equal(m[4], vapid.publicKey);
  const claims = JSON.parse(Buffer.from(b64urlDecode(m[2])).toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now + 43200, sub: 'mailto:kontakt@familijna.app' });
  assert.deepEqual(JSON.parse(Buffer.from(b64urlDecode(m[1])).toString()), { typ: 'JWT', alg: 'ES256' });
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vapid.publicKey && b64urlEncode(ecdh.getPublicKey().subarray(1, 33)), y: b64urlEncode(ecdh.getPublicKey().subarray(33)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlDecode(m[3])));
  assert.ok(ok, 'podpis VAPID poprawny');
});

test('żądanie push: nagłówki usługi i temat oczyszczony do 32 znaków', async () => {
  const dev = newDevice();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const vapid = { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(ecdh.getPrivateKey()), subject: 'mailto:kontakt@familijna.app' };
  const sub = { endpoint: 'https://web.push.apple.com/QXyz', p256dh: b64urlEncode(dev.pub), auth: b64urlEncode(dev.auth) };
  const req = await buildPushRequest(sub, { title: 'T' }, vapid, { ttl: 3600, urgency: 'high', topic: 'job_error:questions/very-long-topic-name-over-32' });
  assert.equal(req.url, sub.endpoint);
  assert.equal(req.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(req.init.headers.TTL, '3600');
  assert.equal(req.init.headers.Urgency, 'high');
  assert.match(req.init.headers.Topic, /^[A-Za-z0-9_-]{1,32}$/);
  assert.match(req.init.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(decrypt(Buffer.from(req.init.body), dev.priv, dev.pub, dev.auth), '{"title":"T"}');
});
