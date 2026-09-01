#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INITIAL_HELPER="${SCRIPT_DIR}/release-helper.py"
EXPECTED_REPOSITORY="${HUB_RELEASE_EXPECTED_REPOSITORY:-TrueMichato/ThelemarTools}"
EXPECTED_ROOT="${HUB_RELEASE_EXPECTED_ROOT:-/home/ubuntu/ThelemarTools}"
EXPECTED_BRANCH="${HUB_RELEASE_EXPECTED_BRANCH:-multiplayer-hub}"
EXPECTED_HOST_USER="${HUB_RELEASE_EXPECTED_HOST_USER:-ubuntu}"
EXPECTED_HOST_UID="${HUB_RELEASE_EXPECTED_HOST_UID:-1001}"
EXPECTED_HOST_GID="${HUB_RELEASE_EXPECTED_HOST_GID:-1001}"
FOUNDRY_PORT="${HUB_FOUNDRY_PORT:-30000}"
MIN_ROOT_FREE_KB="${HUB_RELEASE_MIN_ROOT_FREE_KB:-4194304}"
MIN_BACKUP_FREE_KB="${HUB_RELEASE_MIN_BACKUP_FREE_KB:-1048576}"
LOCK_FILE="${HUB_RELEASE_LOCK_FILE:-/run/lock/thelemar-hub-release.lock}"
EVIDENCE_ROOT="${HUB_RELEASE_EVIDENCE_DIR:-${HOME}/.local/state/thelemar-hub/releases}"

TAG=""
TARGET_SHA=""
TAG_OBJECT=""
TAG_IDENTITY=""
ROOT=""
ENV_FILE=""
BACKUP_DIR=""
LAST_BACKUP_NAME=""
RELEASE_ID=""
RELEASE_DIR=""
STATE_FILE=""
TRACE_FILE=""
HELPER="$INITIAL_HELPER"
CURRENT_PHASE="startup"
PREVIOUS_SHA=""
PREVIOUS_TAG=""
PREVIOUS_BFF_CONTAINER=""
PREVIOUS_STATIC_CONTAINER=""
ROLLBACK_COMPATIBLE="true"
TRAFFIC_MUTATED="false"
SCHEMA_MUTATED="false"
PLANNED_MIGRATIONS="none"
APPLIED_MIGRATIONS="none"
SOURCE_CHECKED_OUT="false"
DRY_RUN="false"
ASSUME_YES="false"
REPAIR_BACKUP_IDS="false"
ALLOW_REDEPLOY="false"
TEST_MODE="${HUB_RELEASE_TEST_MODE:-0}"
SIMULATE="${HUB_RELEASE_SIMULATE:-0}"
EXIT_RECORDED="false"
declare -a PREBUILD_IMAGE_IDS=()
declare -a CANDIDATE_IMAGE_REFS=()
declare -a CANDIDATE_IMAGE_IDS=()

usage () {
	cat <<'EOF'
Usage: deploy/hub/release.sh [options] <verified-tag>

Options:
  --dry-run             Run read-only checks, build the candidate, and print the plan.
  --yes                 Skip the final typed operator confirmation.
  --repair-backup-ids   Set only HUB_BACKUP_UID/GID in .env.hub to the detected host IDs.
  --allow-redeploy      Permit explicitly rebuilding the tag already deployed.
  --help                Show this help.
EOF
}

log () {
	printf '[hub-release] %s\n' "$*"
}

fail () {
	printf '[hub-release] ERROR: %s\n' "$*" >&2
	return 1
}

trace () {
	[[ -n "$TRACE_FILE" ]] || return 0
	printf '%s\n' "$1" >>"$TRACE_FILE"
}

record () {
	local key="$1"
	local value="${2//$'\t'/ }"
	value="${value//$'\n'/ }"
	printf '%s\t%s\n' "$key" "$value" >>"$STATE_FILE"
}

replace_record () {
	local key="$1"
	local value="$2"
	local temporary="${STATE_FILE}.new"
	awk -F '\t' -v key="$key" '$1 != key' "$STATE_FILE" >"$temporary"
	mv "$temporary" "$STATE_FILE"
	record "$key" "$value"
}

env_value () {
	"$HELPER" env --file "$ENV_FILE" --key "$1"
}

sha256_file () {
	"$HELPER" sha256 --file "$1"
}

hash_files () {
	local temporary="${RELEASE_DIR}/hash-input"
	: >"$temporary"
	local file
	for file in "$@"; do
		printf '%s  %s\n' "$(sha256_file "$file")" "$(basename "$file")" >>"$temporary"
	done
	sha256_file "$temporary"
}

redact_file_to_stderr () {
	"$HELPER" redact --env-file "$ENV_FILE" <"$1" >&2
}

compose_current () {
	docker compose \
		--project-directory "$ROOT" \
		--env-file "$ENV_FILE" \
		-f "$ROOT/compose.hub.yml" \
		-f "$ROOT/compose.hub.public.yml" \
		"$@"
}

compose_release () {
	docker compose \
		--project-directory "$ROOT" \
		--env-file "$ENV_FILE" \
		-f "$ROOT/compose.hub.yml" \
		-f "$ROOT/compose.hub.public.yml" \
		-f "$ROOT/compose.hub.release.yml" \
		"$@"
}

normalize_origin () {
	printf '%s' "$1" | sed -E \
		-e 's#^git@github\.com:#https://github.com/#' \
		-e 's#^ssh://git@github\.com/#https://github.com/#' \
		-e 's#\.git$##'
}

