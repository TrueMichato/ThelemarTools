#!/usr/bin/env python3
"""Small, dependency-free helpers for the Campaign Hub release script."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


SECRET_NAME_RE = re.compile(r"(?:PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|DATABASE_URL)$", re.IGNORECASE)
SECRET_TEXT_PATTERNS = (
	re.compile(r"(?i)(authorization:\s*(?:bearer\s+)?)[^\s]+"),
	re.compile(r"(?i)(://[^:/\s]+:)[^@\s]+(@)"),
	re.compile(r"(?i)((?:password|secret|token|encryption[_-]?key|database_url)\s*[=:]\s*)[^\s,;]+"),
)


def read_dotenv(path: Path) -> dict[str, str]:
	values: dict[str, str] = {}
	for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
		line = raw.strip()
		if not line or line.startswith("#"):
			continue
		if line.startswith("export "):
			line = line[7:].lstrip()
		if "=" not in line:
			raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
		key, value = line.split("=", 1)
		key = key.strip()
		if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
			raise ValueError(f"{path}:{line_number}: invalid environment variable name")
		value = value.strip()
		if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
			value = value[1:-1]
		values[key] = value
	return values


def redact(text: str, dotenv: dict[str, str] | None = None) -> str:
	for pattern in SECRET_TEXT_PATTERNS:
		text = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]{match.group(2) if match.lastindex == 2 else ''}", text)
	for key, value in (dotenv or {}).items():
		if value and SECRET_NAME_RE.search(key):
			text = text.replace(value, "[REDACTED]")
	return text


def command_env(args: argparse.Namespace) -> int:
	values = read_dotenv(Path(args.file))
	if args.key not in values:
		return 2
	sys.stdout.write(values[args.key])
	return 0


def command_validate_key(args: argparse.Namespace) -> int:
	values = read_dotenv(Path(args.file))
	raw = values.get("HUB_BACKUP_ENCRYPTION_KEY", "")
	try:
		decoded = base64.b64decode(raw, validate=True)
	except (ValueError, base64.binascii.Error):
		return 2
	return 0 if len(decoded) == 32 else 2


def command_set_backup_ids(args: argparse.Namespace) -> int:
	path = Path(args.file)
	mode = stat.S_IMODE(path.stat().st_mode)
	lines = path.read_text(encoding="utf-8").splitlines()
	replacements = {
		"HUB_BACKUP_UID": str(args.uid),
		"HUB_BACKUP_GID": str(args.gid),
	}
	found: set[str] = set()
	output: list[str] = []
	for line in lines:
		match = re.match(r"^(\s*(?:export\s+)?)(HUB_BACKUP_(?:UID|GID))=", line)
		if not match:
			output.append(line)
			continue
		key = match.group(2)
		output.append(f"{match.group(1)}{key}={replacements[key]}")
		found.add(key)
	for key in ("HUB_BACKUP_UID", "HUB_BACKUP_GID"):
		if key not in found:
			output.append(f"{key}={replacements[key]}")

	fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
	try:
		with os.fdopen(fd, "w", encoding="utf-8") as handle:
			handle.write("\n".join(output) + "\n")
			handle.flush()
			os.fsync(handle.fileno())
		os.chmod(temporary, mode)
		os.replace(temporary, path)
	finally:
		if os.path.exists(temporary):
			os.unlink(temporary)
	return 0


def command_migration(args: argparse.Namespace) -> int:
	plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
	policy = json.loads(Path(args.policy).read_text(encoding="utf-8"))
	metadata = policy.get("migrations", {})
	pending = plan.get("pending", [])
	summary: list[dict[str, object]] = []
	rollback_compatible = True
	for migration in pending:
		version = migration.get("version")
		entry = metadata.get(version)
		if not entry:
			raise ValueError(f"Pending migration {version!r} has no release policy")
		phase = entry.get("phase")
		previous_compatible = entry.get("previousAppCompatible") is True
		if phase not in {"expand", "contract"}:
			raise ValueError(f"Pending migration {version!r} has invalid phase {phase!r}")
		if phase == "contract":
			raise ValueError(
				f"Pending migration {version!r} is contract-phase and must use the manual break-glass runbook"
			)
		rollback_compatible = rollback_compatible and previous_compatible
		summary.append({
			"version": version,
			"filename": migration.get("filename"),
			"action": migration.get("action"),
			"phase": phase,
			"previousAppCompatible": previous_compatible,
		})

	result = {
		"pending": summary,
		"pendingVersions": [item["version"] for item in summary],
		"rollbackCompatible": rollback_compatible,
	}
	Path(args.output).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	return 0


def read_state(path: Path) -> dict[str, str]:
	state: dict[str, str] = {}
	for raw in path.read_text(encoding="utf-8").splitlines():
		if not raw:
			continue
		key, separator, value = raw.partition("\t")
		if not separator or not re.fullmatch(r"[a-z][a-z0-9_]*", key):
			raise ValueError(f"Invalid release state entry")
		state[key] = value
	return state


def command_evidence(args: argparse.Namespace) -> int:
	state = read_state(Path(args.state))
	safe_state = {key: redact(value) for key, value in state.items()}
	json_path = Path(args.json)
	text_path = Path(args.text)
	json_path.write_text(json.dumps(safe_state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	lines = ["Campaign Hub release evidence", "=============================", ""]
	lines.extend(f"{key}: {value}" for key, value in sorted(safe_state.items()))
	text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
	os.chmod(json_path, 0o600)
	os.chmod(text_path, 0o600)
	return 0


def command_redact(args: argparse.Namespace) -> int:
	dotenv = read_dotenv(Path(args.env_file)) if args.env_file else None
	sys.stdout.write(redact(sys.stdin.read(), dotenv))
	return 0


def command_sha256(args: argparse.Namespace) -> int:
	digest = hashlib.sha256()
	with Path(args.file).open("rb") as handle:
		for chunk in iter(lambda: handle.read(1024 * 1024), b""):
			digest.update(chunk)
	sys.stdout.write(digest.hexdigest())
	return 0


def build_parser() -> argparse.ArgumentParser:
	parser = argparse.ArgumentParser()
	subparsers = parser.add_subparsers(dest="command", required=True)

	env_parser = subparsers.add_parser("env")
	env_parser.add_argument("--file", required=True)
	env_parser.add_argument("--key", required=True)
	env_parser.set_defaults(handler=command_env)

	key_parser = subparsers.add_parser("validate-key")
	key_parser.add_argument("--file", required=True)
	key_parser.set_defaults(handler=command_validate_key)

	ids_parser = subparsers.add_parser("set-backup-ids")
	ids_parser.add_argument("--file", required=True)
	ids_parser.add_argument("--uid", type=int, required=True)
	ids_parser.add_argument("--gid", type=int, required=True)
	ids_parser.set_defaults(handler=command_set_backup_ids)

	migration_parser = subparsers.add_parser("migration")
	migration_parser.add_argument("--plan", required=True)
	migration_parser.add_argument("--policy", required=True)
	migration_parser.add_argument("--output", required=True)
	migration_parser.set_defaults(handler=command_migration)

	evidence_parser = subparsers.add_parser("evidence")
	evidence_parser.add_argument("--state", required=True)
	evidence_parser.add_argument("--json", required=True)
	evidence_parser.add_argument("--text", required=True)
	evidence_parser.set_defaults(handler=command_evidence)

	redact_parser = subparsers.add_parser("redact")
	redact_parser.add_argument("--env-file")
	redact_parser.set_defaults(handler=command_redact)

	sha_parser = subparsers.add_parser("sha256")
	sha_parser.add_argument("--file", required=True)
	sha_parser.set_defaults(handler=command_sha256)

	return parser


def main() -> int:
	try:
		args = build_parser().parse_args()
		return args.handler(args)
	except (OSError, ValueError, json.JSONDecodeError) as error:
		sys.stderr.write(f"release helper failed: {redact(str(error))}\n")
		return 1


if __name__ == "__main__":
	raise SystemExit(main())
