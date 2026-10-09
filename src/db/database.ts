import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type SqliteDatabase = InstanceType<typeof Database>;

export function openDatabase(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('new','contacted','qualified','proposal','won','lost')),
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, owner_id)
    );
    CREATE INDEX IF NOT EXISTS leads_owner_status_created ON leads(owner_id, status, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS leads_owner_name ON leads(owner_id, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS leads_owner_company ON leads(owner_id, company COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS leads_owner_email ON leads(owner_id, email COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lead_id, owner_id) REFERENCES leads(id, owner_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS notes_owner_lead_created ON notes(owner_id, lead_id, created_at DESC, id);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT NOT NULL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      title TEXT NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id, owner_id) REFERENCES leads(id, owner_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS tasks_owner_due ON tasks(owner_id, status, due_at, id);
    CREATE INDEX IF NOT EXISTS tasks_owner_lead_status_due ON tasks(owner_id, lead_id, status, due_at);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT NOT NULL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('lead','note','task')),
      entity_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      changes_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_owner_time ON audit_events(owner_id, timestamp DESC, id);
  `);
  return db;
}