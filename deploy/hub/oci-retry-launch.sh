#!/usr/bin/env bash
# Retry an Oracle Cloud Ampere A1 instance launch until free capacity appears.
#
# "Out of host capacity" is a transient condition on Always Free ARM shapes, not a
# configuration error. This script retries politely and stops immediately on any
# error that retrying cannot fix (bad credentials, exhausted quota, invalid input).
#
# It deliberately uses only the official `oci` CLI and your existing CLI profile, so
# no third-party tool ever handles credentials that can control the whole tenancy.
#
# Usage:
#   ./deploy/hub/oci-retry-launch.sh
#
# Everything is auto-discovered from your existing setup:
#   - compartment  -> `tenancy` in ~/.oci/config
#   - subnet       -> the only subnet in that compartment (lists them if ambiguous)
#   - SSH key      -> $SSH_KEY_FILE, else ~/.ssh/id_ed25519.pub, else ~/.ssh/id_rsa.pub,
#                     else offers to generate a dedicated key
#
# Override any of it with OCI_COMPARTMENT_ID, OCI_SUBNET_ID, or SSH_KEY_FILE.
#
# Optional overrides:
#   DISPLAY_NAME (CampaignHub)  OCPUS (1)      MEMORY_GB (6)   BOOT_GB (100)
#   INTERVAL_SECONDS (180)      MAX_ATTEMPTS (0 = unlimited)
#
# Stop with Ctrl-C at any time; no resource is left half-created.

set -euo pipefail

SHAPE="VM.Standard.A1.Flex"
DISPLAY_NAME="${DISPLAY_NAME:-CampaignHub}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-100}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-180}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-0}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.campaignhub.pub}"
OCI_SUBNET_ID=ocid1.subnet.oc1.il-jerusalem-1.aaaaaaaagpzolbmm5csvkvld4bxva44qnlsjrwv4fbfgxusrovi7bxletsxq \

log () { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die () { log "FATAL: $*"; exit 1; }

command -v oci >/dev/null 2>&1 || die "the OCI CLI is not installed or not on PATH"
command -v python3 >/dev/null 2>&1 || die "python3 is required to parse OCI responses"

# --- compartment: fall back to the tenancy OCID the CLI is already configured with ---
if [ -z "${OCI_COMPARTMENT_ID:-}" ]; then
	OCI_COMPARTMENT_ID="$(python3 - <<'PY'
import configparser, os
cfg = configparser.ConfigParser()
cfg.read(os.path.expanduser("~/.oci/config"))
print(cfg.get(os.environ.get("OCI_CLI_PROFILE", "DEFAULT"), "tenancy", fallback=""))
PY
)"
	[ -n "$OCI_COMPARTMENT_ID" ] || die "no compartment given and none found in ~/.oci/config — run 'oci setup config'"
	log "Compartment: from ~/.oci/config (tenancy root)"
fi

# --- SSH key: use what exists, or offer to create a dedicated one ---
if [ ! -r "$SSH_KEY_FILE" ]; then
	for candidate in "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"; do
		if [ -r "$candidate" ]; then SSH_KEY_FILE="$candidate"; break; fi
	done
fi

if [ ! -r "$SSH_KEY_FILE" ]; then
	target="${SSH_KEY_FILE%.pub}"
	log "No SSH public key found. A dedicated key for this host is good practice."
	if [ -t 0 ]; then
		printf 'Generate one at %s now? [y/N] ' "$target"
		read -r reply
		case "$reply" in
			[yY]*)
				ssh-keygen -t ed25519 -N '' -f "$target" -C "campaignhub" -q
				SSH_KEY_FILE="$target.pub"
				log "Created $target and $SSH_KEY_FILE" ;;
			*) die "no SSH key; generate one with: ssh-keygen -t ed25519 -f $target" ;;
		esac
	else
		die "no SSH key and not running interactively; create one with: ssh-keygen -t ed25519 -f $target"
	fi
fi

case "$(cat "$SSH_KEY_FILE")" in
	ssh-*|ecdsa-*) ;;
	*) die "$SSH_KEY_FILE does not look like a public key — do not pass the private key" ;;
esac
log "SSH public key: $SSH_KEY_FILE"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# --- subnet: auto-discover when unambiguous, otherwise show the choices ---
if [ -z "${OCI_SUBNET_ID:-}" ]; then
	log "Looking up subnets ..."
	SUBNET_JSON="$(oci network subnet list --compartment-id "$OCI_COMPARTMENT_ID" --all 2>"$WORK_DIR/sn.err" || true)"
	if [ -z "$SUBNET_JSON" ]; then
		log "$(cat "$WORK_DIR/sn.err")"
		die "could not list subnets — check that the API key is uploaded and the region is correct"
	fi
	printf '%s' "$SUBNET_JSON" > "$WORK_DIR/sn.json"
	# A subnet that prohibits public IPs cannot host an internet-facing service, and
	# Let's Encrypt could never reach it, so those are never valid choices here.
	python3 - "$WORK_DIR/sn.json" > "$WORK_DIR/sn.txt" <<'PY'
import json, sys
for s in json.load(open(sys.argv[1]))["data"]:
    if s.get("lifecycle-state") not in (None, "AVAILABLE"):
        continue
    kind = "private" if s.get("prohibit-public-ip-on-vnic") else "public"
    print("%s\t%s\t%s" % (kind, s.get("display-name", "?"), s["id"]))
