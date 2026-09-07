#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

EXPECTED_REPOSITORY="${HUB_RELEASE_EXPECTED_REPOSITORY:-TrueMichato/ThelemarTools}"
EXPECTED_ROOT="${HUB_RELEASE_EXPECTED_ROOT:-/home/ubuntu/ThelemarTools}"
EXPECTED_BRANCH="${HUB_RELEASE_EXPECTED_BRANCH:-multiplayer-hub}"
LOCK_FILE="${HUB_RELEASE_LOCK_FILE:-/run/lock/thelemar-hub-release.lock}"

TAG=""
DRY_RUN="false"
ROOT=""
ENV_FILE=""
PREVIOUS_SHA=""
PREVIOUS_TAG=""
TARGET_SHA=""

usage () {
	cat <<'EOF'
Usage: bash <(git show <verified-tag>:deploy/hub/first-release.sh) [--dry-run] <verified-tag>

Options:
  --dry-run   Run the existing release engine's dry run and restore the legacy checkout.
  --help      Show this help.
EOF
}

log () {
	printf '[hub-first-release] %s\n' "$*"
}

fail () {
	printf '[hub-first-release] ERROR: %s\n' "$*" >&2
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

normalize_origin () {
	printf '%s' "$1" | sed -E \
		-e 's#^git@github\.com:#https://github.com/#' \
		-e 's#^ssh://git@github\.com/#https://github.com/#' \
		-e 's#\.git$##'
}

resolve_remote_tag () {
	local output tag_line peeled_line
	output="$(git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/${TAG}" "refs/tags/${TAG}^{}")" \
		|| fail "origin does not contain tag ${TAG}"
	tag_line="$(printf '%s\n' "$output" | awk -v ref="refs/tags/${TAG}" '$2 == ref {print $1}')"
	peeled_line="$(printf '%s\n' "$output" | awk -v ref="refs/tags/${TAG}^{}" '$2 == ref {print $1}')"
	[[ -n "$tag_line" && -n "$peeled_line" ]] || fail "tag ${TAG} must be an annotated tag"
	printf '%s\t%s\n' "$tag_line" "$peeled_line"
}

assert_clean_root () {
	local status
	status="$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all)"
	[[ -z "$status" ]] || fail "deployment checkout is dirty"
	[[ ! -f "$ROOT/.git/MERGE_HEAD" ]] || fail "deployment checkout has an unfinished merge"
}

compose_current () {
	docker compose \
		--project-directory "$ROOT" \
		--env-file "$ENV_FILE" \
		-f "$ROOT/compose.hub.yml" \
		-f "$ROOT/compose.hub.public.yml" \
		"$@"
}

