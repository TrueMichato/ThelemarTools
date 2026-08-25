#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${HUB_RUNTIME_DB_PASSWORD:?HUB_RUNTIME_DB_PASSWORD is required}"
: "${HUB_BACKUP_DB_PASSWORD:?HUB_BACKUP_DB_PASSWORD is required}"

psql \
	--username "$POSTGRES_USER" \
	--dbname "$POSTGRES_DB" \
	--set ON_ERROR_STOP=1 \
	--set runtime_password="$HUB_RUNTIME_DB_PASSWORD" \
	--set backup_password="$HUB_BACKUP_DB_PASSWORD" <<'SQL'
CREATE ROLE hub_runtime LOGIN PASSWORD :'runtime_password';
CREATE ROLE hub_backup LOGIN PASSWORD :'backup_password';
SQL
