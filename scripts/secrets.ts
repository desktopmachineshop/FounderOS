/**
 * Passphrase encryption for .env.local, so it can travel through Google Drive
 * alongside the database snapshots without sitting there in plaintext.
 *
 *   tsx scripts/secrets.ts encrypt <plain-in> <encrypted-out>
 *   tsx scripts/secrets.ts decrypt <encrypted-in> <plain-out>
 *   tsx scripts/secrets.ts verify  <encrypted-in>
 *
 * The passphrase is read from stdin as base64 (see readPassphrase), never argv —
 * command lines are visible to every process on the machine. backup.ps1 /
 * restore.ps1 prompt for it and pipe it in.
 *
 * Node's built-in crypto only, so there is nothing to install on a new PC:
 * scrypt derives the key (deliberately slow, to make guessing expensive if the
 * file ever leaks from Drive), and AES-256-GCM authenticates as well as
 * encrypts, so a wrong passphrase fails loudly instead of producing garbage.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

type Envelope = {
  format: 'founderos-secrets';
  version: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

// OWASP's recommended scrypt cost. Needs ~128 MB, above Node's 32 MB default.
const KDF = { N: 2 ** 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;

function deriveKey(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { ...params, maxmem: MAXMEM });
}

// The passphrase arrives base64-encoded (of its UTF-8 bytes). Windows
// PowerShell re-encodes anything piped to a native program using whatever
// $OutputEncoding the session happens to have — prepending a BOM under UTF-8,
// turning non-ASCII into '?' under ASCII — so a raw passphrase would differ
// between terminals and a backup could become unopenable on the next PC.
// Base64 is plain ASCII, which every one of those encodings leaves alone.
function readPassphrase(): string {
  const raw = fs.readFileSync(0, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) fail('No passphrase on stdin.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail('Expected the passphrase base64-encoded on stdin.');
  const passphrase = Buffer.from(raw, 'base64').toString('utf8');
  if (!passphrase) fail('Empty passphrase.');
  return passphrase;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

// Write-then-rename, so an interrupted run never leaves a half-written file
// where a good one used to be.
function writeAtomic(target: string, contents: string): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function encrypt(plain: Buffer, passphrase: string): Envelope {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, KDF), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    format: 'founderos-secrets',
    version: 1,
    kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(envelope: Envelope, passphrase: string): Buffer {
  if (envelope.format !== 'founderos-secrets' || envelope.version !== 1) {
    fail('Not a FounderOS secrets file, or written by a newer version of this script.');
  }
  const { N, r, p, salt } = envelope.kdf;
  const key = deriveKey(passphrase, Buffer.from(salt, 'base64'), { N, r, p });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  } catch {
    // GCM can't distinguish these two, and neither should the message.
    fail('Wrong passphrase, or the encrypted file is damaged.', 2);
  }
}

function readEnvelope(file: string): Envelope {
  if (!fs.existsSync(file)) fail(`Not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Envelope;
  } catch {
    fail(`Not a readable secrets file: ${file}`);
  }
}

const [action, input, output] = process.argv.slice(2);

switch (action) {
  case 'encrypt': {
    if (!input || !output) fail('usage: secrets.ts encrypt <plain-in> <encrypted-out>');
    if (!fs.existsSync(input)) fail(`Not found: ${input}`);
    const envelope = encrypt(fs.readFileSync(input), readPassphrase());
    writeAtomic(output, JSON.stringify(envelope, null, 2) + '\n');
    console.log(`Encrypted ${input} -> ${output}`);
    break;
  }
  case 'decrypt': {
    if (!input || !output) fail('usage: secrets.ts decrypt <encrypted-in> <plain-out>');
    const plain = decrypt(readEnvelope(input), readPassphrase());
    writeAtomic(output, plain.toString('utf8'));
    console.log(`Decrypted ${input} -> ${output}`);
    break;
  }
  case 'verify': {
    if (!input) fail('usage: secrets.ts verify <encrypted-in>');
    decrypt(readEnvelope(input), readPassphrase());
    console.log('Passphrase matches.');
    break;
  }
  default:
    fail('usage: secrets.ts <encrypt|decrypt|verify> ...');
}
