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
MIN_ROOT_FREE_KB="${HUB_RELEASE_MIN_ROOT_FREE_KB:-4194304}"
MIN_BACKUP_FREE_KB="${HUB_RELEASE_MIN_BACKUP_FREE_KB:-1048576}"
SHARED_RELEASE_LOCK_FILE="/run/lock/thelemar-hub-release.lock"
LOCK_FILE="${HUB_RELEASE_LOCK_FILE:-$SHARED_RELEASE_LOCK_FILE}"
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
CONTROL_SHA=""
PREVIOUS_BFF_CONTAINER=""
PREVIOUS_STATIC_CONTAINER=""
PREVIOUS_BACKUP_IMAGE_ID=""
ROLLBACK_COMPATIBLE="true"
TRAFFIC_MUTATED="false"
SCHEMA_MUTATED="false"
PLANNED_MIGRATIONS="none"
APPLIED_MIGRATIONS="none"
SCHEMA_HAS_MIGRATION_0011="false"
BFF_QUIESCED="false"
QUIESCE_CALL_COUNT=0
RECOVERY_REQUIRED="false"
RECOVERY_ACTIVE_STATE="false"
RECOVERY_B_STARTED="false"
RECOVERY_B_SOURCE_SHA=""
RECOVERY_B_SOURCE_TREE_SHA=""
RECOVERY_B_TAG_NAME=""
RECOVERY_B_TAG_OBJECT_SHA=""
RECOVERY_B_PROTOCOL_VERSION=""
RECOVERY_B_REQUIRED_MIGRATION_VERSION=""
RECOVERY_B_SCHEMA_COMPATIBLE_THROUGH=""
RECOVERY_B_BFF_IMAGE_ID=""
RECOVERY_B_STATIC_IMAGE_ID=""
RECOVERY_B_OPERATIONS_IMAGE_ID=""
RECOVERY_B_BFF_IMAGE_REF=""
RECOVERY_B_STATIC_IMAGE_REF=""
RECOVERY_B_BACKUP_IMAGE_REF=""
RECOVERY_B_MAINTENANCE_IMAGE_REF=""
RECOVERY_B_MANIFEST_SHA256=""
RECOVERY_B_QUALIFICATION_SHA256=""
RECOVERY_B_CONFIGURATION_SHA256=""
EXECUTING_ENGINE_SOURCE_SHA=""
EXECUTING_ENGINE_TREE_SHA=""
EXECUTING_ENGINE_SCRIPT_SHA256=""
EXECUTING_ENGINE_HELPER_SHA256=""
SOURCE_CHECKED_OUT="false"
DRY_RUN="false"
ASSUME_YES="false"
REPAIR_BACKUP_IDS="false"
ALLOW_REDEPLOY="false"
TEST_MODE="${HUB_RELEASE_TEST_MODE:-0}"
SIMULATE="${HUB_RELEASE_SIMULATE:-0}"
FIRST_USE="${HUB_RELEASE_FIRST_USE:-0}"
INHERITED_LOCK_FD="${HUB_RELEASE_INHERITED_LOCK_FD:-}"
FIRST_USE_PREVIOUS_SHA="${HUB_RELEASE_PREVIOUS_SHA:-}"
FIRST_USE_PREVIOUS_TAG="${HUB_RELEASE_PREVIOUS_TAG:-}"
FIRST_USE_PREVIOUS_BFF_IMAGE_ID="${HUB_RELEASE_PREVIOUS_BFF_IMAGE_ID:-}"
FIRST_USE_PREVIOUS_STATIC_IMAGE_ID="${HUB_RELEASE_PREVIOUS_STATIC_IMAGE_ID:-}"
FIRST_USE_PREVIOUS_BACKUP_IMAGE_ID="${HUB_RELEASE_PREVIOUS_BACKUP_IMAGE_ID:-}"
FIRST_USE_PREVIOUS_CONFIG_SHA256="${HUB_RELEASE_PREVIOUS_CONFIG_SHA256:-}"
EXIT_RECORDED="false"
declare -a PREBUILD_IMAGE_IDS=()
declare -a PREBUILD_IMAGE_PRESERVATION_REFS=()
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

revision_resolves_to_commit () {
	local revision="$1"
	local expected_sha="$2"
	local resolved
	[[ "$revision" =~ ^[0-9a-f]{7,40}$ ]] || return 1
	resolved="$(git -C "$ROOT" rev-parse --verify --quiet "${revision}^{commit}")" || return 1
	[[ "$resolved" == "$expected_sha" ]]
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

assert_no_peer_source_cost_ambient_override () {
	if [[ "${HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS+set}" == "set" ]]; then
		fail "HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS must be configured only in .env.hub, not the invoking environment"
	fi
}

assert_no_multi_target_ambient_override () {
	if [[ "${HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS+set}" == "set" ]]; then
		fail "HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS must be configured only in .env.hub, not the invoking environment"
	fi
}

previous_application_is_pre_0011 () {
	local version
	if [[ "$SIMULATE" == "1" ]]; then
		version="${HUB_RELEASE_TEST_PREVIOUS_MIGRATION_VERSION:-0010}"
	else
		version="$(git -C "$ROOT" show "${PREVIOUS_SHA}:server/src/migration-version.js" 2>/dev/null \
			| sed -nE 's/.*HUB_REQUIRED_MIGRATION_VERSION = \"([0-9]{4})\".*/\1/p' \
			| head -n 1)"
	fi
	[[ -z "$version" || "$version" < "0011" ]]
}

assert_no_account_entitlement_ambient_override () {
	local name
	for name in \
		HUB_ACCOUNT_ENTITLEMENTS_ENABLED \
		HUB_ACCOUNT_IDENTITY_LINKING_ENABLED \
		HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS \
		HUB_INVITE_ACCOUNT_ADMISSION_ENABLED \
		HUB_OPERATOR_ACCOUNT_IDS; do
		if [[ "${!name+set}" == "set" ]]; then
			fail "${name} must be configured only in .env.hub, not the invoking environment"
		fi
	done
}

assert_account_entitlement_config () {
	local entitlement_enabled identity_linking_enabled retention_providers invite_enabled operator_ids
	entitlement_enabled="$(env_value HUB_ACCOUNT_ENTITLEMENTS_ENABLED 2>/dev/null || true)"
	identity_linking_enabled="$(env_value HUB_ACCOUNT_IDENTITY_LINKING_ENABLED 2>/dev/null || true)"
	retention_providers="$(env_value HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS 2>/dev/null || true)"
	invite_enabled="$(env_value HUB_INVITE_ACCOUNT_ADMISSION_ENABLED 2>/dev/null || true)"
	operator_ids="$(env_value HUB_OPERATOR_ACCOUNT_IDS 2>/dev/null || true)"
	if [[ "$invite_enabled" == "true" && "$entitlement_enabled" != "true" ]]; then
		fail "HUB_INVITE_ACCOUNT_ADMISSION_ENABLED requires HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true"
	fi
	if [[ "$entitlement_enabled" == "true" && -z "$operator_ids" ]]; then
		fail "HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true requires HUB_OPERATOR_ACCOUNT_IDS"
	fi
	if [[ "$identity_linking_enabled" == "true" && -z "$retention_providers" ]]; then
		fail "HUB_ACCOUNT_IDENTITY_LINKING_ENABLED=true requires HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS"
	fi
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

compose_recovery () {
	env -u HUB_RECOVERY_BFF_IMAGE -u HUB_RECOVERY_BACKUP_IMAGE docker compose \
		--project-directory "$ROOT" \
		--env-file "$ENV_FILE" \
		-f "$ROOT/compose.hub.yml" \
		-f "$ROOT/compose.hub.public.yml" \
		-f "$ROOT/compose.hub.recovery-mode.yml" \
		"$@"
}

resolve_recovery_configuration_fingerprint () {
	compose_current config --format json 2>/dev/null \
		| "$HELPER" configuration-fingerprint --compose-config -
}

resolve_recovery_image_references () {
	compose_recovery config --format json 2>/dev/null \
		| "$HELPER" recovery-image-references --compose-config -
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

assert_hub_compose_scope () {
	local compose_function="$1"
	local services
	local service
	"$compose_function" --profile "*" config --quiet
	services="$("$compose_function" --profile "*" config --services)" \
		|| fail "could not enumerate the complete Hub Compose service scope"
	while IFS= read -r service; do
		case "$service" in
			db|migrate|grant-roles|bff|static|edge|maintenance|backup) ;;
			"") ;;
			*)
				fail "release Compose configuration contains non-Hub service: ${service}"
				return 1
				;;
		esac
	done <<<"$services"
}

assert_compose_safe () {
	assert_hub_compose_scope compose_current
}