resolve_remote_tag () {
	local root="$1"
	local tag="$2"
	local output tag_line peeled_line remote_tag_object remote_sha
	output="$(git -C "$root" ls-remote --exit-code --tags origin "refs/tags/${tag}" "refs/tags/${tag}^{}")" \
		|| fail "origin does not contain tag ${tag}"
	tag_line="$(printf '%s\n' "$output" | awk -v ref="refs/tags/${tag}" '$2 == ref {print $1}')"
	peeled_line="$(printf '%s\n' "$output" | awk -v ref="refs/tags/${tag}^{}" '$2 == ref {print $1}')"
	[[ -n "$tag_line" && -n "$peeled_line" ]] || fail "tag ${tag} must be an annotated tag"
	remote_tag_object="$tag_line"
	remote_sha="$peeled_line"
	printf '%s\t%s\n' "$remote_tag_object" "$remote_sha"
}

assert_foundry_listening () {
	command -v ss >/dev/null 2>&1 || fail "ss is required to protect the Foundry listener"
	ss -ltn | awk -v port=":${FOUNDRY_PORT}" 'NR > 1 && $4 ~ (port "$") {found = 1} END {exit !found}' \
		|| fail "Foundry is not listening on port ${FOUNDRY_PORT}; release refuses to proceed"
}

assert_compose_safe () {
	compose_current config --quiet
	! compose_current config | grep -Eq "(^|[^0-9])${FOUNDRY_PORT}([^0-9]|$)" \
		|| fail "Campaign Hub Compose configuration must not reference Foundry port ${FOUNDRY_PORT}"
}

assert_release_compose_safe () {
	compose_release config --quiet
	! compose_release config | grep -Eq "(^|[^0-9])${FOUNDRY_PORT}([^0-9]|$)" \
		|| fail "release Compose configuration must not reference Foundry port ${FOUNDRY_PORT}"
}

wait_for_public_ready () {
	local base_url="https://${HUB_PUBLIC_DOMAIN}"
	local _
	for _ in {1..30}; do
		if curl --silent --show-error --fail --max-time 5 "${base_url}/api/live" >/dev/null 2>&1 \
			&& curl --silent --show-error --fail --max-time 5 "${base_url}/api/ready" >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
	done
	fail "public liveness/readiness did not recover within 60 seconds"
}

capture_candidate_image_tags () {
	local project_name image_ref
	project_name="$(compose_current config | awk '$1 == "name:" {print $2; exit}')"
	[[ -n "$project_name" ]] || fail "could not resolve the Compose project name"
	CANDIDATE_IMAGE_REFS=(
		"${project_name}-migrate"
		"${project_name}-grant-roles"
		"${project_name}-bff"
		"${project_name}-static"
	)
	local index
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		PREBUILD_IMAGE_IDS[index]="$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null || true)"
	done
}

capture_candidate_images () {
	local index image_ref image_id revision
	CANDIDATE_IMAGE_IDS=()
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		image_id="$(docker image inspect --format '{{.Id}}' "$image_ref")" \
			|| fail "candidate image was not built: ${image_ref}"
		CANDIDATE_IMAGE_IDS[index]="$image_id"
		record "candidate_image_${index}" "$image_id"
		if ((index < 3)); then
			revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")"
			[[ "$revision" == "$TARGET_SHA" ]] \
				|| fail "candidate image ${image_ref} revision label does not match ${TARGET_SHA}"
		fi
	done
	export HUB_RELEASE_MIGRATE_IMAGE="${CANDIDATE_IMAGE_IDS[0]}"
	export HUB_RELEASE_GRANT_ROLES_IMAGE="${CANDIDATE_IMAGE_IDS[1]}"
	export HUB_RELEASE_BFF_IMAGE="${CANDIDATE_IMAGE_IDS[2]}"
	export HUB_RELEASE_STATIC_IMAGE="${CANDIDATE_IMAGE_IDS[3]}"
	assert_release_compose_safe
}

assert_candidate_images () {
	local image_id
	for image_id in "${CANDIDATE_IMAGE_IDS[@]}"; do
		docker image inspect "$image_id" >/dev/null \
			|| fail "approved candidate image is no longer present: ${image_id}"
	done
	[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"$HUB_RELEASE_BFF_IMAGE")" == "$TARGET_SHA" ]] \
		|| fail "approved BFF image revision no longer matches the verified tag"
	assert_release_compose_safe
}

restore_candidate_image_tags () {
	local index image_ref old_id
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		old_id="${PREBUILD_IMAGE_IDS[$index]:-}"
		if [[ -n "$old_id" ]]; then
			docker image tag "$old_id" "$image_ref" >/dev/null || return 1
		else
			docker image rm "$image_ref" >/dev/null 2>&1 || true
		fi
	done
}

assert_clean_root () {
	local status
	status="$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all)"
	[[ -z "$status" ]] || fail "deployment checkout is dirty; commit/remove release-source changes first"
	[[ ! -f "$ROOT/.git/MERGE_HEAD" ]] || fail "deployment checkout has an unfinished merge"
}

validate_backup_identity () {
	local actual_uid="$1"
	local actual_gid="$2"
	local configured_uid configured_gid
	configured_uid="$(env_value HUB_BACKUP_UID 2>/dev/null || true)"
	configured_gid="$(env_value HUB_BACKUP_GID 2>/dev/null || true)"
	if [[ "$configured_uid" == "$actual_uid" && "$configured_gid" == "$actual_gid" ]]; then
		return 0
	fi
	if [[ "$REPAIR_BACKUP_IDS" != "true" ]]; then
		fail ".env.hub must explicitly set HUB_BACKUP_UID=${actual_uid} and HUB_BACKUP_GID=${actual_gid}; rerun with --repair-backup-ids to change only those keys"
		return 1
	fi
	"$HELPER" set-backup-ids --file "$ENV_FILE" --uid "$actual_uid" --gid "$actual_gid"
	log "Updated only HUB_BACKUP_UID/GID in .env.hub."
}

