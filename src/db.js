import Database from 'better-sqlite3';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = `${__dirname}/../data/llm-tester.db`;

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'auto',
    detected_protocol TEXT,
    force_protocol TEXT,
    models_protocol TEXT,
    custom_endpoint TEXT,
    capabilities TEXT,
    force_api_type TEXT,
    status TEXT DEFAULT 'untested',
    latency_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS model_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    status TEXT DEFAULT 'untested',
    latency_ms INTEGER,
    error_message TEXT,
    tested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, model_name)
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL,
    model_name TEXT,
    request_url TEXT NOT NULL,
    request_body TEXT,
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_model_tests_channel ON model_tests(channel_id);
  CREATE INDEX IF NOT EXISTS idx_request_logs_channel ON request_logs(channel_id);
  CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
`);

// Migration: add columns if missing
try {
  db.exec(`ALTER TABLE channels ADD COLUMN force_protocol TEXT`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE channels ADD COLUMN force_api_type TEXT`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE channels ADD COLUMN models_protocol TEXT`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE channels ADD COLUMN custom_endpoint TEXT`);
} catch (e) {
  // Column already exists
}

const ENCRYPTION_KEY = createHash('sha256').update(process.env.LLM_TESTER_SECRET || 'llm-tester-local-key').digest();

export function encryptApiKey(apiKey) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptApiKey(encrypted) {
  const [ivHex, encryptedData] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export default db;