assert_release_compose_safe () {
	assert_hub_compose_scope compose_release
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
	local project_name image_ref image_id backup_repo_digests
	project_name="$(compose_current config | awk '$1 == "name:" {print $2; exit}')"
	[[ -n "$project_name" ]] || fail "could not resolve the Compose project name"
	PREBUILD_IMAGE_IDS=()
	PREBUILD_IMAGE_PRESERVATION_REFS=()
	CANDIDATE_IMAGE_REFS=(
		"${project_name}-migrate"
		"${project_name}-grant-roles"
		"${project_name}-bff"
		"${project_name}-static"
		"${project_name}-backup"
	)
	local index
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		image_id="$(docker image inspect --format '{{.Id}}' "$image_ref")" \
			|| fail "current release image is missing: ${image_ref}"
		[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "current release image is not immutable: ${image_ref}"
		PREBUILD_IMAGE_IDS[index]="$image_id"
	done
	PREVIOUS_BACKUP_IMAGE_ID="${PREBUILD_IMAGE_IDS[4]}"
	backup_repo_digests="$(docker image inspect --format '{{json .RepoDigests}}' "$PREVIOUS_BACKUP_IMAGE_ID")"
	record previous_backup_image_id "$PREVIOUS_BACKUP_IMAGE_ID"
	record previous_backup_image_ref "${CANDIDATE_IMAGE_REFS[4]}"
	record previous_backup_repo_digests "$backup_repo_digests"
	export HUB_RELEASE_MIGRATE_IMAGE="${PREBUILD_IMAGE_IDS[0]}"
	export HUB_RELEASE_GRANT_ROLES_IMAGE="${PREBUILD_IMAGE_IDS[1]}"
	export HUB_RELEASE_BFF_IMAGE="${PREBUILD_IMAGE_IDS[2]}"
	export HUB_RELEASE_STATIC_IMAGE="${PREBUILD_IMAGE_IDS[3]}"
	export HUB_RELEASE_BACKUP_IMAGE="$PREVIOUS_BACKUP_IMAGE_ID"
	assert_release_compose_safe
}

remove_candidate_image_preservation_tags () {
	local index preservation_ref matching_ids
	local failed="false"
	for index in "${!PREBUILD_IMAGE_PRESERVATION_REFS[@]}"; do
		preservation_ref="${PREBUILD_IMAGE_PRESERVATION_REFS[$index]}"
		[[ -n "$preservation_ref" ]] || continue
		if docker image inspect "$preservation_ref" >/dev/null 2>&1; then
			if docker image rm "$preservation_ref" >/dev/null; then
				PREBUILD_IMAGE_PRESERVATION_REFS[index]=""
				continue
			fi
			log "Failed to remove preserved image tag ${preservation_ref}."
			failed="true"
			continue
		fi
		if ! matching_ids="$(docker image ls --quiet --no-trunc "$preservation_ref")"; then
			log "Failed to determine whether preserved image tag ${preservation_ref} still exists."
			failed="true"
		elif [[ -n "$matching_ids" ]]; then
			log "Preserved image tag ${preservation_ref} exists but could not be inspected."
			failed="true"
		else
			PREBUILD_IMAGE_PRESERVATION_REFS[index]=""
		fi
	done
	if [[ "$failed" == "false" ]]; then
		PREBUILD_IMAGE_PRESERVATION_REFS=()
		return 0
	fi
	return 1
}

candidate_image_tags_are_preserved () {
	local index
	((${#CANDIDATE_IMAGE_REFS[@]})) || return 1
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		[[ -n "${PREBUILD_IMAGE_PRESERVATION_REFS[$index]:-}" ]] || return 1
	done
}

preserve_candidate_image_tags () {
	local preservation_suffix="hub-release-preserve-${RELEASE_ID}"
	local index image_ref old_id preservation_ref preservation_id
	[[ "${#preservation_suffix}" -le 128 ]] \
		|| fail "release identity is too long for Docker preservation tags"
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		old_id="${PREBUILD_IMAGE_IDS[$index]}"
		preservation_ref="${image_ref}:${preservation_suffix}"
		if docker image inspect "$preservation_ref" >/dev/null 2>&1; then
			if ! remove_candidate_image_preservation_tags; then
				fail "preservation tag collision detected, and earlier preservation tags require manual cleanup"
				return 1
			fi
			fail "preservation image tag already exists: ${preservation_ref}"
			return 1
		fi
		if ! docker image tag "$image_ref" "$preservation_ref" >/dev/null; then
			if ! remove_candidate_image_preservation_tags; then
				fail "could not preserve ${image_ref}, and partial preservation tags require manual cleanup"
				return 1
			fi
			fail "could not preserve current release image: ${image_ref}"
			return 1
		fi
		PREBUILD_IMAGE_PRESERVATION_REFS[index]="$preservation_ref"
		preservation_id="$(docker image inspect --format '{{.Id}}' "$preservation_ref")" || {
			if ! remove_candidate_image_preservation_tags; then
				fail "could not verify ${preservation_ref}, and partial preservation tags require manual cleanup"
				return 1
			fi
			fail "could not verify preserved release image: ${preservation_ref}"
			return 1
		}
		if [[ "$preservation_id" != "$old_id" ]]; then
			if ! remove_candidate_image_preservation_tags; then
				fail "preserved image identity changed, and partial preservation tags require manual cleanup"
				return 1
			fi
			fail "preserved image identity changed for ${image_ref}"
			return 1
		fi
	done
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		record "previous_image_${index}_id" "${PREBUILD_IMAGE_IDS[$index]}"
		record "previous_image_${index}_preservation_ref" "${PREBUILD_IMAGE_PRESERVATION_REFS[$index]}"
	done
	record previous_images_preserved true
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
		if ((index < 3 || index == 4)); then
			revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")"
			[[ "$revision" == "$TARGET_SHA" ]] \
				|| fail "candidate image ${image_ref} revision label does not match ${TARGET_SHA}"
		fi
	done
	export HUB_RELEASE_MIGRATE_IMAGE="${CANDIDATE_IMAGE_IDS[0]}"
	export HUB_RELEASE_GRANT_ROLES_IMAGE="${CANDIDATE_IMAGE_IDS[1]}"
	export HUB_RELEASE_BFF_IMAGE="${CANDIDATE_IMAGE_IDS[2]}"
	export HUB_RELEASE_STATIC_IMAGE="${CANDIDATE_IMAGE_IDS[3]}"
	export HUB_RELEASE_BACKUP_IMAGE="${CANDIDATE_IMAGE_IDS[4]}"
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
	[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"$HUB_RELEASE_BACKUP_IMAGE")" == "$TARGET_SHA" ]] \
		|| fail "approved backup image revision no longer matches the verified tag"
	assert_release_compose_safe
}

restore_candidate_image_tags () {
	local index image_ref old_id preservation_ref preserved_id restored_id
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		old_id="${PREBUILD_IMAGE_IDS[$index]:-}"
		preservation_ref="${PREBUILD_IMAGE_PRESERVATION_REFS[$index]:-}"
		[[ -n "$old_id" && -n "$preservation_ref" ]] || return 1
		preserved_id="$(docker image inspect --format '{{.Id}}' "$preservation_ref")" || return 1
		[[ "$preserved_id" == "$old_id" ]] || return 1
	done
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		preservation_ref="${PREBUILD_IMAGE_PRESERVATION_REFS[$index]}"
		docker image tag "$preservation_ref" "$image_ref" >/dev/null || return 1
	done
	for index in "${!CANDIDATE_IMAGE_REFS[@]}"; do
		image_ref="${CANDIDATE_IMAGE_REFS[$index]}"
		old_id="${PREBUILD_IMAGE_IDS[$index]}"
		restored_id="$(docker image inspect --format '{{.Id}}' "$image_ref")" || return 1
		[[ "$restored_id" == "$old_id" ]] || return 1
	done
}

restore_candidate_image_tags_and_cleanup () {
	restore_candidate_image_tags || return 1
	remove_candidate_image_preservation_tags || return 1
	replace_record previous_images_preserved false
}

assert_clean_root () {
	local status
	status="$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all)"
	[[ -z "$status" ]] || fail "deployment checkout is dirty; commit/remove release-source changes first"
	[[ ! -f "$ROOT/.git/MERGE_HEAD" ]] || fail "deployment checkout has an unfinished merge"
}

validate_first_use_environment () {
	local -a handoff=(
		"$INHERITED_LOCK_FD"
		"$FIRST_USE_PREVIOUS_SHA"
		"$FIRST_USE_PREVIOUS_TAG"
		"$FIRST_USE_PREVIOUS_BFF_IMAGE_ID"
		"$FIRST_USE_PREVIOUS_STATIC_IMAGE_ID"
		"$FIRST_USE_PREVIOUS_BACKUP_IMAGE_ID"
		"$FIRST_USE_PREVIOUS_CONFIG_SHA256"
	)
	if [[ "$FIRST_USE" == "1" ]]; then
		local value
		for value in "${handoff[@]}"; do
			[[ -n "$value" ]] || fail "first-release handoff is incomplete"
		done
		[[ "$INHERITED_LOCK_FD" == "9" ]] || fail "first-release handoff must inherit release lock FD 9"
		[[ "$FIRST_USE_PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "first-release previous SHA is invalid"
		[[ "$FIRST_USE_PREVIOUS_TAG" =~ ^hub-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
			|| fail "first-release previous tag is invalid"
		for value in \
			"$FIRST_USE_PREVIOUS_BFF_IMAGE_ID" \
			"$FIRST_USE_PREVIOUS_STATIC_IMAGE_ID" \
			"$FIRST_USE_PREVIOUS_BACKUP_IMAGE_ID"; do
			[[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "first-release image handoff is invalid"
		done
		[[ "$FIRST_USE_PREVIOUS_CONFIG_SHA256" =~ ^[0-9a-f]{64}$ ]] \
			|| fail "first-release previous config hash is invalid"
		return 0
	fi
	[[ "$FIRST_USE" == "0" ]] || fail "HUB_RELEASE_FIRST_USE must be 0 or 1"
	local value
	for value in "${handoff[@]}"; do
		[[ -z "$value" ]] || fail "first-release handoff variables require HUB_RELEASE_FIRST_USE=1"
	done
}

configure_previous_release_identity () {
	if [[ "$FIRST_USE" == "1" ]]; then
		[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] \
			|| fail "first-release candidate checkout does not match ${TARGET_SHA}"
		PREVIOUS_SHA="$FIRST_USE_PREVIOUS_SHA"
		PREVIOUS_TAG="$FIRST_USE_PREVIOUS_TAG"
		CONTROL_SHA="$FIRST_USE_PREVIOUS_SHA"
		[[ "$PREVIOUS_SHA" != "$TARGET_SHA" ]] || fail "first-release previous SHA matches the candidate"
		[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${PREVIOUS_TAG}")" == "tag" ]] \
			|| fail "first-release rollback tag ${PREVIOUS_TAG} is not annotated"
		[[ "$(git -C "$ROOT" rev-parse "refs/tags/${PREVIOUS_TAG}^{}")" == "$PREVIOUS_SHA" ]] \
			|| fail "first-release rollback tag does not resolve to ${PREVIOUS_SHA}"
		git -C "$ROOT" merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA" \
			|| fail "first-release candidate does not descend from ${PREVIOUS_SHA}"
		CONTROL_SHA="$PREVIOUS_SHA"
		SOURCE_CHECKED_OUT="true"
		return 0
	fi

	CONTROL_SHA="$(git -C "$ROOT" rev-parse HEAD)"
	local active_state="${HOME}/.local/state/thelemar-hub/recovery/active-fallback.tsv"
	if [[ -e "$active_state" ]]; then
		[[ "$RECOVERY_REQUIRED" == "true" ]] \
			|| fail "active full-workflow fallback state requires an A7-compatible release"
		local target_protocol target_migration state_binding
		target_protocol="$(git -C "$ROOT" show "${TARGET_SHA}:js/hub/hub-capabilities.js" \
			| sed -nE 's/.*HUB_PROTOCOL_VERSION = "([0-9]+)".*/\1/p' | head -n 1)"
		target_migration="$(git -C "$ROOT" show "${TARGET_SHA}:server/src/migration-version.js" \
			| sed -nE 's/.*HUB_REQUIRED_MIGRATION_VERSION = "([0-9]{4})".*/\1/p' | head -n 1)"
		state_binding="${RELEASE_DIR}/active-recovery-state.tsv"
		"$HELPER" recovery-state \
			--state "$active_state" \
			--git-root "$ROOT" \
			--current-sha "$CONTROL_SHA" \
			--candidate-sha "$TARGET_SHA" \
			--candidate-protocol "$target_protocol" \
			--candidate-migration "$target_migration" \
			--configuration-sha256 "$RECOVERY_B_CONFIGURATION_SHA256" >"$state_binding" \
			|| fail "active qualified fallback state does not support this forward release"
		RECOVERY_ACTIVE_STATE="true"
		PREVIOUS_SHA="$(awk -F '\t' '$1 == "source_sha" {print $2}' "$state_binding")"
		PREVIOUS_TAG="$(awk -F '\t' '$1 == "source_tag_name" {print $2}' "$state_binding")"
		[[ "$(awk -F '\t' '$1 == "source_tag_object_sha" {print $2}' "$state_binding")" == \
			"$(git -C "$ROOT" rev-parse "refs/tags/${PREVIOUS_TAG}")" ]] \
			|| fail "active fallback annotated tag object changed"
		return 0
	fi

	PREVIOUS_SHA="$CONTROL_SHA"
	PREVIOUS_TAG="$(git -C "$ROOT" describe --tags --exact-match "$PREVIOUS_SHA" 2>/dev/null || true)"
	[[ -n "$PREVIOUS_TAG" ]] || fail "current deployment HEAD must have an exact rollback tag"
	[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${PREVIOUS_TAG}")" == "tag" ]] \
		|| fail "current rollback tag ${PREVIOUS_TAG} is not annotated"
	if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" && "$ALLOW_REDEPLOY" != "true" ]]; then
		fail "${TAG} is already deployed; use --allow-redeploy for an explicit rebuild"
	fi
}

validate_first_use_image_handoff () {
	local actual_bff_image_id="$1"
	local actual_static_image_id="$2"
	local actual_backup_image_id="$3"
	local bff_revision backup_revision
	[[ "$FIRST_USE" == "1" ]] || return 0
	[[ "$actual_bff_image_id" == "$FIRST_USE_PREVIOUS_BFF_IMAGE_ID" ]] \
		|| fail "running BFF image changed after the first-release handoff"
	[[ "$actual_static_image_id" == "$FIRST_USE_PREVIOUS_STATIC_IMAGE_ID" ]] \
		|| fail "running static image changed after the first-release handoff"
	[[ "$actual_backup_image_id" == "$FIRST_USE_PREVIOUS_BACKUP_IMAGE_ID" ]] \
		|| fail "backup image changed after the first-release handoff"
	bff_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$actual_bff_image_id")"
	backup_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$actual_backup_image_id")"
	revision_resolves_to_commit "$bff_revision" "$PREVIOUS_SHA" \
		|| fail "running BFF image revision does not match the first-release rollback SHA"
	revision_resolves_to_commit "$backup_revision" "$PREVIOUS_SHA" \
		|| fail "backup image revision does not match the first-release rollback SHA"
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
	local rollback_checkout_sha="$PREVIOUS_SHA"
	if [[ "$RECOVERY_ACTIVE_STATE" == "true" ]]; then
		log "Restoring the active qualified fallback application from ${PREVIOUS_TAG} (${PREVIOUS_SHA}) while retaining release engine ${CONTROL_SHA}; the database is not changed."
		restore_control_engine_checkout || return 1
	else
		log "Rolling the application back to ${PREVIOUS_TAG} (${PREVIOUS_SHA}); the database is not changed."
		git -C "$ROOT" checkout --detach "$rollback_checkout_sha" >/dev/null || return 1
	fi
	SOURCE_CHECKED_OUT="false"
	restore_candidate_image_tags || return 1
	if remove_candidate_image_preservation_tags; then
		replace_record previous_images_preserved false
		replace_record rollback_preservation_cleanup succeeded
	else
		replace_record rollback_preservation_cleanup failed
		log "Previous image tags were restored, but preservation-tag cleanup failed; remove the recorded preservation references manually after rollback verification."
	fi
	export HUB_IMAGE_VERSION="$PREVIOUS_TAG"
	export HUB_VCS_REF="$PREVIOUS_SHA"
	compose_current up -d --no-deps --force-recreate --wait bff static || return 1
	compose_current up -d --no-deps --force-recreate edge || return 1
	export_monitor_environment || return 1
	wait_for_public_ready || return 1
	"$ROOT/deploy/hub/monitor-host.sh" || return 1
	replace_record rollback_result succeeded || return 1
}

restore_control_engine_checkout () {
	trace "rollback-control-engine-restore"
	git -C "$ROOT" checkout --detach "$CONTROL_SHA" >/dev/null || return 1
	[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$CONTROL_SHA" ]] || return 1
	[[ "$(sha256_file "$ROOT/deploy/hub/release.sh")" == "$EXECUTING_ENGINE_SCRIPT_SHA256" ]] || return 1
	[[ "$(sha256_file "$ROOT/deploy/hub/release-helper.py")" == "$EXECUTING_ENGINE_HELPER_SHA256" ]] || return 1
	SOURCE_CHECKED_OUT="false"
}

is_bff_quiesced () {
	local container_ids
	container_ids="$(compose_current ps -q --all bff 2>/dev/null)" || return 1
	local container_id state
	while IFS= read -r container_id; do
		[[ -n "$container_id" ]] || continue
		state="$(docker inspect --format '{{.State.Running}} {{.State.Restarting}}' "$container_id" 2>/dev/null)" \
			|| return 1
		[[ "$state" == "false false" ]] || return 1
	done <<<"$container_ids"
	return 0
}

quiesce_bff_writes () {
	if [[ "$SIMULATE" == "1" ]]; then
		QUIESCE_CALL_COUNT=$((QUIESCE_CALL_COUNT + 1))
		local mode="${HUB_RELEASE_TEST_QUIESCE_MODE:-success}"
		[[ "${HUB_RELEASE_TEST_QUIESCE_FAIL:-false}" != "true" ]] || mode="all-fail"
		trace "rollback-quiesce-attempt-1"
		case "$mode" in
			success) BFF_QUIESCED="true"; return 0 ;;
			first-success-rest-fail)
				if ((QUIESCE_CALL_COUNT == 1)); then
					BFF_QUIESCED="true"
					return 0
				fi
				trace "rollback-quiesce-attempt-2"
				trace "rollback-quiesce-fallback"
				BFF_QUIESCED="false"
				return 1
				;;
			first-fail-second-success)
				trace "rollback-quiesce-attempt-2"
				BFF_QUIESCED="true"
				return 0
				;;
			both-fail-fallback-success)
				trace "rollback-quiesce-attempt-2"
				trace "rollback-quiesce-fallback"
				BFF_QUIESCED="true"
				return 0
				;;
			all-fail)
				trace "rollback-quiesce-attempt-2"
				trace "rollback-quiesce-fallback"
				BFF_QUIESCED="false"
				return 1
				;;
			*) fail "unknown release-test quiesce mode ${mode}" ;;
		esac
	fi

	local attempt
	for attempt in 1 2; do
		trace "rollback-quiesce-attempt-${attempt}"
		compose_current stop bff >/dev/null 2>&1 || true
		if is_bff_quiesced; then
			BFF_QUIESCED="true"
			return 0
		fi
	done

	trace "rollback-quiesce-fallback"
	local container_ids
	container_ids="$(compose_current ps -q --all bff 2>/dev/null)" || return 1
	local container_id
	while IFS= read -r container_id; do
		[[ -n "$container_id" ]] || continue
		docker stop --time 10 "$container_id" >/dev/null 2>&1 || true
	done <<<"$container_ids"
	if is_bff_quiesced; then
		BFF_QUIESCED="true"
		return 0
	fi
	BFF_QUIESCED="false"
	return 1
}

classify_multi_target_rollback_preflight () {
	local file="$1"
	local status="$2"
	python3 - "$file" "$status" <<'PY'
import json
import sys

path, raw_status = sys.argv[1], sys.argv[2]
try:
	status = int(raw_status)
	with open(path, encoding="utf-8") as handle:
		result = json.load(handle)
	if result.get("target") != "pre-0011" or not isinstance(result.get("blockers"), list):
		raise ValueError("invalid preflight shape")
	compatible = result.get("compatible")
	recognized = {"USAGE_MARKER_PRESENT", "MULTI_TARGET_HISTORY_PRESENT"}
	blockers = result["blockers"]
	if status == 0 and compatible is True and blockers == []:
		print("compatible")
	elif status == 2 and compatible is False and blockers and set(blockers) <= recognized:
		blockers = set(blockers)
		if "USAGE_MARKER_PRESENT" in blockers:
			print("multi-target-usage-marker-present")
		elif "MULTI_TARGET_HISTORY_PRESENT" in blockers:
			print("multi-target-history-present")
		else:
			print("multi-target-preflight-incompatible")
	else:
		print("multi-target-rollback-preflight-failed")
except Exception:
	print("multi-target-rollback-preflight-failed")
PY
}

classify_recovery_preflight () {
	local file="$1"
	local status="$2"
	python3 - "$file" "$status" <<'PY'
import json
import sys

try:
	status = int(sys.argv[2])
	with open(sys.argv[1], encoding="utf-8") as handle:
		result = json.load(handle)
	if result.get("target") != "qualified-full-workflow-fallback" or not isinstance(result.get("blockers"), list):
		raise ValueError("invalid recovery preflight shape")
	if status == 0 and result.get("compatible") is True and result["blockers"] == []:
		print("compatible")
	elif status == 2 and result.get("compatible") is False and result["blockers"]:
		print("history-incompatible")
	else:
		print("recovery-preflight-failed")
except Exception:
	print("recovery-preflight-failed")
PY
}

read_recovery_binding () {
	local binding="$1"
	RECOVERY_B_SOURCE_SHA="$(awk -F '\t' '$1 == "source_sha" {print $2}' "$binding")"
	RECOVERY_B_SOURCE_TREE_SHA="$(awk -F '\t' '$1 == "source_tree_sha" {print $2}' "$binding")"
	RECOVERY_B_TAG_NAME="$(awk -F '\t' '$1 == "source_tag_name" {print $2}' "$binding")"
	RECOVERY_B_TAG_OBJECT_SHA="$(awk -F '\t' '$1 == "source_tag_object_sha" {print $2}' "$binding")"
	RECOVERY_B_PROTOCOL_VERSION="$(awk -F '\t' '$1 == "protocol_version" {print $2}' "$binding")"
	RECOVERY_B_REQUIRED_MIGRATION_VERSION="$(awk -F '\t' '$1 == "required_migration_version" {print $2}' "$binding")"
	RECOVERY_B_SCHEMA_COMPATIBLE_THROUGH="$(awk -F '\t' '$1 == "schema_compatible_through" {print $2}' "$binding")"
	RECOVERY_B_BFF_IMAGE_ID="$(awk -F '\t' '$1 == "bff_image_id" {print $2}' "$binding")"
	RECOVERY_B_STATIC_IMAGE_ID="$(awk -F '\t' '$1 == "static_image_id" {print $2}' "$binding")"
	RECOVERY_B_OPERATIONS_IMAGE_ID="$(awk -F '\t' '$1 == "operations_image_id" {print $2}' "$binding")"
	RECOVERY_B_MANIFEST_SHA256="$(awk -F '\t' '$1 == "manifest_sha256" {print $2}' "$binding")"
	RECOVERY_B_QUALIFICATION_SHA256="$(awk -F '\t' '$1 == "qualification_evidence_sha256" {print $2}' "$binding")"
	RECOVERY_B_CONFIGURATION_SHA256="$(awk -F '\t' '$1 == "configuration_sha256" {print $2}' "$binding")"
}

write_recovery_mode () {
	local status="$1"
	local state_dir="${HOME}/.local/state/thelemar-hub/recovery"
	local state_file="${state_dir}/active-fallback.tsv"
	local env_file="${state_dir}/active-fallback.env"
	local blocked_file="${state_dir}/active-fallback.blocked"
	local image_refs bff_ref static_ref backup_ref maintenance_ref
	local temporary_state="" temporary_env="" temporary_blocked=""
	local reference image_id index
	local -a resolved_image_refs=()
	local -a image_ids=("$RECOVERY_B_BFF_IMAGE_ID" "$RECOVERY_B_STATIC_IMAGE_ID" "$RECOVERY_B_OPERATIONS_IMAGE_ID")
	[[ "$status" == "starting" || "$status" == "active" || "$status" == "blocked" ]] || {
		log "ERROR: invalid recovery-mode state"
		return 1
	}
	trace "recovery-mode-status:${status}"
	image_refs="$(resolve_recovery_image_references)" || {
		log "ERROR: could not resolve recovery-mode image references"
		return 1
	}
	local image_ref
	while IFS= read -r image_ref; do
		resolved_image_refs[${#resolved_image_refs[@]}]="$image_ref"
	done <<<"$image_refs"
	((${#resolved_image_refs[@]} == 4)) || {
		log "ERROR: recovery-mode Compose did not resolve all four image references"
		return 1
	}
	bff_ref="${resolved_image_refs[0]}"
	static_ref="${resolved_image_refs[1]}"
	backup_ref="${resolved_image_refs[2]}"
	maintenance_ref="${resolved_image_refs[3]}"
	[[ "$maintenance_ref" == "$bff_ref" ]] || {
		log "ERROR: maintenance image does not resolve to the qualified fallback BFF"
		return 1
	}
	[[ "${#CANDIDATE_IMAGE_IDS[@]}" -ge 5 ]] || {
		log "ERROR: control release-engine images are incomplete for recovery mode"
		return 1
	}
	[[ "$EXECUTING_ENGINE_SOURCE_SHA" == "$CONTROL_SHA" \
		&& "$EXECUTING_ENGINE_TREE_SHA" == "$(git -C "$ROOT" rev-parse "${CONTROL_SHA}^{tree}")" ]] || {
		log "ERROR: the executing release engine does not match the preserved control checkout"
		return 1
	}
	mkdir -p "$state_dir" && chmod 700 "$state_dir" || {
		log "ERROR: could not secure recovery-mode state directory"
		return 1
	}
	if [[ "$status" == "starting" || "$status" == "blocked" ]]; then
		[[ ! -d "$blocked_file" && ! -L "$blocked_file" ]] || {
			log "CRITICAL: the recovery job fence path is not a regular file"
			return 1
		}
		temporary_blocked="$(mktemp "${blocked_file}.tmp.XXXXXX")" || {
			log "CRITICAL: could not prepare the recovery job fence"
			return 1
		}
		printf '%s\n' "$status" >"$temporary_blocked" || {
			rm -f -- "$temporary_blocked"
			log "CRITICAL: could not write the recovery job fence"
			return 1
		}
		chmod 600 "$temporary_blocked" && mv -f -- "$temporary_blocked" "$blocked_file" || {
			rm -f -- "$temporary_blocked"
			log "CRITICAL: could not persist the recovery job fence"
			return 1
		}
	fi
	for reference in "$state_file" "$env_file"; do
		[[ ! -d "$reference" && ! -L "$reference" ]] || {
			log "CRITICAL: recovery-mode state or job environment path is not a regular file"
			return 1
		}
	done
	for index in 0 1 2; do
		image_id="${image_ids[$index]}"
		case "$index" in
			0) reference="$bff_ref" ;;
			1) reference="$static_ref" ;;
			2) reference="$backup_ref" ;;
		esac
		docker image tag "$image_id" "$reference" || {
			log "ERROR: could not bind qualified fallback image ${reference}"
			return 1
		}
		local resolved_image_id
		resolved_image_id="$(docker image inspect --format '{{.Id}}' "$reference")" || {
			log "ERROR: could not inspect qualified fallback image ${reference}"
			return 1
		}
		[[ "$resolved_image_id" == "$image_id" ]] || {
			log "ERROR: qualified fallback image reference did not resolve to its pinned ID"
			return 1
		}
	done

	temporary_state="$(mktemp "${state_file}.tmp.XXXXXX")" || {
		log "ERROR: could not prepare recovery-mode state"
		return 1
	}
	temporary_env="$(mktemp "${env_file}.tmp.XXXXXX")" || {
		rm -f -- "$temporary_state"
		log "ERROR: could not prepare recovery-mode job environment"
		return 1
	}
	{
		printf 'status\t%s\n' "$status"
		printf 'source_sha\t%s\n' "$RECOVERY_B_SOURCE_SHA"
		printf 'source_tree_sha\t%s\n' "$RECOVERY_B_SOURCE_TREE_SHA"
		printf 'source_tag_name\t%s\n' "$RECOVERY_B_TAG_NAME"
		printf 'source_tag_object_sha\t%s\n' "$RECOVERY_B_TAG_OBJECT_SHA"
		printf 'protocol_version\t%s\n' "$RECOVERY_B_PROTOCOL_VERSION"
		printf 'required_migration_version\t%s\n' "$RECOVERY_B_REQUIRED_MIGRATION_VERSION"
		printf 'schema_compatible_through\t%s\n' "$RECOVERY_B_SCHEMA_COMPATIBLE_THROUGH"
		printf 'bff_image_id\t%s\n' "$RECOVERY_B_BFF_IMAGE_ID"
		printf 'static_image_id\t%s\n' "$RECOVERY_B_STATIC_IMAGE_ID"
		printf 'operations_image_id\t%s\n' "$RECOVERY_B_OPERATIONS_IMAGE_ID"
		printf 'bff_image_ref\t%s\n' "$bff_ref"
		printf 'static_image_ref\t%s\n' "$static_ref"
		printf 'backup_image_ref\t%s\n' "$backup_ref"
		printf 'maintenance_image_ref\t%s\n' "$maintenance_ref"
		printf 'configuration_sha256\t%s\n' "$RECOVERY_B_CONFIGURATION_SHA256"
		printf 'manifest_sha256\t%s\n' "$RECOVERY_B_MANIFEST_SHA256"
		printf 'qualification_evidence_sha256\t%s\n' "$RECOVERY_B_QUALIFICATION_SHA256"
		printf 'executing_engine_source_sha\t%s\n' "$EXECUTING_ENGINE_SOURCE_SHA"
		printf 'executing_engine_tree_sha\t%s\n' "$EXECUTING_ENGINE_TREE_SHA"
		printf 'control_source_sha\t%s\n' "$CONTROL_SHA"
		printf 'control_tree_sha\t%s\n' "$EXECUTING_ENGINE_TREE_SHA"
		printf 'control_release_script_sha256\t%s\n' "$EXECUTING_ENGINE_SCRIPT_SHA256"
		printf 'control_helper_sha256\t%s\n' "$EXECUTING_ENGINE_HELPER_SHA256"
		printf 'control_migrate_image_id\t%s\n' "${CANDIDATE_IMAGE_IDS[0]}"
		printf 'control_grant_roles_image_id\t%s\n' "${CANDIDATE_IMAGE_IDS[1]}"
	} >"$temporary_state" || {
		rm -f -- "$temporary_state" "$temporary_env"
		log "ERROR: could not write recovery-mode state"
		return 1
	}
	{
		printf 'HUB_RECOVERY_BFF_IMAGE=%s\n' "$RECOVERY_B_BFF_IMAGE_ID"
		printf 'HUB_RECOVERY_BACKUP_IMAGE=%s\n' "$RECOVERY_B_OPERATIONS_IMAGE_ID"
	} >"$temporary_env" || {
		rm -f -- "$temporary_state" "$temporary_env"
		log "ERROR: could not write recovery-mode job environment"
		return 1
	}
	if ! chmod 600 "$temporary_state" "$temporary_env"; then
		rm -f -- "$temporary_state" "$temporary_env"
		log "ERROR: could not secure recovery-mode state files"
		return 1
	fi
	if ! mv -f -- "$temporary_env" "$env_file"; then
		rm -f -- "$temporary_state" "$temporary_env"
		log "ERROR: could not commit recovery-mode job environment"
		return 1
	fi
	if ! mv -f -- "$temporary_state" "$state_file"; then
		rm -f -- "$temporary_state"
		log "CRITICAL: recovery-mode job environment changed but its state was not committed; scheduled jobs remain fenced"
		return 1
	fi
	if [[ "$status" == "active" ]]; then
		rm -f -- "$blocked_file" || {
			log "CRITICAL: fallback is active but scheduled recovery jobs remain fenced"
			return 1
		}
	fi
	return 0
}

validate_recovery_fallback () {
	if [[ "$SIMULATE" == "1" ]]; then
		RECOVERY_REQUIRED="${HUB_RELEASE_TEST_RECOVERY_REQUIRED:-false}"
		[[ "$RECOVERY_REQUIRED" == "true" || "$RECOVERY_REQUIRED" == "false" ]] \
			|| fail "invalid simulated recovery requirement"
		if [[ "$RECOVERY_REQUIRED" == "true" ]]; then
			[[ "${HUB_RELEASE_TEST_RECOVERY_QUALIFIED:-false}" == "true" ]] \
				|| fail "simulated protocol-6 release lacks an independently qualified full-workflow fallback"
			record recovery_fallback_required true
			record recovery_fallback_qualification_sha256 simulated
		fi
		return 0
	fi

	local target_protocol target_migration active_state_file
	target_protocol="$(git -C "$ROOT" show "${TARGET_SHA}:js/hub/hub-capabilities.js" \
		| sed -nE 's/.*HUB_PROTOCOL_VERSION = "([0-9]+)".*/\1/p' | head -n 1)"
	target_migration="$(git -C "$ROOT" show "${TARGET_SHA}:server/src/migration-version.js" \
		| sed -nE 's/.*HUB_REQUIRED_MIGRATION_VERSION = "([0-9]{4})".*/\1/p' | head -n 1)"
	[[ "$target_protocol" =~ ^[0-9]+$ && "$target_migration" =~ ^[0-9]{4}$ ]] \
		|| fail "candidate protocol or migration identity cannot be verified"
	active_state_file="${HOME}/.local/state/thelemar-hub/recovery/active-fallback.tsv"
	if ((target_protocol < 6)); then
		[[ ! -e "$active_state_file" ]] \
			|| fail "an active full-workflow fallback requires an A7-compatible forward release"
		return 0
	fi
	if [[ "$target_protocol" != "6" ]]; then
		fail "protocol ${target_protocol} requires a newly qualified full-workflow fallback"
		return 1
	fi
	RECOVERY_REQUIRED="true"

	local recovery_dir="${HOME}/.local/state/thelemar-hub/recovery"
	local manifest="${recovery_dir}/qualified-fallback.json"
	local qualification="${recovery_dir}/qualified-fallback-evidence.json"
	local binding="${RELEASE_DIR}/recovery-fallback-binding.tsv"
	local source_migration
	source_migration="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["source"]["requiredMigrationVersion"])' "$manifest")" \
		|| fail "qualified fallback required migration declaration is missing"
	"$HELPER" recovery-manifest \
		--manifest "$manifest" \
		--evidence "$qualification" \
		--git-root "$ROOT" \
		--candidate-sha "$TARGET_SHA" \
		--protocol "$target_protocol" \
		--source-migration "$source_migration" \
		--migration "$target_migration" >"$binding" \
		|| fail "a successful exact-binary HW/LoH-aware fallback qualification is required before protocol-6 promotion"

	read_recovery_binding "$binding"
	local remote_fallback_pair
	remote_fallback_pair="$(resolve_remote_tag "$ROOT" "$RECOVERY_B_TAG_NAME")"
	[[ "$remote_fallback_pair" == "${RECOVERY_B_TAG_OBJECT_SHA}"$'\t'"${RECOVERY_B_SOURCE_SHA}" ]] \
		|| fail "qualified fallback tag identity does not match origin"
	git -C "$ROOT" merge-base --is-ancestor "$RECOVERY_B_SOURCE_SHA" "origin/${EXPECTED_BRANCH}" \
		|| fail "qualified fallback source is not reachable from origin/${EXPECTED_BRANCH}"
	for image_id in "$RECOVERY_B_BFF_IMAGE_ID" "$RECOVERY_B_OPERATIONS_IMAGE_ID"; do
		docker image inspect "$image_id" >/dev/null || fail "qualified fallback image is not present locally"
	done
	[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"$RECOVERY_B_BFF_IMAGE_ID")" == "$RECOVERY_B_SOURCE_SHA" ]] \
		|| fail "qualified fallback BFF revision label does not match its source"
	[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"$RECOVERY_B_STATIC_IMAGE_ID")" == "$RECOVERY_B_SOURCE_SHA" ]] \
		|| fail "qualified fallback static revision label does not match its source"
	[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
		"$RECOVERY_B_OPERATIONS_IMAGE_ID")" == "$RECOVERY_B_SOURCE_SHA" ]] \
		|| fail "qualified fallback operations image revision label does not match its source"
	for image_id in "$RECOVERY_B_BFF_IMAGE_ID" "$RECOVERY_B_STATIC_IMAGE_ID" "$RECOVERY_B_OPERATIONS_IMAGE_ID"; do
		[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image_id")" \
			== "https://github.com/${EXPECTED_REPOSITORY}" ]] \
			|| fail "qualified fallback image source label does not match the repository"
	done
	record recovery_fallback_required true
	record recovery_fallback_candidate_sha "$TARGET_SHA"
	record recovery_fallback_source_sha "$RECOVERY_B_SOURCE_SHA"
	record recovery_fallback_source_tree_sha "$RECOVERY_B_SOURCE_TREE_SHA"
	record recovery_fallback_source_tag "$RECOVERY_B_TAG_NAME"
	record recovery_fallback_source_tag_object_sha "$RECOVERY_B_TAG_OBJECT_SHA"
	record recovery_fallback_protocol_version "$RECOVERY_B_PROTOCOL_VERSION"
	record recovery_fallback_required_migration_version "$RECOVERY_B_REQUIRED_MIGRATION_VERSION"
	record recovery_fallback_bff_image_id "$RECOVERY_B_BFF_IMAGE_ID"
	record recovery_fallback_static_image_id "$RECOVERY_B_STATIC_IMAGE_ID"
	record recovery_fallback_operations_image_id "$RECOVERY_B_OPERATIONS_IMAGE_ID"
	record recovery_fallback_configuration_sha256 "$RECOVERY_B_CONFIGURATION_SHA256"
	record recovery_fallback_manifest_sha256 "$RECOVERY_B_MANIFEST_SHA256"
	record recovery_fallback_qualification_sha256 "$RECOVERY_B_QUALIFICATION_SHA256"
}

revalidate_recovery_fallback_binding () {
	local recovery_dir="${HOME}/.local/state/thelemar-hub/recovery"
	local binding="${RELEASE_DIR}/recovery-boundary-binding.tsv"
	local manifest="${recovery_dir}/qualified-fallback.json"
	local qualification="${recovery_dir}/qualified-fallback-evidence.json"
	local candidate_protocol candidate_migration
	local resolved_configuration configuration_sha256
	candidate_protocol="$(git -C "$ROOT" show "${TARGET_SHA}:js/hub/hub-capabilities.js" \
		| sed -nE 's/.*HUB_PROTOCOL_VERSION = "([0-9]+)".*/\1/p' | head -n 1)"
	candidate_migration="$(git -C "$ROOT" show "${TARGET_SHA}:server/src/migration-version.js" \
		| sed -nE 's/.*HUB_REQUIRED_MIGRATION_VERSION = "([0-9]{4})".*/\1/p' | head -n 1)"
	resolved_configuration="$(resolve_recovery_configuration_fingerprint)" || return 1
	configuration_sha256="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<<"$resolved_configuration")" \
		|| return 1
	"$HELPER" recovery-manifest \
		--manifest "$manifest" \
		--evidence "$qualification" \
		--git-root "$ROOT" \
		--candidate-sha "$TARGET_SHA" \
		--protocol "$RECOVERY_B_PROTOCOL_VERSION" \
		--source-migration "$RECOVERY_B_REQUIRED_MIGRATION_VERSION" \
		--migration "$candidate_migration" \
		--configuration-sha256 "$configuration_sha256" >"$binding" || return 1
	local field expected actual
	for field in source_sha source_tag_object_sha manifest_sha256 qualification_evidence_sha256 configuration_sha256; do
		case "$field" in
			source_sha) expected="$RECOVERY_B_SOURCE_SHA" ;;
			source_tag_object_sha) expected="$RECOVERY_B_TAG_OBJECT_SHA" ;;
			manifest_sha256) expected="$RECOVERY_B_MANIFEST_SHA256" ;;
			qualification_evidence_sha256) expected="$RECOVERY_B_QUALIFICATION_SHA256" ;;
			configuration_sha256) expected="$RECOVERY_B_CONFIGURATION_SHA256" ;;
		esac
		actual="$(awk -F '\t' -v key="$field" '$1 == key {print $2}' "$binding")"
		[[ "$actual" == "$expected" ]] || return 1
	done
	local remote_fallback_pair
	remote_fallback_pair="$(resolve_remote_tag "$ROOT" "$RECOVERY_B_TAG_NAME")" || return 1
	[[ "$remote_fallback_pair" == "${RECOVERY_B_TAG_OBJECT_SHA}"$'\t'"${RECOVERY_B_SOURCE_SHA}" ]] || return 1
	git -C "$ROOT" merge-base --is-ancestor "$RECOVERY_B_SOURCE_SHA" "origin/${EXPECTED_BRANCH}" || return 1
	[[ "$candidate_protocol" == "$RECOVERY_B_PROTOCOL_VERSION" ]] || return 1
}

