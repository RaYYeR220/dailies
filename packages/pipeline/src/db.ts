import SqliteDatabase from 'better-sqlite3';
import type { Database } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, repo_url TEXT NOT NULL, since TEXT NOT NULL, until TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, cost_usd REAL NOT NULL DEFAULT 0, loops INTEGER NOT NULL DEFAULT 0,
  budget TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stages (run_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, ended_at TEXT, error TEXT, PRIMARY KEY (run_id, name));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts TEXT NOT NULL, stage TEXT, message TEXT NOT NULL);
`;

export function openDb(path: string): Database {
  const db = new SqliteDatabase(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
