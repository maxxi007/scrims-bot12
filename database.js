const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
    this.initialize();
  }

  initialize() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new sqlite3.Database(path.join(dataDir, 'scrims.sqlite'), (err) => {
      if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
      }
      console.log('Connected to SQLite database');
      this.createTables();
    });
  }

  createTables() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS teams (
          team_name TEXT PRIMARY KEY,
          team_tag TEXT NOT NULL,
          captain_id TEXT NOT NULL,
          captain_name TEXT,
          player2_id TEXT NOT NULL,
          player2_name TEXT,
          player3_id TEXT NOT NULL,
          player3_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS scrims (
          scrim_name TEXT PRIMARY KEY,
          days TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          mention_role_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS daily_registration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scrim_name TEXT NOT NULL,
          scrim_date TEXT NOT NULL,
          team_name TEXT NOT NULL,
          checked_in_by TEXT NOT NULL,
          checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          lobby_number INTEGER,
          check_in_order INTEGER,
          UNIQUE(scrim_name, scrim_date, team_name)
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS lobby_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scrim_name TEXT NOT NULL,
          scrim_date TEXT NOT NULL,
          user_id TEXT NOT NULL,
          lobby_number INTEGER NOT NULL,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(scrim_name, scrim_date, user_id)
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS captcha_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          scrim_name TEXT NOT NULL,
          scrim_date TEXT NOT NULL,
          captcha_word TEXT NOT NULL,
          verified INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, scrim_name, scrim_date)
        )
      `);

      console.log('Database tables initialized');
    });
  }

  get(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  run(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = new Database();