recover_to_qualified_fallback () {
	local preflight="${RELEASE_DIR}/recovery-fallback-preflight.json"
	local preflight_status classification
	if [[ "$SIMULATE" == "1" ]]; then
		trace "rollback-recovery-check"
		if [[ "${HUB_RELEASE_TEST_RECOVERY_PREFLIGHT_FAILURE:-false}" == "true" ]]; then
			classification="recovery-preflight-failed"
		elif [[ "${HUB_RELEASE_TEST_RECOVERY_COMPATIBLE:-false}" == "true" ]]; then
			classification="compatible"
		else
			classification="history-incompatible"
		fi
	else
		[[ "$RECOVERY_REQUIRED" == "true" \
			&& -n "$RECOVERY_B_SOURCE_SHA" \
			&& -n "$RECOVERY_B_BFF_IMAGE_ID" \
			&& -n "$RECOVERY_B_STATIC_IMAGE_ID" ]] || {
				log "ERROR: qualified fallback identity is incomplete"
				return 1
			}
		trace "rollback-recovery-check"
		compose_release run --rm --no-deps bff node server/scripts/check-recovery-compatibility.mjs \
			>"$preflight" 2>"${RELEASE_DIR}/recovery-fallback-preflight.stderr"
		preflight_status="$?"
		classification="$(classify_recovery_preflight "$preflight" "$preflight_status")"
		record recovery_fallback_preflight_status "$preflight_status"
		record recovery_fallback_preflight_sha256 "$(sha256_file "$preflight")"
	fi

	if [[ "$classification" != "compatible" ]]; then
		log "ERROR: full recovery compatibility preflight rejected fallback classification ${classification}"
		replace_record recovery_fallback_result "$classification"
		return 1
	fi
	replace_record recovery_fallback_preflight compatible
	trace "rollback-qualified-fallback"
	if [[ "$SIMULATE" == "1" ]]; then
		replace_record recovery_fallback_result simulated-compatible
		if [[ "${HUB_RELEASE_TEST_RECOVERY_FAILURE_AFTER_START:-false}" == "true" ]]; then
			BFF_QUIESCED="false"
			RECOVERY_B_STARTED="true"
			return 1
		fi
		return 0
	fi

	revalidate_recovery_fallback_binding || {
		log "ERROR: qualified fallback source or release binding changed during recovery"
		return 1
	}
	local image_refs
	local -a resolved_image_refs=()
	image_refs="$(resolve_recovery_image_references)" || {
		log "ERROR: qualified fallback Compose image resolution failed"
		return 1
	}
	local image_ref
	while IFS= read -r image_ref; do
		resolved_image_refs[${#resolved_image_refs[@]}]="$image_ref"
	done <<<"$image_refs"
	((${#resolved_image_refs[@]} == 4)) || {
		log "ERROR: fallback image resolution did not return all four required service references"
		return 1
	}
	RECOVERY_B_BFF_IMAGE_REF="${resolved_image_refs[0]}"
	RECOVERY_B_STATIC_IMAGE_REF="${resolved_image_refs[1]}"
	RECOVERY_B_BACKUP_IMAGE_REF="${resolved_image_refs[2]}"
	RECOVERY_B_MAINTENANCE_IMAGE_REF="${resolved_image_refs[3]}"
	[[ "$RECOVERY_B_MAINTENANCE_IMAGE_REF" == "$RECOVERY_B_BFF_IMAGE_REF" ]] || {
		log "ERROR: fallback maintenance image does not match the qualified BFF image"
		return 1
	}

	[[ "$(docker image inspect --format '{{.Id}}' "$RECOVERY_B_BFF_IMAGE_ID" 2>/dev/null)" == "$RECOVERY_B_BFF_IMAGE_ID" ]] || {
		log "ERROR: qualified fallback BFF image ID is unavailable"
		return 1
	}
	[[ "$(docker image inspect --format '{{.Id}}' "$RECOVERY_B_STATIC_IMAGE_ID" 2>/dev/null)" == "$RECOVERY_B_STATIC_IMAGE_ID" ]] || {
		log "ERROR: qualified fallback static image ID is unavailable"
		return 1
	}
	[[ "$(docker image inspect --format '{{.Id}}' "$RECOVERY_B_OPERATIONS_IMAGE_ID" 2>/dev/null)" == "$RECOVERY_B_OPERATIONS_IMAGE_ID" ]] || {
		log "ERROR: qualified fallback operations image ID is unavailable"
		return 1
	}

	export HUB_RELEASE_BFF_IMAGE="$RECOVERY_B_BFF_IMAGE_ID"
	export HUB_RELEASE_STATIC_IMAGE="$RECOVERY_B_STATIC_IMAGE_ID"
	export HUB_RELEASE_BACKUP_IMAGE="$RECOVERY_B_OPERATIONS_IMAGE_ID"
	export HUB_IMAGE_VERSION="$RECOVERY_B_TAG_NAME"
	export HUB_VCS_REF="$RECOVERY_B_SOURCE_SHA"
	write_recovery_mode starting || {
		log "ERROR: recovery-mode state transition was rejected before fallback startup"
		return 1
	}
	BFF_QUIESCED="false"
	RECOVERY_B_STARTED="true"
	compose_release up -d --no-deps --pull never --force-recreate --wait bff static 2>/dev/null || {
		log "ERROR: qualified fallback BFF/static services failed to start"
		return 1
	}
	compose_release up -d --no-deps --force-recreate edge 2>/dev/null || {
		log "ERROR: public edge failed to route to the qualified fallback"
		return 1
	}
	export_monitor_environment || {
		log "ERROR: fallback monitor environment could not be prepared"
		return 1
	}
	wait_for_public_ready || {
		log "ERROR: qualified fallback did not pass public readiness"
		return 1
	}
	"$ROOT/deploy/hub/monitor-host.sh" || {
		log "ERROR: qualified fallback host monitor failed"
		return 1
	}
	replace_record recovery_fallback_result succeeded
	replace_record recovery_fallback_deployed_source_sha "$RECOVERY_B_SOURCE_SHA"
	replace_record recovery_fallback_deployed_bff_image_id "$RECOVERY_B_BFF_IMAGE_ID"
	replace_record recovery_fallback_deployed_static_image_id "$RECOVERY_B_STATIC_IMAGE_ID"
	replace_record recovery_fallback_deployed_operations_image_id "$RECOVERY_B_OPERATIONS_IMAGE_ID"
	restore_control_engine_checkout || return 1
	write_recovery_mode active || return 1
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
	if [[ "$TRAFFIC_MUTATED" == "true" \
		&& "$ROLLBACK_COMPATIBLE" == "true" \
		&& "$SCHEMA_HAS_MIGRATION_0011" == "true" \
		&& "$RECOVERY_REQUIRED" != "true" ]] \
		&& previous_application_is_pre_0011; then
		trace "rollback-quiesce"
		if ! quiesce_bff_writes; then
			ROLLBACK_COMPATIBLE="false"
			replace_record rollback_compatible false
			replace_record rollback_incompatibility multi-target-quiesce-failed
			trace "rollback-quiesce-failed"
		else
			replace_record rollback_candidate_quiesced true
			trace "rollback-marker-check"
			if [[ "$SIMULATE" == "1" ]]; then
				if [[ "${HUB_RELEASE_TEST_MULTI_TARGET_USAGE_MARKER_PRESENT:-false}" == "true" ]]; then
					ROLLBACK_COMPATIBLE="false"
					replace_record rollback_compatible false
					replace_record rollback_incompatibility multi-target-usage-marker-present
					trace "rollback-marker-blocked"
				fi
			else
				local rollback_preflight="${RELEASE_DIR}/multi-target-rollback-preflight.json"
				compose_release run --rm --no-deps \
					-e HUB_MULTI_TARGET_ROLLBACK_TARGET=pre-0011 \
					bff node server/scripts/check-multi-target-rollback.mjs >"$rollback_preflight"
				local rollback_preflight_status="$?"
				local rollback_preflight_classification
				rollback_preflight_classification="$(
					classify_multi_target_rollback_preflight "$rollback_preflight" "$rollback_preflight_status"
				)"
				if [[ "$rollback_preflight_classification" != "compatible" ]]; then
					ROLLBACK_COMPATIBLE="false"
					replace_record rollback_compatible false
					replace_record rollback_incompatibility "$rollback_preflight_classification"
					replace_record multi_target_rollback_preflight_status "$rollback_preflight_status"
					record multi_target_rollback_preflight_sha256 "$(sha256_file "$rollback_preflight")"
					if [[ "$rollback_preflight_classification" == "multi-target-rollback-preflight-failed" ]]; then
						log "Automatic rollback is blocked because pre-0011 compatibility could not be verified."
					else
						log "Automatic rollback to the pre-0011 application is blocked by multi-target schema use."
					fi
				fi
			fi
		fi
	fi
	if [[ "$TRAFFIC_MUTATED" == "true" && "$RECOVERY_REQUIRED" == "true" ]]; then
		if [[ "$BFF_QUIESCED" != "true" ]]; then
			trace "rollback-quiesce"
			if ! quiesce_bff_writes; then
				replace_record rollback_incompatibility full-workflow-quiesce-failed
				replace_record rollback_result quiesce-failed-candidate-may-be-live
				trace "rollback-quiesce-failed"
				log "CRITICAL: the candidate BFF could not be stopped; do not start any fallback image."
			else
				replace_record rollback_candidate_quiesced true
			fi
		fi
		if [[ "$BFF_QUIESCED" == "true" ]]; then
			if recover_to_qualified_fallback; then
				replace_record rollback_result qualified-full-workflow-fallback
				replace_record rollback_compatible false
				replace_record rollback_incompatibility qualified-full-workflow-fallback-selected
			else
				replace_record rollback_result forbidden-full-workflow-fallback
				replace_record rollback_compatible false
				replace_record rollback_incompatibility full-workflow-fallback-not-proven
				if [[ "$RECOVERY_B_STARTED" == "true" ]]; then
					trace "fallback-quiesce"
					if ! quiesce_bff_writes; then
						replace_record fallback_b_quiesced false
						replace_record fallback_b_may_still_accept_writes true
						replace_record rollback_result fallback-b-may-still-accept-writes
						replace_record rollback_incompatibility fallback-b-quiesce-failed
						trace "fallback-quiesce-failed"
						log "CRITICAL: the qualified fallback BFF may still accept writes; do not claim isolation. Preserve the database and evidence and fence traffic through the incident procedure."
					else
						replace_record fallback_b_quiesced true
						if [[ "$SIMULATE" != "1" ]]; then
							if ! restore_control_engine_checkout; then
								replace_record recovery_control_engine_restored false
								replace_record recovery_jobs_blocked false
								replace_record rollback_result fallback-quiesced-control-engine-unrestored
								trace "fallback-control-engine-restore-failed"
								log "CRITICAL: the qualified fallback BFF was stopped, but the release-engine checkout was not restored; scheduled jobs remain fenced by the starting marker. Do not claim complete recovery."
							elif write_recovery_mode blocked; then
								replace_record recovery_control_engine_restored true
								replace_record recovery_jobs_blocked true
								trace "isolate"
								log "The qualified fallback BFF was stopped and its scheduled jobs were durably fenced. Preserve the database and evidence for authorized forward recovery."
							else
								replace_record recovery_control_engine_restored true
								replace_record recovery_jobs_blocked false
								replace_record rollback_result fallback-b-quiesced-job-fence-unconfirmed
								log "CRITICAL: the fallback BFF was stopped, but scheduled-job fencing could not be confirmed. Do not claim complete isolation; preserve the database and evidence and use the incident procedure."
							fi
						fi
					fi
				else
					trace "isolate"
					if [[ "$SIMULATE" != "1" ]]; then
						log "The candidate was stopped and the exact qualified fallback could not be proven healthy. Preserve the database and evidence for authorized forward recovery."
					fi
				fi
			fi
		fi
	elif [[ "$SIMULATE" == "1" ]]; then
		if [[ "$TRAFFIC_MUTATED" == "true" && "$ROLLBACK_COMPATIBLE" == "true" ]]; then
			trace "rollback"
			[[ -f "$STATE_FILE" ]] && replace_record rollback_result simulated-compatible
		elif [[ "$TRAFFIC_MUTATED" == "true" ]]; then
			[[ "$BFF_QUIESCED" == "true" ]] || quiesce_bff_writes || true
			if [[ "$BFF_QUIESCED" == "true" ]]; then
				trace "isolate"
				[[ -f "$STATE_FILE" ]] && replace_record rollback_result forbidden-schema-incompatible
			else
				trace "fence-failed"
				[[ -f "$STATE_FILE" ]] && replace_record rollback_result quiesce-failed-candidate-may-be-live
			fi
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
		if [[ "$BFF_QUIESCED" != "true" ]]; then
			quiesce_bff_writes || true
			[[ "$BFF_QUIESCED" != "true" ]] || replace_record rollback_candidate_quiesced true
		fi
		if [[ "$BFF_QUIESCED" == "true" ]]; then
			replace_record rollback_result forbidden-schema-incompatible
			print_isolated_restore_instructions
		else
			replace_record rollback_result quiesce-failed-candidate-may-be-live
			log "CRITICAL: the candidate BFF could not be stopped and may still accept writes. Do not start any previous image; use the incident runbook to fence traffic immediately."
		fi
	elif [[ "$SOURCE_CHECKED_OUT" == "true" && -n "$PREVIOUS_SHA" ]]; then
		if [[ "$SCHEMA_MUTATED" == "true" ]]; then
			replace_record failure_action previous-compatible-app-remains
			log "Schema migrations ${APPLIED_MIGRATIONS} were applied, but traffic was not cut over; the compatible previous application remains running."
			log "The database was not reversed or restored. Correct the release and move forward."
		fi
		local pretraffic_recovered="false"
		if git -C "$ROOT" checkout --detach "$CONTROL_SHA" >/dev/null 2>&1; then
			SOURCE_CHECKED_OUT="false"
			if candidate_image_tags_are_preserved; then
				restore_candidate_image_tags_and_cleanup >/dev/null 2>&1 && pretraffic_recovered="true"
			elif remove_candidate_image_preservation_tags >/dev/null 2>&1; then
				pretraffic_recovered="true"
			fi
		fi
		if [[ "$pretraffic_recovered" == "true" ]]; then
			replace_record pretraffic_recovery succeeded
		else
			replace_record pretraffic_recovery failed
			log "Failed to restore the previous checkout/image tags; running containers were not recreated."
		fi
	elif ((${#PREBUILD_IMAGE_PRESERVATION_REFS[@]})); then
		if remove_candidate_image_preservation_tags; then
			replace_record previous_images_preserved false
			replace_record pretraffic_recovery succeeded
		else
			replace_record pretraffic_recovery failed
			log "Failed to remove pre-build preservation tags; running containers and mutable image tags were not changed."
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

early_first_use_cleanup () {
	local status="$?"
	trap - EXIT
	set +e
	if [[ "$status" -ne 0 \
		&& "$FIRST_USE" == "1" \
		&& -n "$ROOT" \
		&& "$CONTROL_SHA" =~ ^[0-9a-f]{40}$ ]]; then
		git -C "$ROOT" checkout --detach "$CONTROL_SHA" >/dev/null 2>&1 || true
	fi
	exit "$status"
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
	[[ "$TEST_MODE" == "1" || "$LOCK_FILE" == "$SHARED_RELEASE_LOCK_FILE" ]] \
		|| fail "production release lock must match the scheduled-job admission lock"
	assert_no_peer_source_cost_ambient_override
	assert_no_multi_target_ambient_override
	assert_no_account_entitlement_ambient_override
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
	assert_account_entitlement_config

	local required
	for required in \
		compose.hub.yml \
		compose.hub.public.yml \
		compose.hub.release.yml \
		compose.hub.recovery-mode.yml \
		deploy/hub/Caddyfile.public \
		deploy/hub/monitor-host.sh \
		deploy/hub/migration-policy.json \
		deploy/hub/systemd/thelemar-hub-maintenance.service \
		deploy/hub/systemd/thelemar-hub-backup.service; do
		[[ -f "$ROOT/$required" ]] || fail "required release file is missing: ${required}"
	done
	for required in git docker curl openssl python3 flock df stat awk sed; do
		command -v "$required" >/dev/null 2>&1 || fail "required command is missing: ${required}"
	done
	docker info >/dev/null
	docker compose version >/dev/null
	assert_compose_safe

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
	validate_recovery_fallback
	if [[ "${HUB_RELEASE_REQUIRE_SIGNED_TAG:-0}" == "1" ]]; then
		git -C "$ROOT" verify-tag "$TAG"
	fi
	configure_previous_release_identity

	export_monitor_environment
	"$ROOT/deploy/hub/monitor-host.sh"
}

phase_record_rollback () {
	local bff_evidence static_evidence actual_bff_image_id actual_static_image_id
	PREVIOUS_BFF_CONTAINER="$(compose_current ps -q bff)"
	PREVIOUS_STATIC_CONTAINER="$(compose_current ps -q static)"
	[[ -n "$PREVIOUS_BFF_CONTAINER" && -n "$PREVIOUS_STATIC_CONTAINER" ]] \
		|| fail "running BFF/static containers are required for rollback"
	bff_evidence="$(get_container_image_evidence "$PREVIOUS_BFF_CONTAINER" previous_bff)"
	static_evidence="$(get_container_image_evidence "$PREVIOUS_STATIC_CONTAINER" previous_static)"
	IFS=$'\t' read -r actual_bff_image_id _ <<<"$bff_evidence"
	IFS=$'\t' read -r actual_static_image_id _ <<<"$static_evidence"
	capture_candidate_image_tags
	[[ "${PREBUILD_IMAGE_IDS[2]}" == "$actual_bff_image_id" ]] \
		|| fail "current BFF image tag does not match the running rollback image"
	[[ "${PREBUILD_IMAGE_IDS[3]}" == "$actual_static_image_id" ]] \
		|| fail "current static image tag does not match the running rollback image"
	validate_first_use_image_handoff \
		"$actual_bff_image_id" \
		"$actual_static_image_id" \
		"$PREVIOUS_BACKUP_IMAGE_ID"
	preserve_candidate_image_tags

	local migration_status="${RELEASE_DIR}/migration-before.json"
	compose_release run --interactive=false -T --rm --no-deps --pull never migrate \
		node server/scripts/migrate.mjs status >"$migration_status"
	record previous_migration_status_sha256 "$(sha256_file "$migration_status")"
	if [[ "$FIRST_USE" == "1" ]]; then
		record previous_config_sha256 "$FIRST_USE_PREVIOUS_CONFIG_SHA256"
		record previous_config_scope "git-ls-tree:compose.hub.yml,compose.hub.public.yml,deploy/hub/Caddyfile.public"
	else
		record previous_config_sha256 "$(hash_files \
			"$ROOT/compose.hub.yml" \
			"$ROOT/compose.hub.public.yml" \
			"$ROOT/compose.hub.release.yml" \
			"$ROOT/deploy/hub/Caddyfile.public" \
			"$ROOT/deploy/hub/migration-policy.json")"
		record previous_config_scope "release-files"
	fi
	record env_file_sha256 "$(sha256_file "$ENV_FILE")"
	record readiness_before passed
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
	compose_release --profile backup run --interactive=false -T --rm --no-deps --pull never backup \
		node server/scripts/backup-encrypted.mjs "$container_backup"
	local host_backup="${BACKUP_DIR}/${backup_name}"
	[[ -f "$host_backup" ]] || fail "encrypted backup was not created at ${host_backup}"
	[[ "$(dd if="$host_backup" bs=7 count=1 2>/dev/null)" == "HUBENC1" ]] \
		|| fail "encrypted backup envelope header is invalid"
	# The quoted program must be passed to Node verbatim; shell expansion would be unsafe here.
	# shellcheck disable=SC2016
	compose_release --profile backup run --interactive=false -T --rm --no-deps --pull never backup \
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
	if [[ "$RECOVERY_REQUIRED" == "true" && "$SIMULATE" != "1" ]]; then
		revalidate_recovery_fallback_binding \
			|| fail "candidate exact-version configuration does not match the independently qualified fallback binding"
		record recovery_fallback_candidate_configuration_sha256 "$RECOVERY_B_CONFIGURATION_SHA256"
	fi
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
	compose_current build migrate grant-roles bff static backup
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
		git -C "$ROOT" checkout --detach "$CONTROL_SHA" >/dev/null
		restore_candidate_image_tags_and_cleanup
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
	SCHEMA_HAS_MIGRATION_0011="$(python3 -c \
		'import json,sys; print("true" if any(row["version"] == "0011" for row in json.load(open(sys.argv[1]))["applied"]) else "false")' \
		"$migration_apply")"
	replace_record migrations_applied "$APPLIED_MIGRATIONS"
	replace_record schema_has_migration_0011 "$SCHEMA_HAS_MIGRATION_0011"
	if [[ "$PLANNED_MIGRATIONS" == "none" && "$APPLIED_MIGRATIONS" != "none" ]]; then
		SCHEMA_MUTATED="true"
		replace_record schema_mutated true
	fi
	compose_release run --rm --no-deps grant-roles node server/scripts/grant-roles.mjs
	local account_entitlement_rollout="${RELEASE_DIR}/account-entitlement-rollout.txt"
	compose_release run --rm --no-deps bff \
		node server/scripts/check-account-entitlement-rollout.mjs >"$account_entitlement_rollout"
	record account_entitlement_rollout_sha256 "$(sha256_file "$account_entitlement_rollout")"
	replace_record account_entitlement_rollout passed
	local before_cutover="${RELEASE_DIR}/migration-before-cutover.json"
	compose_release run --rm --no-deps migrate node server/scripts/migrate.mjs status >"$before_cutover"
	[[ "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["pending"]))' "$before_cutover")" == "0" ]] \
		|| fail "migrations remain pending before application cutover"
	local peer_source_cost_campaign_ids
	peer_source_cost_campaign_ids="$(env_value HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS 2>/dev/null || true)"
	if [[ -n "$peer_source_cost_campaign_ids" ]]; then
		local peer_source_cost_rollout="${RELEASE_DIR}/peer-source-cost-rollout.txt"
		compose_release run --rm --no-deps bff \
			node server/scripts/check-peer-source-cost-rollout.mjs >"$peer_source_cost_rollout"
		record peer_source_cost_rollout_sha256 "$(sha256_file "$peer_source_cost_rollout")"
		replace_record peer_source_cost_rollout passed
	else
		replace_record peer_source_cost_rollout disabled
	fi
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
	local newest_backup
	newest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hub-*.dump.enc' -mmin -1560 -print | sort | tail -n 1)"
	[[ -n "$newest_backup" ]] || fail "no encrypted backup is newer than 26 hours"
	record migration_after_sha256 "$(sha256_file "$migration_after")"
	record readiness_after passed
	record tls_websocket_metrics_after passed
	record static_assets_after passed
	record backup_age_after passed
	record deployed_bff_image_id "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q bff)")"
	record deployed_static_image_id "$(docker inspect --format '{{.Image}}' "$(compose_release ps -q static)")"
}

phase_finalize () {
	if [[ "$DRY_RUN" != "true" && "$RECOVERY_ACTIVE_STATE" == "true" ]]; then
		local recovery_dir="${HOME}/.local/state/thelemar-hub/recovery"
		rm -f -- \
			"${recovery_dir}/active-fallback.tsv" \
			"${recovery_dir}/active-fallback.env" \
			"${recovery_dir}/active-fallback.blocked" \
			|| fail "could not clear active recovery-mode state and job fence"
		replace_record recovery_mode_cleared true
	fi
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
		if [[ "$CURRENT_PHASE" == "preflight" ]]; then
			validate_recovery_fallback
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
			if [[ -n "${HUB_RELEASE_TEST_SCHEMA_HAS_MIGRATION_0011:-}" ]]; then
				SCHEMA_HAS_MIGRATION_0011="$HUB_RELEASE_TEST_SCHEMA_HAS_MIGRATION_0011"
			elif [[ ",${PLANNED_MIGRATIONS}," == *",0011,"* ]]; then
				SCHEMA_HAS_MIGRATION_0011="true"
			else
				SCHEMA_HAS_MIGRATION_0011="false"
			fi
			replace_record migrations_planned "$PLANNED_MIGRATIONS"
			replace_record migrations_applied unknown
			replace_record schema_has_migration_0011 "$SCHEMA_HAS_MIGRATION_0011"
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
	if [[ "$FIRST_USE" == "1" ]]; then
		ROOT="$(git -C "$SCRIPT_DIR/../.." rev-parse --show-toplevel)"
		ROOT="$(cd "$ROOT" && pwd -P)"
		PREVIOUS_SHA="$FIRST_USE_PREVIOUS_SHA"
		CONTROL_SHA="$FIRST_USE_PREVIOUS_SHA"
		PREVIOUS_TAG="$FIRST_USE_PREVIOUS_TAG"
		SOURCE_CHECKED_OUT="true"
		trap early_first_use_cleanup EXIT
	fi
	validate_first_use_environment
	if [[ "$SIMULATE" == "1" && "$TEST_MODE" != "1" ]]; then
		fail "HUB_RELEASE_SIMULATE is available only with HUB_RELEASE_TEST_MODE=1" || exit 2
	fi
	mkdir -p "$(dirname "$LOCK_FILE")"
	if [[ "$FIRST_USE" != "1" ]]; then
		exec 9>"$LOCK_FILE"
	fi
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

	# Scheduled-job wrappers use this same admission lock through their foreground Compose command.
	RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TAG//[^A-Za-z0-9._-]/_}-$$"
	mkdir -p "$EVIDENCE_ROOT"
	RELEASE_DIR="${EVIDENCE_ROOT}/${RELEASE_ID}"
	mkdir "$RELEASE_DIR"
	STATE_FILE="${RELEASE_DIR}/state.tsv"
	TRACE_FILE="${RELEASE_DIR}/phases.log"
	: >"$STATE_FILE"
	: >"$TRACE_FILE"
	local engine_root
	engine_root="$(git -C "$SCRIPT_DIR/../.." rev-parse --show-toplevel)"
	EXECUTING_ENGINE_SOURCE_SHA="$(git -C "$engine_root" rev-parse HEAD)"
	EXECUTING_ENGINE_TREE_SHA="$(git -C "$engine_root" rev-parse 'HEAD^{tree}')"
	EXECUTING_ENGINE_SCRIPT_SHA256="$("$INITIAL_HELPER" sha256 --file "$SCRIPT_DIR/release.sh")"
	EXECUTING_ENGINE_HELPER_SHA256="$("$INITIAL_HELPER" sha256 --file "$INITIAL_HELPER")"
	record release_engine_source_sha "$EXECUTING_ENGINE_SOURCE_SHA"
	record release_engine_source_tree_sha "$EXECUTING_ENGINE_TREE_SHA"
	record release_engine_script_sha256 "$EXECUTING_ENGINE_SCRIPT_SHA256"
	cp "$INITIAL_HELPER" "${RELEASE_DIR}/release-helper.py"
	chmod 700 "${RELEASE_DIR}/release-helper.py"
	HELPER="${RELEASE_DIR}/release-helper.py"
	record release_engine_helper_sha256 "$EXECUTING_ENGINE_HELPER_SHA256"
	record release_engine_helper_snapshot before-candidate-checkout
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
	record first_use "$([[ "$FIRST_USE" == "1" ]] && printf true || printf false)"
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