require_image_id () {
	local label="$1"
	local image_id="$2"
	[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "${label} did not resolve to an immutable image ID"
}

parse_arguments () {
	while (($#)); do
		case "$1" in
			--dry-run) DRY_RUN="true" ;;
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

restore_checkout_on_exec_failure () {
	local status="$?"
	if [[ "$status" -ne 0 && -n "$PREVIOUS_SHA" && -n "$ROOT" ]]; then
		git -C "$ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null 2>&1 || true
	fi
	exit "$status"
}

main () {
	parse_arguments "$@"
	for required in git docker flock awk sed stat sha256sum; do
		command -v "$required" >/dev/null 2>&1 || fail "${required} is required"
	done

	ROOT="$(git rev-parse --show-toplevel)"
	ROOT="$(cd "$ROOT" && pwd -P)"
	ENV_FILE="$ROOT/.env.hub"
	[[ "$(pwd -P)" == "$ROOT" ]] || fail "run this command from the deployment repository root: ${ROOT}"
	[[ "$ROOT" == "$EXPECTED_ROOT" ]] || fail "expected deployment root ${EXPECTED_ROOT}, got ${ROOT}"
	[[ "$(normalize_origin "$(git -C "$ROOT" remote get-url origin)")" == "https://github.com/${EXPECTED_REPOSITORY}" ]] \
		|| fail "origin is not https://github.com/${EXPECTED_REPOSITORY}"
	assert_clean_root
	[[ -f "$ENV_FILE" ]] || fail ".env.hub is missing"
	[[ ! -e "$ROOT/deploy/hub/release.sh" ]] \
		|| fail "deployment already contains release.sh; use the ordinary release path"

	mkdir -p "$(dirname "$LOCK_FILE")"
	exec 9>"$LOCK_FILE"
	flock -n 9 || {
		printf '[hub-first-release] ERROR: another Campaign Hub release holds %s\n' "$LOCK_FILE" >&2
		exit 75
	}

	PREVIOUS_SHA="$(git -C "$ROOT" rev-parse HEAD)"
	PREVIOUS_TAG="$(git -C "$ROOT" describe --tags --exact-match "$PREVIOUS_SHA" 2>/dev/null || true)"
	[[ -n "$PREVIOUS_TAG" ]] || fail "current deployment HEAD must have an exact rollback tag"
	[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${PREVIOUS_TAG}")" == "tag" ]] \
		|| fail "current rollback tag ${PREVIOUS_TAG} is not annotated"
	[[ "$(git -C "$ROOT" rev-parse "refs/tags/${PREVIOUS_TAG}^{}")" == "$PREVIOUS_SHA" ]] \
		|| fail "current rollback tag does not resolve to ${PREVIOUS_SHA}"

	git -C "$ROOT" fetch --no-tags origin \
		"refs/heads/${EXPECTED_BRANCH}:refs/remotes/origin/${EXPECTED_BRANCH}"
	git -C "$ROOT" fetch --no-tags origin "refs/tags/${TAG}:refs/tags/${TAG}"
	local remote_pair remote_tag_object remote_sha
	remote_pair="$(resolve_remote_tag)"
	IFS=$'\t' read -r remote_tag_object remote_sha <<<"$remote_pair"
	[[ "$(git -C "$ROOT" cat-file -t "refs/tags/${TAG}")" == "tag" ]] || fail "${TAG} is not an annotated tag"
	[[ "$(git -C "$ROOT" rev-parse "refs/tags/${TAG}")" == "$remote_tag_object" ]] \
		|| fail "local and origin tag objects do not match"
	TARGET_SHA="$(git -C "$ROOT" rev-parse "refs/tags/${TAG}^{}")"
	[[ "$TARGET_SHA" == "$remote_sha" ]] || fail "local and origin tag commits do not match"
	git -C "$ROOT" merge-base --is-ancestor "$TARGET_SHA" "origin/${EXPECTED_BRANCH}" \
		|| fail "${TAG} is not reachable from origin/${EXPECTED_BRANCH}"
	git -C "$ROOT" merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA" \
		|| fail "${TAG} does not descend from the current deployment"
	[[ "$TARGET_SHA" != "$PREVIOUS_SHA" ]] || fail "${TAG} is already checked out"

	local previous_config_sha256
	previous_config_sha256="$(git -C "$ROOT" ls-tree "$PREVIOUS_SHA" -- \
		compose.hub.yml \
		compose.hub.public.yml \
		deploy/hub/Caddyfile.public \
		| sha256sum \
		| awk '{print $1}')"
	[[ "$previous_config_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "could not hash the legacy release configuration"

	local bff_container static_container bff_image_id static_image_id project_name backup_image_ref backup_image_id
	local bff_revision backup_revision
	bff_container="$(compose_current ps -q bff)"
	static_container="$(compose_current ps -q static)"
	[[ -n "$bff_container" && -n "$static_container" ]] \
		|| fail "running BFF/static containers are required for the first-release handoff"
	bff_image_id="$(docker inspect --format '{{.Image}}' "$bff_container")"
	static_image_id="$(docker inspect --format '{{.Image}}' "$static_container")"
	project_name="$(compose_current config | awk '$1 == "name:" {print $2; exit}')"
	[[ -n "$project_name" ]] || fail "could not resolve the Compose project name"
	backup_image_ref="${project_name}-backup"
	backup_image_id="$(docker image inspect --format '{{.Id}}' "$backup_image_ref")" \
		|| fail "current backup image is missing: ${backup_image_ref}"
	require_image_id "BFF container" "$bff_image_id"
	require_image_id "static container" "$static_image_id"
	require_image_id "backup image" "$backup_image_id"
	bff_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$bff_image_id")"
	backup_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$backup_image_id")"
	revision_resolves_to_commit "$bff_revision" "$PREVIOUS_SHA" \
		|| fail "running BFF image revision does not match the legacy checkout"
	revision_resolves_to_commit "$backup_revision" "$PREVIOUS_SHA" \
		|| fail "backup image revision does not match the legacy checkout"

	trap restore_checkout_on_exec_failure EXIT
	git -C "$ROOT" checkout --detach "$TARGET_SHA" >/dev/null
	assert_clean_root
	[[ -x "$ROOT/deploy/hub/release.sh" ]] || fail "candidate release engine is missing or not executable"
	[[ -f "$ROOT/compose.hub.release.yml" ]] || fail "candidate release overlay is missing"

	local -a release_args=()
	[[ "$DRY_RUN" == "true" ]] && release_args+=(--dry-run)
	release_args+=("$TAG")
	log "Handing ${PREVIOUS_TAG} (${PREVIOUS_SHA}) to the verified candidate release engine."
	exec env \
		HUB_RELEASE_FIRST_USE=1 \
		HUB_RELEASE_INHERITED_LOCK_FD=9 \
		HUB_RELEASE_PREVIOUS_SHA="$PREVIOUS_SHA" \
		HUB_RELEASE_PREVIOUS_TAG="$PREVIOUS_TAG" \
		HUB_RELEASE_PREVIOUS_BFF_IMAGE_ID="$bff_image_id" \
		HUB_RELEASE_PREVIOUS_STATIC_IMAGE_ID="$static_image_id" \
		HUB_RELEASE_PREVIOUS_BACKUP_IMAGE_ID="$backup_image_id" \
		HUB_RELEASE_PREVIOUS_CONFIG_SHA256="$previous_config_sha256" \
		"$ROOT/deploy/hub/release.sh" "${release_args[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
