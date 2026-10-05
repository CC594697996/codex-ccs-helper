#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

const SQL_QUERY = `
  SELECT name, settings_config, meta, is_current
  FROM providers
  WHERE app_type = 'codex'
  ORDER BY is_current DESC, sort_index ASC, name ASC
`;

const COMMON_CONFIG_KEY = 'common_config_codex';

/**
 * Open the CC-Switch SQLite database in read-only mode (loaded into memory).
 * @returns {Promise<import('sql.js').Database>}
 */
async function openDb(dbPath = DB_PATH) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `CC-Switch database not found: ${dbPath}\n` +
      'Please install CC-Switch and configure at least one provider first.'
    );
  }
  // sql.js reads a file snapshot, not SQLite's live WAL. Refuse a stale view.
  if (fs.existsSync(`${dbPath}-wal`) && fs.statSync(`${dbPath}-wal`).size > 0) {
    throw new Error('CC-Switch has pending database WAL changes. Close CC-Switch cleanly, then retry.');
  }
  const buffer = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  return new SQL.Database(buffer);
}

/** Read legacy common Codex TOML text. Only explicit opt-in providers use it. */
async function getCommonConfig(dbPath = DB_PATH) {
  const db = await openDb(dbPath);
  try {
    const results = db.exec(
      `SELECT value FROM settings WHERE key = '${COMMON_CONFIG_KEY}'`
    );
    if (!results.length || !results[0].values.length) return '';
    return results[0].values[0][0];
  } finally {
    db.close();
  }
}

/**
 * Read all Codex providers from CC-Switch SQLite database.
 * @returns {Promise<Array<{name: string, config: object, commonConfigEnabled: boolean, isCurrent: boolean}>>}
 */
async function getProviders(dbPath = DB_PATH) {
  const db = await openDb(dbPath);
  try {
    const results = db.exec(SQL_QUERY);
    if (!results.length || !results[0].values.length) {
      throw new Error('No Codex providers found in CC-Switch database.');
    }

    return results[0].values.map(([name, settingsConfig, meta, isCurrent]) => {
      let config;
      try {
        config = JSON.parse(settingsConfig);
      } catch {
        throw new Error('Invalid Codex provider settings JSON in CC-Switch database.');
      }

      let commonConfigEnabled = false;
      try {
        commonConfigEnabled = JSON.parse(meta).commonConfigEnabled === true;
      } catch {
        /* leave false */
      }

      return {
        name,
        config,
        commonConfigEnabled,
        meta: (() => { try { return JSON.parse(meta); } catch { return {}; } })(),
        isCurrent: !!isCurrent,
      };
    });
  } finally {
    db.close();
  }
}

module.exports = { getProviders, getCommonConfig, DB_PATH };
