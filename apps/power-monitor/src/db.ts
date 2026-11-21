import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { SchedulePayload, UserRecord } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, "bot.db");
const db = new Database(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  
  CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    group_name TEXT,
    notifications_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schedule_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    raw_html TEXT,
    image_url TEXT,
    mobile_image_url TEXT,
    tomorrow_raw_html TEXT,
    tomorrow_image_url TEXT,
    tomorrow_mobile_image_url TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO schedule_cache (id, raw_html, image_url, mobile_image_url) 
  VALUES (1, '', '', '');
`);

export function setUserGroup(chatId: number, groupName: string) {
  const stmt = db.prepare(`
    INSERT INTO users (chat_id, group_name, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chat_id) DO UPDATE SET
      group_name = excluded.group_name,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(chatId, groupName);
}

export function getUser(chatId: number): UserRecord | null {
  const stmt = db.prepare(`SELECT * FROM users WHERE chat_id = ?`);
  return (stmt.get(chatId) as UserRecord) || null;
}

export function setNotifications(chatId: number, enabled: boolean) {
  const stmt = db.prepare(`
    UPDATE users SET notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE chat_id = ?
  `);
  stmt.run(enabled ? 1 : 0, chatId);
}

export function getAllUsersWithGroup(): UserRecord[] {
  const stmt = db.prepare(
    `SELECT * FROM users WHERE group_name IS NOT NULL AND notifications_enabled = 1`
  );
  return stmt.all() as UserRecord[];
}

export function getScheduleCache(): SchedulePayload & { updated_at?: string } {
  const stmt = db.prepare(`SELECT * FROM schedule_cache WHERE id = 1`);
  const row = stmt.get() as any;
  if (!row) return {};
  return {
    rawHtml: row.raw_html || "",
    imageUrl: row.image_url || "",
    mobileImageUrl: row.mobile_image_url || "",
    tomorrowRawHtml: row.tomorrow_raw_html || "",
    tomorrowImageUrl: row.tomorrow_image_url || "",
    tomorrowMobileImageUrl: row.tomorrow_mobile_image_url || "",
    updated_at: row.updated_at,
  };
}

export function updateScheduleCache(data: SchedulePayload) {
  const stmt = db.prepare(`
    UPDATE schedule_cache SET
      raw_html = ?,
      image_url = ?,
      mobile_image_url = ?,
      tomorrow_raw_html = ?,
      tomorrow_image_url = ?,
      tomorrow_mobile_image_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `);
  stmt.run(
    data.rawHtml || "",
    data.imageUrl || "",
    data.mobileImageUrl || "",
    data.tomorrowRawHtml || "",
    data.tomorrowImageUrl || "",
    data.tomorrowMobileImageUrl || ""
  );
}