get_container_image_evidence () {
	local container="$1"
	local prefix="$2"
	local image_id image_ref repo_digests
	image_id="$(docker inspect --format '{{.Image}}' "$container")"
	image_ref="$(docker inspect --format '{{.Config.Image}}' "$container")"
	repo_digests="$(docker image inspect --format '{{json .RepoDigests}}' "$image_id")"
	record "${prefix}_image_id" "$image_id"
	record "${prefix}_image_ref" "$image_ref"
	record "${prefix}_repo_digests" "$repo_digests"
	printf '%s\t%s\n' "$image_id" "$image_ref"
}

render_evidence () {
	[[ -n "$STATE_FILE" && -f "$STATE_FILE" ]] || return 0
	local json_path="${RELEASE_DIR}/evidence.json"
	local text_path="${RELEASE_DIR}/evidence.txt"
	"$HELPER" evidence --state "$STATE_FILE" --json "$json_path" --text "$text_path"
	log "Evidence: ${json_path}"
	log "Evidence: ${text_path}"
	EXIT_RECORDED="true"
}

print_isolated_restore_instructions () {
	cat >&2 <<EOF
[hub-release] Automatic application rollback is forbidden because the previous app is not schema-compatible.
[hub-release] The BFF has been stopped to prevent writes. The database and backup were preserved.
[hub-release] Follow docs/hub/runbooks/backup-restore.md and docs/hub/runbooks/rollback.md:
  1. Create an isolated PostgreSQL 17 container/database; never restore over production.
  2. Verify ${BACKUP_DIR}/${LAST_BACKUP_NAME:-<prerelease-backup>} by hash and restore it only into that isolated target.
  3. Inspect hub.schema_migrations, constraints, aggregate counts, authorization, outbox, and readiness.
  4. Choose a forward fix or an operator-approved database switch; never run a down migration or edit the ledger.
  5. Record RPO impact and the exact app/image/tag pairing before reopening traffic.
EOF
}

record_failed_migration_apply () {
	local plan="$1"
	local status_file="${RELEASE_DIR}/migration-after-failed-apply.json"
	if [[ "$PLANNED_MIGRATIONS" != "none" ]]; then
		SCHEMA_MUTATED="true"
		replace_record schema_mutated true
		replace_record migrations_applied unknown
	fi
	replace_record migrations_planned "$PLANNED_MIGRATIONS"
	if compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs status >"$status_file"; then
		local reconciled_migrations
		if reconciled_migrations="$(python3 -c '
import json, sys
before = {row["version"] for row in json.load(open(sys.argv[1]))["applied"]}
after = [row["version"] for row in json.load(open(sys.argv[2]))["applied"] if row["version"] not in before]
print(",".join(after) or "none")
' "$plan" "$status_file")"; then
			APPLIED_MIGRATIONS="$reconciled_migrations"
			replace_record migrations_applied "$APPLIED_MIGRATIONS"
			if [[ "$APPLIED_MIGRATIONS" == "none" ]]; then
				SCHEMA_MUTATED="false"
				replace_record schema_mutated false
			else
				SCHEMA_MUTATED="true"
				replace_record schema_mutated true
			fi
		else
			log "Could not parse post-failure migration status; retaining conservative schema_mutated=true/migrations_applied=unknown evidence."
		fi
	elif [[ "$PLANNED_MIGRATIONS" != "none" ]]; then
		log "Could not read post-failure migration status; retaining conservative schema_mutated=true/migrations_applied=unknown evidence."
	fi
}

rollback_application () {
	replace_record rollback_attempted true
	trace "rollback"
	log "Rolling the application back to ${PREVIOUS_TAG} (${PREVIOUS_SHA}); the database is not changed."
	git -C "$ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null || return 1
	SOURCE_CHECKED_OUT="false"
	restore_candidate_image_tags || return 1
	export HUB_IMAGE_VERSION="$PREVIOUS_TAG"
	export HUB_VCS_REF="$PREVIOUS_SHA"
	compose_current up -d --no-deps --force-recreate --wait bff static || return 1
	compose_current up -d --no-deps --force-recreate edge || return 1
	assert_foundry_listening || return 1
	export_monitor_environment || return 1
	wait_for_public_ready || return 1
	"$ROOT/deploy/hub/monitor-host.sh" || return 1
	replace_record rollback_result succeeded || return 1
}

