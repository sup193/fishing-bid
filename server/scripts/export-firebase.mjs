import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../../');
dotenv.config({ path: resolve(projectRoot, '.env') });

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function serviceAccountToken() {
  let account;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
      || resolve(projectRoot, 'server/firebase-service-account.json');
    if (!fs.existsSync(accountPath)) {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE for the one-time export.');
    }
    account = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('Firebase service-account JSON must contain client_email and private_key.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(`Firebase token request failed (${response.status}).`);
  return result.access_token;
}

const databaseUrl = process.env.FIREBASE_DATABASE_URL;
if (!databaseUrl) throw new Error('Set FIREBASE_DATABASE_URL for the one-time Firebase export.');
const outputArgument = process.argv.findIndex(argument => argument === '--out');
const outputValue = outputArgument >= 0 ? process.argv[outputArgument + 1] : null;
if (outputArgument >= 0 && !outputValue) throw new Error('--out requires a file path.');
const outputPath = outputValue ? resolve(outputValue) : resolve(projectRoot, 'server/data/firebase-export.json');
const force = process.argv.includes('--force');
if (fs.existsSync(outputPath) && !force) {
  throw new Error(`Export file already exists; choose another --out path or pass --force: ${outputPath}`);
}

const token = process.env.FIREBASE_DATABASE_TOKEN || await serviceAccountToken();
const endpoint = `${databaseUrl.replace(/\/+$/, '')}/.json?access_token=${encodeURIComponent(token)}`;
const response = await fetch(endpoint);
if (!response.ok) throw new Error(`Firebase export failed (${response.status}); check the database URL and export credentials.`);
const data = await response.json();
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  throw new Error('Firebase export returned an unexpected root value.');
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, { flag: force ? 'w' : 'wx' });
console.log(`Firebase export written to ${outputPath}`);
