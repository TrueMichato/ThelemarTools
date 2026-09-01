#!/bin/sh
set -eu

umask 077

: "${HUB_BACKUP_REMOTE:?Set HUB_BACKUP_REMOTE, for example ubuntu@hub.example.com}"

remote_dir="${HUB_BACKUP_REMOTE_DIR:-/home/ubuntu/ThelemarTools/.hub-backups}"
local_dir="${HUB_BACKUP_LOCAL_DIR:-$HOME/ThelemarTools-hub-backups}"

mkdir -p "$local_dir"
chmod 700 "$local_dir"

rsync \
	--archive \
	--compress \
	--ignore-existing \
	--include='hub-*.dump.enc' \
	--exclude='*' \
	"${HUB_BACKUP_REMOTE}:${remote_dir}/" \
	"${local_dir}/"

latest="$(find "$local_dir" -type f -name 'hub-*.dump.enc' -mmin -1800 -print | sort | tail -n 1)"
[ -n "$latest" ] || {
	printf 'No encrypted Campaign Hub backup newer than 30 hours exists in %s.\n' "$local_dir" >&2
	exit 1
}

openssl dgst -sha256 "$latest"
printf 'Latest off-machine backup: %s\n' "$latest"
