#!/bin/sh
set -eu

umask 077

: "${HUB_PUBLIC_DOMAIN:?Set HUB_PUBLIC_DOMAIN in .env.hub}"
: "${HUB_METRICS_TOKEN:?Set HUB_METRICS_TOKEN in .env.hub}"

base_url="https://${HUB_PUBLIC_DOMAIN}"
metrics_file="$(mktemp)"
certificate_file="$(mktemp)"

notify_failure () {
	status="$?"
	rm -f "$metrics_file" "$certificate_file"
	if [ "$status" -ne 0 ] && [ -n "${HUB_MONITOR_FAILURE_URL:-}" ]; then
		curl --silent --show-error --fail --max-time 10 \
			--request POST \
			--data-raw "" \
			"$HUB_MONITOR_FAILURE_URL" >/dev/null || true
	fi
	exit "$status"
}
trap notify_failure EXIT HUP INT TERM

fail () {
	printf 'Campaign Hub host check failed: %s\n' "$1" >&2
	exit 1
}

read_metric () {
	awk -v metric="$1" '$1 == metric {print $2; found = 1} END {if (!found) exit 1}' "$metrics_file"
}

assert_max_metric () {
	name="$1"
	maximum="$2"
	value="$(read_metric "$name")" || fail "metric ${name} is missing"
	awk -v value="$value" -v maximum="$maximum" 'BEGIN {exit !(value >= 0 && value <= maximum)}' \
		|| fail "${name} is ${value}; expected at most ${maximum}"
}

curl --silent --show-error --fail --max-time 15 "${base_url}/api/ready" >/dev/null \
	|| fail "readiness endpoint is unavailable"
curl --silent --show-error --fail --max-time 15 \
	--header "Authorization: Bearer ${HUB_METRICS_TOKEN}" \
	"${base_url}/api/metrics" >"$metrics_file" \
	|| fail "protected metrics endpoint is unavailable"

ws_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 \
	--http1.1 \
	--header "Origin: ${base_url}" \
	--header 'Connection: Upgrade' \
	--header 'Upgrade: websocket' \
	--header 'Sec-WebSocket-Version: 13' \
	--header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
	"${base_url}/ws/campaign/00000000-0000-4000-8000-000000000000")"
[ "$ws_status" = "401" ] || fail "WebSocket route returned HTTP ${ws_status}; expected an unauthenticated 401"

printf '' | openssl s_client \
	-connect "${HUB_PUBLIC_DOMAIN}:443" \
	-servername "$HUB_PUBLIC_DOMAIN" \
	>"$certificate_file" 2>/dev/null \
	|| fail "TLS certificate could not be read"
openssl x509 -in "$certificate_file" -noout -checkend 1209600 >/dev/null \
	|| fail "TLS certificate expires within 14 days"

disk_percent="$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
[ -n "$disk_percent" ] || fail "root disk utilization could not be read"
[ "$disk_percent" -lt 85 ] || fail "root disk utilization is ${disk_percent}%"

memory_available="$(free | awk '/^Mem:/ {print $7}')"
memory_total="$(free | awk '/^Mem:/ {print $2}')"
[ -n "$memory_available" ] && [ -n "$memory_total" ] || fail "memory availability could not be read"
awk -v available="$memory_available" -v total="$memory_total" 'BEGIN {exit !(total > 0 && available / total >= 0.10)}' \
	|| fail "less than 10% of memory is available"

load_one="$(awk '{print $1}' /proc/loadavg)"
cpu_count="$(getconf _NPROCESSORS_ONLN)"
awk -v load="$load_one" -v cpus="$cpu_count" 'BEGIN {exit !(cpus > 0 && load <= cpus * 2)}' \
	|| fail "one-minute load ${load_one} exceeds twice the ${cpu_count}-CPU capacity"

running_services="$(docker compose \
	--env-file .env.hub \
	-f compose.hub.yml \
	-f compose.hub.public.yml \
	ps --status running --services)"
for service in db static bff edge; do
	printf '%s\n' "$running_services" | grep -qx "$service" \
		|| fail "Compose service ${service} is not running"
done

assert_max_metric hub_outbox_oldest_age_seconds 60
assert_max_metric hub_outbox_failed 0
assert_max_metric hub_dispatcher_consecutive_errors 0
assert_max_metric hub_last_maintenance_age_seconds 108000
assert_max_metric hub_last_backup_age_seconds 108000
assert_max_metric hub_last_restore_drill_age_seconds 3024000

if [ -n "${HUB_MONITOR_HEARTBEAT_URL:-}" ]; then
	curl --silent --show-error --fail --max-time 10 \
		--request POST \
		--data-raw "" \
		"$HUB_MONITOR_HEARTBEAT_URL" >/dev/null \
		|| fail "external heartbeat could not be recorded"
fi

printf 'Campaign Hub host checks passed.\n'