PY
	PUBLIC_COUNT="$(grep -c '^public' "$WORK_DIR/sn.txt" || true)"
	if [ "$PUBLIC_COUNT" = "1" ]; then
		OCI_SUBNET_ID="$(awk -F'\t' '$1=="public"{print $3}' "$WORK_DIR/sn.txt")"
		log "Subnet: $(awk -F'\t' '$1=="public"{print $2}' "$WORK_DIR/sn.txt") (the only public subnet)"
	elif [ "$PUBLIC_COUNT" = "0" ]; then
		die "no public subnet found; this host must be internet-facing (runbook Part C3)"
	else
		log "Several public subnets exist. Re-run with OCI_SUBNET_ID set to one of:"
		awk -F'\t' '$1=="public"{printf "  %-40s %s\n", $2, $3}' "$WORK_DIR/sn.txt"
		log "Prefer a subnet with no other instances in it: the 80/443 rule you add later"
		log "applies to the whole subnet, so an empty one limits the blast radius."
		PRIVATE_COUNT="$(grep -c '^private' "$WORK_DIR/sn.txt" || true)"
		[ "$PRIVATE_COUNT" = "0" ] || log "($PRIVATE_COUNT private subnet(s) hidden — they cannot host a public service.)"
		exit 1
	fi
fi

log "Resolving the newest Ubuntu 24.04 aarch64 image for $SHAPE ..."
IMAGE_ID="$(oci compute image list \
	--compartment-id "$OCI_COMPARTMENT_ID" \
	--operating-system "Canonical Ubuntu" \
	--operating-system-version "24.04" \
	--shape "$SHAPE" \
	--sort-by TIMECREATED --sort-order DESC \
	--query 'data[0].id' --raw-output 2>/dev/null || true)"
[ -n "$IMAGE_ID" ] || die "could not resolve an image; check CLI auth and the compartment OCID"
log "Image: $IMAGE_ID"

# Israel Central has a single availability domain, but multi-AD regions benefit from
# rotating between them, so read whatever this tenancy actually has.
# Parsed with python3 rather than `mapfile`, which macOS's bash 3.2 does not have.
AD_JSON="$(oci iam availability-domain list --compartment-id "$OCI_COMPARTMENT_ID" 2>/dev/null || true)"
ADS=()
while IFS= read -r line; do
	[ -n "$line" ] && ADS+=("$line")
done <<EOF
$(printf '%s' "$AD_JSON" | python3 -c 'import json,sys; print("\n".join(a["name"] for a in json.load(sys.stdin)["data"]))' 2>/dev/null)
EOF
[ "${#ADS[@]}" -gt 0 ] || die "could not list availability domains; check CLI auth and the compartment OCID"
log "Availability domains: ${ADS[*]}"

python3 - "$SSH_KEY_FILE" "$WORK_DIR/metadata.json" <<'PY'
import json, sys
key = open(sys.argv[1]).read().strip()
json.dump({"ssh_authorized_keys": key}, open(sys.argv[2], "w"))
PY

log "Requesting $OCPUS OCPU / ${MEMORY_GB} GB, ${BOOT_GB} GB boot, named '$DISPLAY_NAME'."
log "Retrying every ${INTERVAL_SECONDS}s. Ctrl-C to stop."

attempt=0
while :; do
	attempt=$((attempt + 1))
	ad="${ADS[$(( (attempt - 1) % ${#ADS[@]} ))]}"

	if oci compute instance launch \
		--compartment-id "$OCI_COMPARTMENT_ID" \
		--availability-domain "$ad" \
		--display-name "$DISPLAY_NAME" \
		--shape "$SHAPE" \
		--shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
		--image-id "$IMAGE_ID" \
		--subnet-id "$OCI_SUBNET_ID" \
		--assign-public-ip true \
		--boot-volume-size-in-gbs "$BOOT_GB" \
		--metadata "file://$WORK_DIR/metadata.json" \
		--wait-for-state RUNNING \
		> "$WORK_DIR/out.json" 2> "$WORK_DIR/err.txt"
	then
		log "SUCCESS after $attempt attempt(s) in $ad."
		python3 - "$WORK_DIR/out.json" <<'PY' || cat "$WORK_DIR/out.json"
import json, sys
d = json.load(open(sys.argv[1])).get("data", {})
for k in ("id", "display-name", "lifecycle-state", "availability-domain"):
    if d.get(k): print(f"  {k}: {d[k]}")
PY
		log "Next: reserve the public IP (runbook C8), then open both firewalls (Part D)."
		exit 0
	fi

	err="$(cat "$WORK_DIR/err.txt")"

	# Retrying cannot fix these. Fail loudly rather than hammering the API.
	case "$err" in
		*LimitExceeded*|*QuotaExceeded*|*"service limit"*)
			log "$err"
			die "quota or service limit reached — free capacity is already allocated. Release a core first (runbook Part B)." ;;
		*NotAuthenticated*|*NotAuthorized*|*Forbidden*)
			log "$err"
			die "authentication or permission problem — check 'oci setup config'." ;;
		*InvalidParameter*|*"is not valid"*|*NotFound*)
			log "$err"
			die "invalid request — check the subnet OCID, shape config, and boot volume size." ;;
	esac

	case "$err" in
		*"Out of host capacity"*|*OutOfCapacity*|*OutOfHostCapacity*|*TooManyRequests*|*429*)
			log "Attempt $attempt in $ad: out of capacity." ;;
		*)
			log "$err"
			die "unrecognised error — stopping rather than retrying blindly." ;;
	esac

	if [ "$MAX_ATTEMPTS" -gt 0 ] && [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
		die "gave up after $attempt attempts."
	fi
	log "Waiting ${INTERVAL_SECONDS}s before the next attempt."
	sleep "$INTERVAL_SECONDS"
done