handle_failure () {
	local status="$1"
	trap - ERR
	set +e
	trace "failure:${CURRENT_PHASE}"
	[[ -n "$STATE_FILE" && -f "$STATE_FILE" ]] && {
		replace_record status failed
		replace_record failed_phase "$CURRENT_PHASE"
		replace_record exit_status "$status"
	}
	if [[ "$SIMULATE" == "1" ]]; then
		if [[ "$TRAFFIC_MUTATED" == "true" && "$ROLLBACK_COMPATIBLE" == "true" ]]; then
			trace "rollback"
			[[ -f "$STATE_FILE" ]] && replace_record rollback_result simulated-compatible
		elif [[ "$TRAFFIC_MUTATED" == "true" ]]; then
			trace "isolate"
			[[ -f "$STATE_FILE" ]] && replace_record rollback_result forbidden-schema-incompatible
		elif [[ "$SCHEMA_MUTATED" == "true" ]]; then
			trace "schema-compatible-old-app-remains"
			[[ -f "$STATE_FILE" ]] && replace_record failure_action previous-compatible-app-remains
		else
			trace "database-unchanged-old-app-remains"
			[[ -f "$STATE_FILE" ]] && replace_record failure_action database-unchanged-old-app-remains
		fi
	elif [[ "$TRAFFIC_MUTATED" == "true" && "$ROLLBACK_COMPATIBLE" == "true" ]]; then
		rollback_application || {
			replace_record rollback_result failed
			log "Automatic application rollback failed; preserve the database and follow docs/hub/runbooks/rollback.md."
		}
	elif [[ "$TRAFFIC_MUTATED" == "true" ]]; then
		compose_current stop bff >/dev/null 2>&1 || true
		replace_record rollback_result forbidden-schema-incompatible
		print_isolated_restore_instructions
	elif [[ "$SOURCE_CHECKED_OUT" == "true" && -n "$PREVIOUS_SHA" ]]; then
		if [[ "$SCHEMA_MUTATED" == "true" ]]; then
			replace_record failure_action previous-compatible-app-remains
			log "Schema migrations ${APPLIED_MIGRATIONS} were applied, but traffic was not cut over; the compatible previous application remains running."
			log "The database was not reversed or restored. Correct the release and move forward."
		fi
		if git -C "$ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null 2>&1 \
			&& restore_candidate_image_tags >/dev/null 2>&1; then
			replace_record pretraffic_recovery succeeded
		else
			replace_record pretraffic_recovery failed
			log "Failed to restore the previous checkout/image tags; running containers were not recreated."
		fi
	fi
	[[ -n "$STATE_FILE" && -f "$STATE_FILE" ]] && render_evidence
	exit "$status"
}

cleanup () {
	local status="$?"
	if [[ "$status" -ne 0 && "$EXIT_RECORDED" != "true" ]]; then
		handle_failure "$status"
	fi
}

export_monitor_environment () {
	export HUB_PUBLIC_DOMAIN HUB_METRICS_TOKEN
	HUB_PUBLIC_DOMAIN="$(env_value HUB_PUBLIC_DOMAIN)"
	HUB_METRICS_TOKEN="$(env_value HUB_METRICS_TOKEN)"
	export HUB_MONITOR_HEARTBEAT_URL HUB_MONITOR_FAILURE_URL
	HUB_MONITOR_HEARTBEAT_URL="$(env_value HUB_MONITOR_HEARTBEAT_URL 2>/dev/null || true)"
	HUB_MONITOR_FAILURE_URL="$(env_value HUB_MONITOR_FAILURE_URL 2>/dev/null || true)"
}

