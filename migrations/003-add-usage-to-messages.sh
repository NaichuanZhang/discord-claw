#!/bin/bash
# Migration: Add token usage columns to messages table
# These columns store per-API-call token counts for assistant messages.
# User messages will have NULL for these columns.

set -e

DB_PATH="${1:-data/discordclaw.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH — skipping migration (will be created fresh)"
  exit 0
fi

# Check if migration already applied (look for model column)
if sqlite3 "$DB_PATH" "PRAGMA table_info(messages);" | grep -q "model"; then
  echo "Migration 003 already applied — skipping"
  exit 0
fi

echo "Applying migration 003: add usage columns to messages..."

sqlite3 "$DB_PATH" <<'SQL'
ALTER TABLE messages ADD COLUMN model TEXT;
ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER;
SQL

echo "Migration 003 complete"