phase_preflight () {
	ROOT="$(git -C "$SCRIPT_DIR/../.." rev-parse --show-toplevel)"
	ROOT="$(cd "$ROOT" && pwd -P)"
	ENV_FILE="$ROOT/.env.hub"
	[[ "$(pwd -P)" == "$ROOT" ]] || fail "run this command from the deployment repository root: ${ROOT}"
	if [[ "$TEST_MODE" != "1" ]]; then
		[[ "$ROOT" == "$EXPECTED_ROOT" ]] || fail "expected deployment root ${EXPECTED_ROOT}, got ${ROOT}"
	fi
	[[ "$(normalize_origin "$(git -C "$ROOT" remote get-url origin)")" == "https://github.com/${EXPECTED_REPOSITORY}" ]] \
		|| fail "origin is not https://github.com/${EXPECTED_REPOSITORY}"
	assert_clean_root
	[[ -f "$ENV_FILE" ]] || fail ".env.hub is missing"
	local mode
	mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
	(( (8#$mode & 077) == 0 )) || fail ".env.hub must not be group/world accessible"

	local required
	for required in \
		compose.hub.yml \
		compose.hub.public.yml \
		compose.hub.release.yml \
		deploy/hub/Caddyfile.public \
		deploy/hub/monitor-host.sh \
		deploy/hub/migration-policy.json; do
		[[ -f "$ROOT/$required" ]] || fail "required release file is missing: ${required}"
	done
	for required in git docker curl openssl python3 flock df stat awk sed ss; do
		command -v "$required" >/dev/null 2>&1 || fail "required command is missing: ${required}"
	done
	docker info >/dev/null
	docker compose version >/dev/null
	assert_compose_safe
	assert_foundry_listening

	local actual_user actual_uid actual_gid
	actual_user="$(id -un)"
	actual_uid="$(id -u)"
	actual_gid="$(id -g)"
	[[ "$actual_user" == "$EXPECTED_HOST_USER" ]] || fail "release must run as ${EXPECTED_HOST_USER}, got ${actual_user}"
	[[ "$actual_uid" == "$EXPECTED_HOST_UID" && "$actual_gid" == "$EXPECTED_HOST_GID" ]] \
		|| fail "host UID/GID must be ${EXPECTED_HOST_UID}:${EXPECTED_HOST_GID}, got ${actual_uid}:${actual_gid}"
	validate_backup_identity "$actual_uid" "$actual_gid"
	"$HELPER" validate-key --file "$ENV_FILE" || fail "HUB_BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes"

	BACKUP_DIR="$(env_value HUB_BACKUP_DIR 2>/dev/null || true)"
	[[ "$BACKUP_DIR" == /* ]] || fail "HUB_BACKUP_DIR must be an explicit absolute host path"
	[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || fail "HUB_BACKUP_DIR must be an existing non-symlink directory"
	[[ -w "$BACKUP_DIR" ]] || fail "HUB_BACKUP_DIR is not writable by the release operator"
	[[ "$(stat -c '%u:%g' "$BACKUP_DIR" 2>/dev/null || stat -f '%u:%g' "$BACKUP_DIR")" == "${actual_uid}:${actual_gid}" ]] \
		|| fail "backup directory must be owned by ${actual_uid}:${actual_gid}; release will never chown it"

	local root_free backup_free
	root_free="$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')"
	backup_free="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
	(( root_free >= MIN_ROOT_FREE_KB )) || fail "repository filesystem has less than ${MIN_ROOT_FREE_KB} KiB free"
	(( backup_free >= MIN_BACKUP_FREE_KB )) || fail "backup filesystem has less than ${MIN_BACKUP_FREE_KB} KiB free"

	git -C "$ROOT" fetch --no-tags origin \
		"refs/heads/${EXPECTED_BRANCH}:refs/remotes/origin/${EXPECTED_BRANCH}"
	local remote_pair remote_tag_object remote_sha
	remote_pair="$(resolve_remote_tag "$ROOT" "$TAG")"
	IFS=$'\t' read -r remote_tag_object remote_sha <<<"$remote_pair"
	git -C "$ROOT" fetch --no-tags origin "refs/tags/${TAG}:refs/tags/${TAG}"
	[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${TAG}")" == "tag" ]] || fail "${TAG} is not an annotated tag"
	TAG_OBJECT="$(git -C "$ROOT" rev-parse "refs/tags/${TAG}")"
	TARGET_SHA="$(git -C "$ROOT" rev-parse "refs/tags/${TAG}^{}")"
	[[ "$TAG_OBJECT" == "$remote_tag_object" && "$TARGET_SHA" == "$remote_sha" ]] \
		|| fail "local and origin tag identities do not match"
	git -C "$ROOT" merge-base --is-ancestor "$TARGET_SHA" "origin/${EXPECTED_BRANCH}" \
		|| fail "${TAG} is not reachable from origin/${EXPECTED_BRANCH}"
	TAG_IDENTITY="$(git -C "$ROOT" for-each-ref --format='%(taggername) <%(taggeremail)>: %(contents:subject)' "refs/tags/${TAG}")"
	if [[ "${HUB_RELEASE_REQUIRE_SIGNED_TAG:-0}" == "1" ]]; then
		git -C "$ROOT" verify-tag "$TAG"
	fi

	PREVIOUS_SHA="$(git -C "$ROOT" rev-parse HEAD)"
	PREVIOUS_TAG="$(git -C "$ROOT" describe --tags --exact-match "$PREVIOUS_SHA" 2>/dev/null || true)"
	[[ -n "$PREVIOUS_TAG" ]] || fail "current deployment HEAD must have an exact rollback tag"
	[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${PREVIOUS_TAG}")" == "tag" ]] \
		|| fail "current rollback tag ${PREVIOUS_TAG} is not annotated"
	if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" && "$ALLOW_REDEPLOY" != "true" ]]; then
		fail "${TAG} is already deployed; use --allow-redeploy for an explicit rebuild"
	fi

	export_monitor_environment
	"$ROOT/deploy/hub/monitor-host.sh"
}

phase_record_rollback () {
	PREVIOUS_BFF_CONTAINER="$(compose_current ps -q bff)"
	PREVIOUS_STATIC_CONTAINER="$(compose_current ps -q static)"
	[[ -n "$PREVIOUS_BFF_CONTAINER" && -n "$PREVIOUS_STATIC_CONTAINER" ]] \
		|| fail "running BFF/static containers are required for rollback"
	get_container_image_evidence "$PREVIOUS_BFF_CONTAINER" previous_bff >/dev/null
	get_container_image_evidence "$PREVIOUS_STATIC_CONTAINER" previous_static >/dev/null

	local migration_status="${RELEASE_DIR}/migration-before.json"
	compose_current run --rm --no-deps migrate node server/scripts/migrate.mjs status >"$migration_status"
	record previous_migration_status_sha256 "$(sha256_file "$migration_status")"
	record previous_config_sha256 "$(hash_files \
		"$ROOT/compose.hub.yml" \
		"$ROOT/compose.hub.public.yml" \
		"$ROOT/compose.hub.release.yml" \
		"$ROOT/deploy/hub/Caddyfile.public" \
		"$ROOT/deploy/hub/migration-policy.json")"
	record env_file_sha256 "$(sha256_file "$ENV_FILE")"
	record readiness_before passed
	record foundry_before "listening:${FOUNDRY_PORT}"
	capture_candidate_image_tags
}

phase_backup () {
	local timestamp backup_name container_backup
	timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
	backup_name="hub-prerelease-${TAG}-${timestamp}.dump.enc"
	LAST_BACKUP_NAME="$backup_name"
	container_backup="/backups/${backup_name}"
	if [[ "$DRY_RUN" == "true" ]]; then
		log "DRY RUN: would create and cryptographically verify ${BACKUP_DIR}/${backup_name}"
		record backup_status dry-run
		return 0
	fi
	compose_current --profile backup run --rm --no-deps backup \
		node server/scripts/backup-encrypted.mjs "$container_backup"
	local host_backup="${BACKUP_DIR}/${backup_name}"
	[[ -f "$host_backup" ]] || fail "encrypted backup was not created at ${host_backup}"
	[[ "$(dd if="$host_backup" bs=7 count=1 2>/dev/null)" == "HUBENC1" ]] \
		|| fail "encrypted backup envelope header is invalid"
	# The quoted program must be passed to Node verbatim; shell expansion would be unsafe here.
	# shellcheck disable=SC2016
	compose_current --profile backup run --rm --no-deps backup \
		node --input-type=module -e '
			import fs from "node:fs";
			import os from "node:os";
			import path from "node:path";
			import {spawnSync} from "node:child_process";
			import {getEncryptionKey, pDecryptFile} from "./server/scripts/backup-crypto.mjs";
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-release-verify-"));
			const dump = path.join(dir, "hub.dump");
			try {
				await pDecryptFile({source: process.argv[1], target: dump, key: getEncryptionKey()});
				const result = spawnSync("pg_restore", ["--list", dump], {stdio: ["ignore", "ignore", "inherit"]});
				if (result.error) throw result.error;
				if (result.status !== 0) throw new Error(`pg_restore --list exited ${result.status}`);
			} finally {
				fs.rmSync(dir, {recursive: true, force: true});
			}
		' "$container_backup"
	record backup_filename "$backup_name"
	record backup_sha256 "$(sha256_file "$host_backup")"
	record backup_size_bytes "$(stat -c '%s' "$host_backup" 2>/dev/null || stat -f '%z' "$host_backup")"
	record backup_verified true
}

phase_checkout () {
	if [[ "$DRY_RUN" == "true" ]]; then
		log "DRY RUN: candidate source will still be checked out temporarily and restored after planning."
	fi
	git -C "$ROOT" checkout --detach "$TARGET_SHA" >/dev/null
	SOURCE_CHECKED_OUT="true"
	assert_clean_root
	[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "candidate checkout SHA drifted"
	[[ "$(git -C "$ROOT" rev-parse "refs/tags/${TAG}^{}")" == "$TARGET_SHA" ]] || fail "candidate tag drifted"
	[[ -f "$ROOT/deploy/hub/migration-policy.json" ]] || fail "candidate is missing migration policy"
	assert_compose_safe
	record target_config_sha256 "$(hash_files \
		"$ROOT/compose.hub.yml" \
		"$ROOT/compose.hub.public.yml" \
		"$ROOT/compose.hub.release.yml" \
		"$ROOT/deploy/hub/Caddyfile.public" \
		"$ROOT/deploy/hub/migration-policy.json")"
}

phase_migration_plan () {
	export HUB_IMAGE_VERSION="$TAG"
	export HUB_VCS_REF="$TARGET_SHA"
	compose_current build migrate grant-roles bff static
	capture_candidate_images
	local plan="${RELEASE_DIR}/migration-plan.json"
	local summary="${RELEASE_DIR}/migration-summary.json"
	compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs plan >"$plan"
	if ! "$HELPER" migration \
		--plan "$plan" \
		--policy "$ROOT/deploy/hub/migration-policy.json" \
		--output "$summary"; then
		ROLLBACK_COMPATIBLE="false"
		replace_record rollback_compatible false
		redact_file_to_stderr "$plan"
		fail "migration plan is missing compatibility metadata or contains a contract migration"
	fi
	ROLLBACK_COMPATIBLE="$(python3 -c \
		'import json,sys; print("true" if json.load(open(sys.argv[1]))["rollbackCompatible"] else "false")' \
		"$summary")"
	local pending
	pending="$(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["pendingVersions"]) or "none")' "$summary")"
	PLANNED_MIGRATIONS="$pending"
	record migration_plan_sha256 "$(sha256_file "$plan")"
	record migration_pending "$pending"
	replace_record rollback_compatible "$ROLLBACK_COMPATIBLE"
	log "Migration plan:"
	"$HELPER" redact --env-file "$ENV_FILE" <"$summary"
	if [[ "$ROLLBACK_COMPATIBLE" != "true" ]]; then
		fail "pending expand migration does not permit the previous application; split the release before deploying"
	fi
}

phase_approval () {
	local remote_pair remote_tag_object remote_sha
	remote_pair="$(resolve_remote_tag "$ROOT" "$TAG")"
	IFS=$'\t' read -r remote_tag_object remote_sha <<<"$remote_pair"
	[[ "$remote_tag_object" == "$TAG_OBJECT" && "$remote_sha" == "$TARGET_SHA" ]] \
		|| fail "origin tag changed during release preparation"
	[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "candidate checkout changed during preparation"
	assert_clean_root
	if [[ "$DRY_RUN" == "true" ]]; then
		log "DRY RUN complete: no backup, migration, role, or service mutation was performed."
		git -C "$ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null
		restore_candidate_image_tags
		SOURCE_CHECKED_OUT="false"
		return 0
	fi
	log "Candidate: ${TAG} (${TARGET_SHA})"
	log "Annotated tag: ${TAG_IDENTITY}"
	log "Rollback: ${PREVIOUS_TAG} (${PREVIOUS_SHA}); schema compatible: ${ROLLBACK_COMPATIBLE}"
	if [[ "$ASSUME_YES" == "true" ]]; then
		return 0
	fi
	local expected="RELEASE ${TAG} ${TARGET_SHA}"
	local confirmation
	printf 'Type exactly "%s" to mutate production traffic: ' "$expected" >&2
	IFS= read -r confirmation
	[[ "$confirmation" == "$expected" ]] || fail "operator confirmation did not match"
}

phase_deploy () {
	if [[ "$DRY_RUN" == "true" ]]; then
		return 0
	fi
	local remote_pair
	remote_pair="$(resolve_remote_tag "$ROOT" "$TAG")"
	[[ "$remote_pair" == "${TAG_OBJECT}"$'\t'"${TARGET_SHA}" ]] || fail "origin tag drifted before migration apply"
	assert_candidate_images
	export HUB_IMAGE_VERSION="$TAG"
	export HUB_VCS_REF="$TARGET_SHA"
	local migration_apply="${RELEASE_DIR}/migration-apply.json"
	if ! compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs >"$migration_apply"; then
		[[ -f "$migration_apply" ]] && record migration_apply_sha256 "$(sha256_file "$migration_apply")"
		record_failed_migration_apply "${RELEASE_DIR}/migration-plan.json"
		return 1
	fi
	if [[ "$PLANNED_MIGRATIONS" != "none" ]]; then
		SCHEMA_MUTATED="true"
		replace_record schema_mutated true
	fi
	replace_record migrations_planned "$PLANNED_MIGRATIONS"
	replace_record migrations_applied unknown
	record migration_apply_sha256 "$(sha256_file "$migration_apply")"
	APPLIED_MIGRATIONS="$(python3 -c \
		'import json,sys; print(",".join(json.load(open(sys.argv[1]))["appliedNow"]) or "none")' \
		"$migration_apply")"
	replace_record migrations_applied "$APPLIED_MIGRATIONS"
	if [[ "$PLANNED_MIGRATIONS" == "none" && "$APPLIED_MIGRATIONS" != "none" ]]; then
		SCHEMA_MUTATED="true"
		replace_record schema_mutated true
	fi
	compose_release run --rm --no-deps grant-roles node server/scripts/grant-roles.mjs
	local before_cutover="${RELEASE_DIR}/migration-before-cutover.json"
	compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs status >"$before_cutover"
	[[ "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["pending"]))' "$before_cutover")" == "0" ]] \
		|| fail "migrations remain pending before application cutover"
	TRAFFIC_MUTATED="true"
	replace_record traffic_mutated true
	compose_release up -d --no-deps --force-recreate --wait bff static
	[[ "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q bff)")" == "$HUB_RELEASE_BFF_IMAGE" ]] \
		|| fail "running BFF image does not match the approved candidate"
	[[ "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q static)")" == "$HUB_RELEASE_STATIC_IMAGE" ]] \
		|| fail "running static image does not match the approved candidate"
	compose_release up -d --no-deps --force-recreate edge
}

phase_verify () {
	if [[ "$DRY_RUN" == "true" ]]; then
		record verification dry-run
		return 0
	fi
	export_monitor_environment
	wait_for_public_ready
	"$ROOT/deploy/hub/monitor-host.sh"
	local base_url="https://${HUB_PUBLIC_DOMAIN}"
	curl --silent --show-error --fail --max-time 15 "${base_url}/api/live" >/dev/null
	curl --silent --show-error --fail --max-time 15 "${base_url}/api/ready" >/dev/null
	curl --silent --show-error --fail --max-time 15 "${base_url}/favicon.ico" >/dev/null
	curl --silent --show-error --fail --max-time 15 "${base_url}/thelemar_symbol_wip_2_icon.ico" >/dev/null
	curl --silent --show-error --fail --max-time 15 "${base_url}/sw.js" >/dev/null
	curl --silent --show-error --fail --max-time 15 "${base_url}/sw-injector.js" >/dev/null
	local migration_after="${RELEASE_DIR}/migration-after.json"
	compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs status >"$migration_after"
	[[ "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["pending"]))' "$migration_after")" == "0" ]] \
		|| fail "migrations remain pending after deployment"
	local running_services
	running_services="$(compose_release ps --status running --services)"
	for service in db bff static edge; do
		printf '%s\n' "$running_services" | grep -qx "$service" \
			|| fail "Compose service ${service} is not running"
	done
	assert_foundry_listening
	local newest_backup
	newest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hub-*.dump.enc' -mmin -1560 -print | sort | tail -n 1)"
	[[ -n "$newest_backup" ]] || fail "no encrypted backup is newer than 26 hours"
	record migration_after_sha256 "$(sha256_file "$migration_after")"
	record readiness_after passed
	record tls_websocket_metrics_after passed
	record static_assets_after passed
	record backup_age_after passed
	record foundry_after "listening:${FOUNDRY_PORT}"
	record deployed_bff_image_id "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q bff)")"
	record deployed_static_image_id "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q static)")"
}

phase_finalize () {
	replace_record status "$([[ "$DRY_RUN" == "true" ]] && printf dry-run || printf succeeded)"
	replace_record completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	render_evidence
}

run_phase () {
	CURRENT_PHASE="$1"
	trace "$CURRENT_PHASE"
	log "Phase: ${CURRENT_PHASE}"
	if [[ "$SIMULATE" == "1" ]]; then
		if [[ "$CURRENT_PHASE" == "preflight" && -n "${HUB_RELEASE_TEST_HOLD_LOCK_SECONDS:-}" ]]; then
			sleep "$HUB_RELEASE_TEST_HOLD_LOCK_SECONDS"
		fi
		if [[ "$CURRENT_PHASE" == "migration-plan" ]]; then
			ROLLBACK_COMPATIBLE="${HUB_RELEASE_TEST_ROLLBACK_COMPATIBLE:-true}"
			PLANNED_MIGRATIONS="${HUB_RELEASE_TEST_PLANNED_MIGRATIONS:-0004}"
			replace_record rollback_compatible "$ROLLBACK_COMPATIBLE"
			replace_record migration_pending "$PLANNED_MIGRATIONS"
			[[ "$ROLLBACK_COMPATIBLE" == "true" ]] || fail "simulated incompatible migration"
		fi
		if [[ "$CURRENT_PHASE" == "deploy" ]]; then
			ROLLBACK_COMPATIBLE="${HUB_RELEASE_TEST_DEPLOY_ROLLBACK_COMPATIBLE:-$ROLLBACK_COMPATIBLE}"
			replace_record rollback_compatible "$ROLLBACK_COMPATIBLE"
			APPLIED_MIGRATIONS="$PLANNED_MIGRATIONS"
			replace_record migrations_planned "$PLANNED_MIGRATIONS"
			replace_record migrations_applied unknown
			if [[ "$PLANNED_MIGRATIONS" != "none" ]]; then
				SCHEMA_MUTATED="true"
				replace_record schema_mutated true
				trace "schema-migrated"
			fi
			replace_record migrations_applied "$APPLIED_MIGRATIONS"
			[[ "${HUB_RELEASE_TEST_FAIL_STEP:-}" != "grant-roles" ]] || fail "simulated grant-roles failure"
			[[ "${HUB_RELEASE_TEST_FAIL_STEP:-}" != "pre-cutover-status" ]] || fail "simulated pre-cutover status failure"
			TRAFFIC_MUTATED="true"
			replace_record traffic_mutated true
		fi
		if [[ "$CURRENT_PHASE" == "finalize" ]]; then
			replace_record status simulated
			replace_record traffic_mutated simulated
			replace_record schema_mutated simulated
			replace_record completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
			render_evidence
		fi
		[[ "${HUB_RELEASE_TEST_FAIL_PHASE:-}" != "$CURRENT_PHASE" ]] || fail "simulated ${CURRENT_PHASE} failure"
		return 0
	fi
	"phase_${CURRENT_PHASE//-/_}"
}

parse_arguments () {
	while (($#)); do
		case "$1" in
			--dry-run) DRY_RUN="true" ;;
			--yes) ASSUME_YES="true" ;;
			--repair-backup-ids) REPAIR_BACKUP_IDS="true" ;;
			--allow-redeploy) ALLOW_REDEPLOY="true" ;;
			--help)
				usage
				exit 0
				;;
			-*) fail "unknown option: $1"; usage >&2; exit 2 ;;
			*)
				[[ -z "$TAG" ]] || { fail "only one release tag is accepted"; exit 2; }
				TAG="$1"
				;;
		esac
		shift
	done
	[[ "$TAG" =~ ^hub-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
		fail "verified tag must match hub-[A-Za-z0-9._-]+"
		exit 2
	}
}

main () {
	parse_arguments "$@"
	if [[ "$SIMULATE" == "1" && "$TEST_MODE" != "1" ]]; then
		fail "HUB_RELEASE_SIMULATE is available only with HUB_RELEASE_TEST_MODE=1"
		exit 2
	fi
	mkdir -p "$(dirname "$LOCK_FILE")"
	exec 9>"$LOCK_FILE"
	if command -v flock >/dev/null 2>&1; then
		flock -n 9 || {
			printf '[hub-release] ERROR: another Campaign Hub release holds %s\n' "$LOCK_FILE" >&2
			exit 75
		}
	elif [[ "$TEST_MODE" == "1" ]]; then
		python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null \
			|| {
				printf '[hub-release] ERROR: another Campaign Hub release holds %s\n' "$LOCK_FILE" >&2
				exit 75
			}
	else
		fail "flock is required"
		exit 1
	fi

	RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TAG//[^A-Za-z0-9._-]/_}-$$"
	mkdir -p "$EVIDENCE_ROOT"
	RELEASE_DIR="${EVIDENCE_ROOT}/${RELEASE_ID}"
	mkdir "$RELEASE_DIR"
	STATE_FILE="${RELEASE_DIR}/state.tsv"
	TRACE_FILE="${RELEASE_DIR}/phases.log"
	: >"$STATE_FILE"
	: >"$TRACE_FILE"
	cp "$INITIAL_HELPER" "${RELEASE_DIR}/release-helper.py"
	chmod 700 "${RELEASE_DIR}/release-helper.py"
	HELPER="${RELEASE_DIR}/release-helper.py"
	record release_id "$RELEASE_ID"
	record requested_tag "$TAG"
	record started_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	record status running
	record dry_run "$DRY_RUN"
	record traffic_mutated false
	record schema_mutated false
	record rollback_attempted false
	record rollback_compatible unknown
	record simulation "$([[ "$SIMULATE" == "1" ]] && printf true || printf false)"
	trap cleanup EXIT
	trap 'exit $?' ERR
	trap 'exit 129' HUP
	trap 'exit 130' INT
	trap 'exit 143' TERM

	local phases=(
		preflight
		record-rollback
		backup
		checkout
		migration-plan
		approval
		deploy
		verify
		finalize
	)
	local phase
	for phase in "${phases[@]}"; do
		run_phase "$phase"
		if [[ "$phase" == "preflight" && "$SIMULATE" != "1" ]]; then
			record target_sha "$TARGET_SHA"
			record tag_object "$TAG_OBJECT"
			record tag_identity "$TAG_IDENTITY"
			record previous_sha "$PREVIOUS_SHA"
			record previous_tag "$PREVIOUS_TAG"
			record backup_dir "$BACKUP_DIR"
		fi
	done
	trap - EXIT
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
