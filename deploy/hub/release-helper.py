#!/usr/bin/env python3
"""Small, dependency-free helpers for the Campaign Hub release script."""

from __future__ import annotations

import argparse
import base64
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


SECRET_NAME_RE = re.compile(r"(?:PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|DATABASE_URL)$", re.IGNORECASE)
SECRET_TEXT_PATTERNS = (
	re.compile(r"(?i)(authorization:\s*(?:bearer\s+)?)[^\s]+"),
	re.compile(r"(?i)(://[^:/\s]+:)[^@\s]+(@)"),
	re.compile(r"(?i)((?:password|secret|token|encryption[_-]?key|database_url)\s*[=:]\s*)[^\s,;]+"),
)
FULL_SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
IMAGE_ID_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
RECOVERY_TAG_PATTERN = re.compile(r"hub-[A-Za-z0-9][A-Za-z0-9._-]*")
RECOVERY_CONFIGURATION_FIELDS = (
	"HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS",
	"HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS",
	"HUB_AUTH_PROVIDERS",
	"HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS",
	"HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS",
)
ACTIVE_FALLBACK_STATE_FIELDS = frozenset({
	"status", "source_sha", "source_tree_sha", "source_tag_name", "source_tag_object_sha",
	"protocol_version", "required_migration_version", "schema_compatible_through",
	"bff_image_id", "static_image_id", "operations_image_id", "bff_image_ref",
	"static_image_ref", "backup_image_ref", "maintenance_image_ref", "configuration_sha256",
	"manifest_sha256", "qualification_evidence_sha256", "executing_engine_source_sha",
	"executing_engine_tree_sha", "control_source_sha", "control_tree_sha",
	"control_release_script_sha256", "control_helper_sha256", "control_migrate_image_id",
	"control_grant_roles_image_id",
})
RECOVERY_JOB_ENV_FIELDS = frozenset({"HUB_RECOVERY_BFF_IMAGE", "HUB_RECOVERY_BACKUP_IMAGE"})


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


def get_git_output(root: Path, *arguments: str) -> str:
	return subprocess.run(
		["git", "-C", str(root), *arguments],
		check=True,
		capture_output=True,
		text=True,
	).stdout.strip()


def get_source_declarations(root: Path, source_sha: str) -> tuple[str, str]:
	capabilities = get_git_output(root, "show", f"{source_sha}:js/hub/hub-capabilities.js")
	migration = get_git_output(root, "show", f"{source_sha}:server/src/migration-version.js")
	protocol_match = re.search(r'HUB_PROTOCOL_VERSION\s*=\s*"([0-9]+)"', capabilities)
	migration_match = re.search(r'HUB_REQUIRED_MIGRATION_VERSION\s*=\s*"([0-9]{4})"', migration)
	if not protocol_match or not migration_match:
		raise ValueError("recovery source protocol/migration declarations are missing")
	return protocol_match.group(1), migration_match.group(1)


def read_resolved_compose_configuration(value: str) -> dict[str, object]:
	if value == "-":
		resolved = json.load(sys.stdin)
	else:
		resolved = json.loads(Path(value).read_text(encoding="utf-8"))
	if not isinstance(resolved, dict):
		raise ValueError("resolved Compose configuration must be an object")
	return resolved


def get_resolved_campaign_configuration(value: str) -> tuple[dict[str, list[str]], str]:
	resolved = read_resolved_compose_configuration(value)
	services = resolved.get("services")
	if not isinstance(services, dict) or not isinstance(services.get("bff"), dict):
		raise ValueError("resolved Compose configuration has no BFF service")
	environment = services["bff"].get("environment")
	if not isinstance(environment, dict):
		raise ValueError("resolved BFF environment is not an object")
	campaigns: dict[str, list[str]] = {}
	for field in RECOVERY_CONFIGURATION_FIELDS[:2]:
		raw = environment.get(field)
		if not isinstance(raw, str):
			raise ValueError(f"resolved BFF environment is missing {field}")
		identifiers = [] if not raw.strip() else [item.strip() for item in raw.split(",")]
		if any(not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", item) for item in identifiers):
			raise ValueError(f"resolved {field} must contain only explicit campaign IDs")
		if len({item.lower() for item in identifiers}) != len(identifiers):
			raise ValueError(f"resolved {field} contains duplicate campaign IDs")
		campaigns[field] = sorted(item.lower() for item in identifiers)
	for field in RECOVERY_CONFIGURATION_FIELDS[2:]:
		raw = environment.get(field)
		if not isinstance(raw, str):
			raise ValueError(f"resolved BFF environment is missing {field}")
		providers = [] if not raw.strip() else [item.strip().lower() for item in raw.split(",")]
		if any(item not in {"github", "discord", "google"} for item in providers):
			raise ValueError(f"resolved {field} contains an unsupported provider")
		if len(set(providers)) != len(providers):
			raise ValueError(f"resolved {field} contains duplicate providers")
		campaigns[field] = sorted(providers)
	canonical = json.dumps(campaigns, sort_keys=True, separators=(",", ":")).encode("utf-8")
	return campaigns, hashlib.sha256(canonical).hexdigest()


def get_resolved_image_references(value: str) -> list[str]:
	resolved = read_resolved_compose_configuration(value)
	project_name = resolved.get("name")
	services = resolved.get("services")
	if not isinstance(project_name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project_name):
		raise ValueError("resolved Compose project name is missing or invalid")
	if not isinstance(services, dict):
		raise ValueError("resolved Compose services are missing")

	references: list[str] = []
	for name in ("bff", "static", "backup", "maintenance"):
		service = services.get(name)
		if not isinstance(service, dict):
			raise ValueError(f"resolved Compose service {name} is missing")
		image = service.get("image")
		if image is None:
			if not isinstance(service.get("build"), (dict, str)):
				raise ValueError(f"resolved Compose service {name} has neither image nor build")
			image = f"{project_name}-{name}"
		if not isinstance(image, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@-]*", image):
			raise ValueError(f"resolved Compose image reference for {name} is invalid")
		references.append(image)
	return references


def command_configuration_fingerprint(args: argparse.Namespace) -> int:
	_, digest = get_resolved_campaign_configuration(args.compose_config)
	sys.stdout.write(json.dumps({
		"algorithm": "sha256",
		"fields": list(RECOVERY_CONFIGURATION_FIELDS),
		"sha256": digest,
	}, sort_keys=True) + "\n")
	return 0


def command_recovery_image_references(args: argparse.Namespace) -> int:
	for reference in get_resolved_image_references(args.compose_config):
		sys.stdout.write(reference + "\n")
	return 0


def command_recovery_manifest(args: argparse.Namespace) -> int:
	manifest_path = Path(args.manifest)
	evidence_path = Path(args.evidence)
	for path in (manifest_path, evidence_path):
		info = path.lstat()
		if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
			raise ValueError(f"{path.name} must be a regular, non-symlink file")
		if stat.S_IMODE(info.st_mode) != 0o600:
			raise ValueError(f"{path.name} must have mode 0600")

	manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
	evidence_bytes = evidence_path.read_bytes()
	evidence = json.loads(evidence_bytes)
	if manifest.get("schemaVersion") != 1:
		raise ValueError("unsupported recovery manifest schema")

	source = manifest.get("source", {})
	if not isinstance(source, dict):
		raise ValueError("recovery source must be an object")
	source_sha = source.get("sha")
	source_tree_sha = source.get("treeSha")
	if not isinstance(source_sha, str) or not FULL_SHA_PATTERN.fullmatch(source_sha):
		raise ValueError("recovery source SHA must be a full commit SHA")
	if not FULL_SHA_PATTERN.fullmatch(args.candidate_sha) or source_sha == args.candidate_sha:
		raise ValueError("recovery source must be a distinct full-SHA ancestor of the candidate")
	if not isinstance(source_tree_sha, str) or not FULL_SHA_PATTERN.fullmatch(source_tree_sha):
		raise ValueError("recovery source tree SHA must be a full tree SHA")
	if source.get("protocolVersion") != args.protocol:
		raise ValueError("recovery protocol does not match the candidate protocol")
	if source.get("requiredMigrationVersion") != args.source_migration:
		raise ValueError("recovery required migration does not match its source declaration")
	if not re.fullmatch(r"[0-9]{4}", args.migration):
		raise ValueError("candidate migration version is invalid")
	schema_compatible_through = manifest.get("schemaCompatibleThrough")
	if (
		not isinstance(schema_compatible_through, str)
		or not re.fullmatch(r"[0-9]{4}", schema_compatible_through)
		or schema_compatible_through < args.migration
	):
		raise ValueError("recovery image is not qualified through the candidate schema")

	root = Path(args.git_root)
	tag_name = source.get("tagName")
	tag_object_sha = source.get("tagObjectSha")
	if not isinstance(tag_name, str) or not RECOVERY_TAG_PATTERN.fullmatch(tag_name):
		raise ValueError("recovery source must name an immutable hub-* tag")
	if not isinstance(tag_object_sha, str) or not FULL_SHA_PATTERN.fullmatch(tag_object_sha):
		raise ValueError("recovery annotated tag object SHA must be full length")
	if get_git_output(root, "cat-file", "-t", f"refs/tags/{tag_name}") != "tag":
		raise ValueError("recovery source tag is not annotated")
	if get_git_output(root, "rev-parse", f"refs/tags/{tag_name}") != tag_object_sha:
		raise ValueError("recovery tag object does not match the pinned object")
	if get_git_output(root, "rev-parse", f"refs/tags/{tag_name}^{{}}") != source_sha:
		raise ValueError("recovery tag does not peel to the pinned source")
	resolved_tree = subprocess.run(
		["git", "-C", str(root), "rev-parse", "--verify", f"{source_sha}^{{tree}}"],
		check=True,
		capture_output=True,
		text=True,
	).stdout.strip()
	if resolved_tree != source_tree_sha:
		raise ValueError("recovery source tree does not match the pinned commit")
	actual_protocol, actual_migration = get_source_declarations(root, source_sha)
	if actual_protocol != args.protocol or actual_migration != args.source_migration:
		raise ValueError("recovery source protocol/migration declarations do not match the manifest")
	try:
		subprocess.run(
			["git", "-C", str(root), "merge-base", "--is-ancestor", source_sha, args.candidate_sha],
			check=True,
			capture_output=True,
			text=True,
		)
	except subprocess.CalledProcessError as error:
		if error.returncode == 1:
			raise ValueError("recovery source is not an ancestor of the candidate") from error
		raise

	images = manifest.get("images", {})
	if not isinstance(images, dict):
		raise ValueError("recovery images must be an object")
	required_image_names = ("bff", "static", "operations")
	for name in required_image_names:
		if not isinstance(images.get(name), str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", images[name]):
			raise ValueError(f"recovery {name} image ID is invalid")

	contract = manifest.get("contract", {})
	if not isinstance(contract, dict):
		raise ValueError("recovery contract must be an object")
	if contract.get("peerTemplateRegistryVersions") != ["peer-effects-v1"]:
		raise ValueError("recovery peer template registry contract is incomplete")
	if contract.get("multiTargetTemplateRegistryVersions") != ["multi-target-effects-v1"]:
		raise ValueError("recovery multi-target template registry contract is incomplete")
	required_source_template_contracts = [
		{
			"sourceEntity": {"type": "spell", "uid": "cure wounds|phb", "version": "phb-2014-v1"},
			"effectTemplateId": "spell.cure-wounds.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 1, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
		{
			"sourceEntity": {"type": "spell", "uid": "cure wounds|xphb", "version": "xphb-2024-v1"},
			"effectTemplateId": "spell.cure-wounds.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 1, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
		{
			"sourceEntity": {"type": "spell", "uid": "healing word|phb", "version": "phb-2014-v1"},
			"effectTemplateId": "spell.healing-word.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 1, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
		{
			"sourceEntity": {"type": "spell", "uid": "healing word|xphb", "version": "xphb-2024-v1"},
			"effectTemplateId": "spell.healing-word.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 1, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
		{
			"sourceEntity": {"type": "spell", "uid": "mass healing word|phb", "version": "phb-2014-v1"},
			"effectTemplateId": "spell.mass-healing-word.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 3, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 6},
			"allowTargetNoOp": True,
		},
		{
			"sourceEntity": {"type": "spell", "uid": "mass healing word|xphb", "version": "xphb-2024-v1"},
			"effectTemplateId": "spell.mass-healing-word.heal",
			"choice": {"kind": "spellSlot", "minimumLevel": 3, "maximumLevel": 9},
			"sourceCost": {"version": 1, "component": {"kind": "spell_slot", "pool": "standard", "level": "choice.castLevel", "amount": 1}},
			"targetCount": {"minimum": 1, "maximum": 6},
			"allowTargetNoOp": True,
		},
		{
			"sourceEntity": {"type": "ability", "uid": "lay on hands|xphb", "version": "xphb-2024-v1"},
			"effectTemplateId": "ability.lay-on-hands.heal",
			"choice": {"kind": "integerAmount", "minimum": 1, "maximum": 100},
			"sourceCost": {
				"version": 1,
				"component": {
					"kind": "feature_use",
					"resourceId": "exact-persisted-resource",
					"featureRef": {"uid": "lay on hands|xphb"},
					"amount": "choice.amount",
				},
			},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
		{
			"sourceEntity": {"type": "ability", "uid": "lay on hands|xphb", "version": "xphb-2024-v1"},
			"effectTemplateId": "ability.lay-on-hands.heal",
			"choice": {"kind": "integerAmount", "minimum": 1, "maximum": 100},
			"sourceCost": {
				"version": 1,
				"component": {
					"kind": "feature_use",
					"resourceId": "exact-persisted-resource",
					"featureRef": {"uid": "lay on hands|paladin|xphb|1"},
					"amount": "choice.amount",
				},
			},
			"targetCount": {"minimum": 1, "maximum": 1},
		},
	]
	if contract.get("sourceTemplateContracts") != required_source_template_contracts:
		raise ValueError("recovery source/template/version/cost contract is incomplete")
	required_effects = {
		"spell.cure-wounds.heal",
		"spell.healing-word.heal",
		"spell.mass-healing-word.heal",
		"ability.lay-on-hands.heal",
	}
	effect_template_ids = contract.get("effectTemplateIds")
	if (
		not isinstance(effect_template_ids, list)
		or len(effect_template_ids) != len(required_effects)
		or set(effect_template_ids) != required_effects
	):
		raise ValueError("recovery effect template contract is incomplete or contains unknown handlers")
	workflows = contract.get("workflows", {})
	if not isinstance(workflows, dict):
		raise ValueError("recovery workflow contract must be an object")
	required_workflows = (
		"healingWord",
		"layOnHands",
		"exactReplay",
		"resourceMirrors",
		"privacy",
		"multiTargetLifecycle",
		"sourceTemplateMatrix",
	)
	if any(workflows.get(name) is not True for name in required_workflows):
		raise ValueError("recovery full-workflow contract is incomplete")
	if (
		workflows.get("layOnHandsMinimum") != 1
		or workflows.get("layOnHandsMaximum") != 100
		or workflows.get("layOnHandsBoundaryCases") != [1, 11, 100]
		or workflows.get("exactReplayCases") != [
			"healingWordPHB",
			"healingWordXPHB",
			"layOnHands11",
			"layOnHands100",
		]
		or workflows.get("multiTargetMaximum") != 6
	):
		raise ValueError("recovery boundary, replay, or multi-target amount contract is incomplete")
	if contract.get("configurationScope") != "current-exact-campaign-configuration":
		raise ValueError("recovery configuration scope is not pinned")
	configuration_binding = manifest.get("configurationBinding")
	if (
		not isinstance(configuration_binding, dict)
		or configuration_binding.get("algorithm") != "sha256"
		or configuration_binding.get("fields") != list(RECOVERY_CONFIGURATION_FIELDS)
		or not isinstance(configuration_binding.get("sha256"), str)
		or not re.fullmatch(r"[0-9a-f]{64}", configuration_binding["sha256"])
	):
		raise ValueError("recovery configuration fingerprint is invalid")
	configuration_sha256 = configuration_binding["sha256"]
	if args.compose_config is not None:
		_, resolved_configuration_sha256 = get_resolved_campaign_configuration(args.compose_config)
	elif args.configuration_sha256 is not None:
		resolved_configuration_sha256 = args.configuration_sha256
	else:
		resolved_configuration_sha256 = None
	if resolved_configuration_sha256 is not None:
		required_configuration_binding = {
			"algorithm": "sha256",
			"fields": list(RECOVERY_CONFIGURATION_FIELDS),
			"sha256": resolved_configuration_sha256,
		}
		if configuration_binding != required_configuration_binding:
			raise ValueError("recovery configuration fingerprint does not match resolved deployment inputs")

	qualification = manifest.get("qualification", {})
	if not isinstance(qualification, dict) or not isinstance(evidence, dict):
		raise ValueError("recovery qualification data must be objects")
	if qualification.get("status") != "passed" or qualification.get("type") != "isolated-exact-binary":
		raise ValueError("recovery qualification is not a successful exact-binary isolation")
	evidence_sha = hashlib.sha256(evidence_bytes).hexdigest()
	if qualification.get("evidenceSha256") != evidence_sha:
		raise ValueError("recovery qualification evidence hash does not match")
	if (
		evidence.get("status") != "passed"
		or evidence.get("type") != "isolated-exact-binary"
		or evidence.get("sourceSha") != source_sha
		or evidence.get("sourceTreeSha") != source_tree_sha
		or evidence.get("sourceTagName") != tag_name
		or evidence.get("sourceTagObjectSha") != tag_object_sha
		or evidence.get("protocolVersion") != args.protocol
		or evidence.get("requiredMigrationVersion") != args.source_migration
		or evidence.get("schemaCompatibleThrough") != schema_compatible_through
		or evidence.get("images") != images
		or evidence.get("contract") != contract
		or evidence.get("configurationBinding") != configuration_binding
	):
		raise ValueError("recovery qualification evidence does not bind the manifest")

	for key, value in (
		("source_sha", source_sha),
		("source_tree_sha", source_tree_sha),
		("source_tag_name", tag_name),
		("source_tag_object_sha", tag_object_sha),
		("protocol_version", args.protocol),
		("required_migration_version", args.source_migration),
		("configuration_sha256", configuration_sha256),
		("bff_image_id", images["bff"]),
		("static_image_id", images["static"]),
		("operations_image_id", images["operations"]),
		("schema_compatible_through", schema_compatible_through),
		("manifest_sha256", hashlib.sha256(manifest_path.read_bytes()).hexdigest()),
		("qualification_evidence_sha256", evidence_sha),
	):
		sys.stdout.write(f"{key}\t{value}\n")
	return 0


def command_recovery_driver_provenance(args: argparse.Namespace) -> int:
	manifest_path = Path(args.manifest)
	evidence_path = Path(args.evidence)
	for path in (manifest_path, evidence_path):
		info = path.lstat()
		if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
			raise ValueError(f"{path.name} must be a regular, non-symlink mode-0600 file")
	manifest_bytes = manifest_path.read_bytes()
	evidence_bytes = evidence_path.read_bytes()
	manifest = json.loads(manifest_bytes)
	evidence = json.loads(evidence_bytes)
	if manifest.get("schemaVersion") != 1 or manifest.get("type") != "never-deployed-recovery-driver":
		raise ValueError("recovery-driver provenance type is invalid")
	if manifest.get("deploymentStatus") != "never-deployed":
		raise ValueError("recovery-driver provenance must be explicitly never-deployed")
	source = manifest.get("source", {})
	build = manifest.get("build", {})
	image = manifest.get("image", {})
	qualification = manifest.get("qualification", {})
	if not isinstance(source, dict) or not isinstance(build, dict) or not isinstance(image, dict) or not isinstance(qualification, dict):
		raise ValueError("recovery-driver provenance sections are invalid")
	source_sha = source.get("sha")
	tree_sha = source.get("treeSha")
	image_id = image.get("id")
	if not isinstance(source_sha, str) or not FULL_SHA_PATTERN.fullmatch(source_sha):
		raise ValueError("recovery-driver source SHA is invalid")
	if not isinstance(tree_sha, str) or not FULL_SHA_PATTERN.fullmatch(tree_sha):
		raise ValueError("recovery-driver source tree SHA is invalid")
	if not isinstance(image_id, str) or not IMAGE_ID_PATTERN.fullmatch(image_id):
		raise ValueError("recovery-driver image ID is invalid")
	if qualification.get("status") != "passed" or qualification.get("type") != "reviewed-isolated-driver":
		raise ValueError("recovery-driver qualification is not independently reviewed")
	if qualification.get("evidenceSha256") != hashlib.sha256(evidence_bytes).hexdigest():
		raise ValueError("recovery-driver qualification evidence hash does not match")
	if (
		evidence.get("status") != "passed"
		or evidence.get("type") != "reviewed-isolated-driver"
		or evidence.get("sourceSha") != source_sha
		or evidence.get("sourceTreeSha") != tree_sha
		or evidence.get("imageId") != image_id
		or evidence.get("build") != build
	):
		raise ValueError("recovery-driver evidence does not bind the source/build/image")
	root = Path(args.git_root)
	if get_git_output(root, "rev-parse", "HEAD") != source_sha:
		raise ValueError("recovery-driver checkout does not match its pinned source")
	if get_git_output(root, "rev-parse", f"{source_sha}^{{tree}}") != tree_sha:
		raise ValueError("recovery-driver checkout tree does not match its pinned source")
	if get_git_output(root, "status", "--porcelain"):
		raise ValueError("recovery-driver checkout is not clean")
	dockerfile_sha256 = hashlib.sha256((root / "server/ops.Dockerfile").read_bytes()).hexdigest()
	package_lock_sha256 = hashlib.sha256((root / "package-lock.json").read_bytes()).hexdigest()
	if build.get("dockerfileSha256") != dockerfile_sha256 or build.get("packageLockSha256") != package_lock_sha256:
		raise ValueError("recovery-driver build inputs do not match the pinned source")
	for key, value in (
		("source_sha", source_sha),
		("source_tree_sha", tree_sha),
		("image_id", image_id),
		("manifest_sha256", hashlib.sha256(manifest_bytes).hexdigest()),
		("qualification_evidence_sha256", hashlib.sha256(evidence_bytes).hexdigest()),
	):
		sys.stdout.write(f"{key}\t{value}\n")
	return 0


def command_recovery_state(args: argparse.Namespace) -> int:
	path = Path(args.state)
	info = path.lstat()
	if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
		raise ValueError("active recovery state must be a regular, non-symlink mode-0600 file")
	state: dict[str, str] = {}
	for line in path.read_text(encoding="utf-8").splitlines():
		key, separator, value = line.partition("\t")
		if not separator or key in state or not re.fullmatch(r"[a-z][a-z0-9_]*", key):
			raise ValueError("active recovery state contains invalid or duplicate fields")
		state[key] = value
	required = {
		"status", "source_sha", "source_tree_sha", "source_tag_name", "source_tag_object_sha",
		"protocol_version", "required_migration_version", "schema_compatible_through",
		"bff_image_id", "static_image_id", "operations_image_id", "bff_image_ref",
		"static_image_ref", "backup_image_ref", "maintenance_image_ref", "configuration_sha256",
		"manifest_sha256", "qualification_evidence_sha256", "executing_engine_source_sha",
		"executing_engine_tree_sha", "control_source_sha",
		"control_tree_sha", "control_release_script_sha256", "control_helper_sha256",
		"control_migrate_image_id", "control_grant_roles_image_id",
	}
	if set(state) != required or state.get("status") != "active":
		raise ValueError("active recovery state is incomplete or requires manual recovery")
	for key in (
		"source_sha", "source_tree_sha", "source_tag_object_sha", "executing_engine_source_sha",
		"executing_engine_tree_sha", "control_source_sha", "control_tree_sha",
	):
		if not FULL_SHA_PATTERN.fullmatch(state[key]):
			raise ValueError(f"active recovery state {key} is invalid")
	if (
		state["executing_engine_source_sha"] != state["control_source_sha"]
		or state["executing_engine_tree_sha"] != state["control_tree_sha"]
	):
		raise ValueError("active recovery state does not bind the executing release engine")
	for key in ("manifest_sha256", "qualification_evidence_sha256", "configuration_sha256", "control_release_script_sha256", "control_helper_sha256"):
		if not re.fullmatch(r"[0-9a-f]{64}", state[key]):
			raise ValueError(f"active recovery state {key} is invalid")
	for key in ("bff_image_id", "static_image_id", "operations_image_id", "control_migrate_image_id", "control_grant_roles_image_id"):
		if not IMAGE_ID_PATTERN.fullmatch(state[key]):
			raise ValueError(f"active recovery state {key} is invalid")
	for key in ("bff_image_ref", "static_image_ref", "backup_image_ref", "maintenance_image_ref"):
		if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}", state[key]):
			raise ValueError(f"active recovery state {key} is invalid")
	if not RECOVERY_TAG_PATTERN.fullmatch(state["source_tag_name"]):
		raise ValueError("active recovery state tag name is invalid")
	root = Path(args.git_root)
	if get_git_output(root, "rev-parse", "HEAD") != args.current_sha:
		raise ValueError("release control checkout changed during active fallback")
	if args.current_sha != state["control_source_sha"]:
		raise ValueError("active fallback control source does not match the checked-out engine")
	if get_git_output(root, "rev-parse", f'{state["control_source_sha"]}^{{tree}}') != state["control_tree_sha"]:
		raise ValueError("active fallback control source tree changed")
	if hashlib.sha256((root / "deploy/hub/release.sh").read_bytes()).hexdigest() != state["control_release_script_sha256"]:
		raise ValueError("active fallback release engine changed")
	if hashlib.sha256((root / "deploy/hub/release-helper.py").read_bytes()).hexdigest() != state["control_helper_sha256"]:
		raise ValueError("active fallback release helper changed")
	if not FULL_SHA_PATTERN.fullmatch(args.candidate_sha):
		raise ValueError("next release candidate SHA is invalid")
	try:
		subprocess.run(
			["git", "-C", str(root), "merge-base", "--is-ancestor", state["control_source_sha"], args.candidate_sha],
			check=True,
			capture_output=True,
			text=True,
		)
	except subprocess.CalledProcessError as error:
		if error.returncode == 1:
			raise ValueError("next release candidate does not descend from the active control source") from error
		raise
	if get_git_output(root, "cat-file", "-t", f'refs/tags/{state["source_tag_name"]}') != "tag":
		raise ValueError("active fallback source tag is no longer annotated")
	if get_git_output(root, "rev-parse", f'refs/tags/{state["source_tag_name"]}') != state["source_tag_object_sha"]:
		raise ValueError("active fallback tag object changed")
	if get_git_output(root, "rev-parse", f'refs/tags/{state["source_tag_name"]}^{{}}') != state["source_sha"]:
		raise ValueError("active fallback tag does not peel to its source")
	actual_protocol, actual_migration = get_source_declarations(root, state["source_sha"])
	if actual_protocol != state["protocol_version"] or actual_migration != state["required_migration_version"]:
		raise ValueError("active fallback source declarations changed")
	try:
		subprocess.run(
			["git", "-C", str(root), "merge-base", "--is-ancestor", state["source_sha"], args.candidate_sha],
			check=True,
			capture_output=True,
			text=True,
		)
	except subprocess.CalledProcessError as error:
		if error.returncode == 1:
			raise ValueError("next release candidate does not include the active fallback source") from error
		raise
	if int(args.candidate_protocol) < 6 or not re.fullmatch(r"[0-9]{4}", args.candidate_migration):
		raise ValueError("next release is not A7-compatible")
	if int(state["protocol_version"]) < 6 or state["schema_compatible_through"] < args.candidate_migration:
		raise ValueError("active fallback is not compatible with the next release schema")
	if args.configuration_sha256 != state["configuration_sha256"]:
		raise ValueError("active fallback campaign configuration changed")
	for key, value in state.items():
		sys.stdout.write(f"{key}\t{value}\n")
	return 0


def command_recovery_job_state(args: argparse.Namespace) -> int:
	state_path = Path(args.state)
	env_path = Path(args.env)
	blocked_path = Path(args.blocked)
	_load_recovery_job_binding(state_path, env_path, blocked_path)
	return 0


def _read_private_regular_file(path: Path, label: str) -> str | None:
	try:
		info = path.lstat()
	except FileNotFoundError:
		return None
	if (
		not stat.S_ISREG(info.st_mode)
		or stat.S_ISLNK(info.st_mode)
		or stat.S_IMODE(info.st_mode) != 0o600
		or info.st_uid != os.geteuid()
	):
		raise ValueError(f"{label} must be an owned regular, non-symlink mode-0600 file")
	return path.read_text(encoding="utf-8")


def _parse_tsv_records(text: str, label: str) -> dict[str, str]:
	records: dict[str, str] = {}
	for line in text.splitlines():
		key, separator, value = line.partition("\t")
		if not separator or key in records or not re.fullmatch(r"[a-z][a-z0-9_]*", key):
			raise ValueError(f"{label} contains invalid or duplicate fields")
		records[key] = value
	return records


def _load_recovery_job_binding(state_path: Path, env_path: Path, blocked_path: Path) -> dict[str, str] | None:
	try:
		blocked_path.lstat()
	except FileNotFoundError:
		pass
	else:
		raise ValueError("recovery-mode transition is fenced; scheduled jobs are unavailable")

	state_text = _read_private_regular_file(state_path, "recovery-mode state")
	env_text = _read_private_regular_file(env_path, "recovery-mode job environment")
	if state_text is None and env_text is None:
		return None
	if state_text is None or env_text is None:
		raise ValueError("recovery-mode state and job environment are incomplete")

	state = _parse_tsv_records(state_text, "recovery-mode state")
	if set(state) != ACTIVE_FALLBACK_STATE_FIELDS or state.get("status") != "active":
		raise ValueError("recovery-mode state is incomplete or requires manual recovery")
	for key in (
		"source_sha", "source_tree_sha", "source_tag_object_sha", "executing_engine_source_sha",
		"executing_engine_tree_sha", "control_source_sha", "control_tree_sha",
	):
		if not FULL_SHA_PATTERN.fullmatch(state[key]):
			raise ValueError(f"recovery-mode state {key} is invalid")
	if (
		state["executing_engine_source_sha"] != state["control_source_sha"]
		or state["executing_engine_tree_sha"] != state["control_tree_sha"]
	):
		raise ValueError("recovery-mode state does not bind the executing release engine")
	for key in (
		"manifest_sha256", "qualification_evidence_sha256", "configuration_sha256",
		"control_release_script_sha256", "control_helper_sha256",
	):
		if not re.fullmatch(r"[0-9a-f]{64}", state[key]):
			raise ValueError(f"recovery-mode state {key} is invalid")
	for key in (
		"bff_image_id", "static_image_id", "operations_image_id", "control_migrate_image_id",
		"control_grant_roles_image_id",
	):
		if not IMAGE_ID_PATTERN.fullmatch(state[key]):
			raise ValueError(f"recovery-mode state {key} is invalid")
	for key in ("bff_image_ref", "static_image_ref", "backup_image_ref", "maintenance_image_ref"):
		if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}", state[key]):
			raise ValueError(f"recovery-mode state {key} is invalid")
	if not RECOVERY_TAG_PATTERN.fullmatch(state["source_tag_name"]):
		raise ValueError("recovery-mode source tag is invalid")
	if (
		state["protocol_version"] != "6"
		or not re.fullmatch(r"[0-9]{4}", state["required_migration_version"])
		or not re.fullmatch(r"[0-9]{4}", state["schema_compatible_through"])
		or int(state["schema_compatible_through"]) < int(state["required_migration_version"])
		or state["maintenance_image_ref"] != state["bff_image_ref"]
		or len({state["bff_image_id"], state["static_image_id"], state["operations_image_id"]}) != 3
		or len({state["bff_image_ref"], state["static_image_ref"], state["backup_image_ref"]}) != 3
	):
		raise ValueError("recovery-mode source or image projection is invalid")

	job_env: dict[str, str] = {}
	for line in env_text.splitlines():
		key, separator, value = line.partition("=")
		if not separator or key in job_env or key not in RECOVERY_JOB_ENV_FIELDS:
			raise ValueError("recovery-mode job environment contains invalid or duplicate fields")
		job_env[key] = value
	if (
		set(job_env) != RECOVERY_JOB_ENV_FIELDS
		or not IMAGE_ID_PATTERN.fullmatch(job_env["HUB_RECOVERY_BFF_IMAGE"])
		or not IMAGE_ID_PATTERN.fullmatch(job_env["HUB_RECOVERY_BACKUP_IMAGE"])
		or job_env["HUB_RECOVERY_BFF_IMAGE"] != state["bff_image_id"]
		or job_env["HUB_RECOVERY_BACKUP_IMAGE"] != state["operations_image_id"]
	):
		raise ValueError("recovery-mode job environment does not match the complete active fallback state")
	return job_env


def _acquire_job_lock(path: Path, label: str) -> int:
	flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
	fd = os.open(path, flags, 0o600)
	try:
		info = os.fstat(fd)
		if not stat.S_ISREG(info.st_mode):
			raise ValueError(f"{label} lock must be a regular file")
		try:
			fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
		except OSError as error:
			if error.errno in (errno.EACCES, errno.EAGAIN):
				raise ValueError(f"{label} lock is already held") from error
			raise
		return fd
	except BaseException:
		os.close(fd)
		raise


def command_recovery_job_run(args: argparse.Namespace) -> int:
	command = list(args.command)
	if command and command[0] == "--":
		command = command[1:]
	if not command:
		raise ValueError("scheduled job command is missing")

	lock_fds: list[int] = []
	try:
		# Match release.sh's admission lock first, then retain the established per-job lock.
		lock_fds.append(_acquire_job_lock(Path(args.admission_lock), "release admission"))
		lock_fds.append(_acquire_job_lock(Path(args.job_lock), "scheduled job"))
		binding = _load_recovery_job_binding(Path(args.state), Path(args.env), Path(args.blocked))
		child_env = os.environ.copy()
		for key in RECOVERY_JOB_ENV_FIELDS:
			child_env[key] = ""
		if binding is not None:
			child_env.update(binding)
		sys.stdout.write(
			"hub recovery job: admitted with active immutable image binding\n"
			if binding is not None else
			"hub recovery job: admitted in normal mode\n"
		)
		sys.stdout.flush()
		result = subprocess.run(command, env=child_env, check=False, pass_fds=tuple(lock_fds))
		if result.returncode:
			sys.stderr.write(f"hub recovery job: foreground command exited with status {result.returncode}\n")
		return result.returncode if result.returncode >= 0 else 128 - result.returncode
	finally:
		for fd in reversed(lock_fds):
			os.close(fd)


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

	recovery_parser = subparsers.add_parser("recovery-manifest")
	recovery_parser.add_argument("--manifest", required=True)
	recovery_parser.add_argument("--evidence", required=True)
	recovery_parser.add_argument("--git-root", required=True)
	recovery_parser.add_argument("--candidate-sha", required=True)
	recovery_parser.add_argument("--protocol", required=True)
	recovery_parser.add_argument("--source-migration", required=True)
	recovery_parser.add_argument("--migration", required=True)
	recovery_parser.add_argument("--compose-config")
	recovery_parser.add_argument("--configuration-sha256")
	recovery_parser.set_defaults(handler=command_recovery_manifest)

	config_parser = subparsers.add_parser("configuration-fingerprint")
	config_parser.add_argument("--compose-config", required=True)
	config_parser.set_defaults(handler=command_configuration_fingerprint)

	image_refs_parser = subparsers.add_parser("recovery-image-references")
	image_refs_parser.add_argument("--compose-config", required=True)
	image_refs_parser.set_defaults(handler=command_recovery_image_references)

	driver_parser = subparsers.add_parser("recovery-driver-provenance")
	driver_parser.add_argument("--manifest", required=True)
	driver_parser.add_argument("--evidence", required=True)
	driver_parser.add_argument("--git-root", required=True)
	driver_parser.set_defaults(handler=command_recovery_driver_provenance)

	recovery_state_parser = subparsers.add_parser("recovery-state")
	recovery_state_parser.add_argument("--state", required=True)
	recovery_state_parser.add_argument("--git-root", required=True)
	recovery_state_parser.add_argument("--current-sha", required=True)
	recovery_state_parser.add_argument("--candidate-sha", required=True)
	recovery_state_parser.add_argument("--candidate-protocol", required=True)
	recovery_state_parser.add_argument("--candidate-migration", required=True)
	recovery_state_parser.add_argument("--configuration-sha256", required=True)
	recovery_state_parser.set_defaults(handler=command_recovery_state)

	recovery_job_state_parser = subparsers.add_parser("recovery-job-state")
	recovery_job_state_parser.add_argument("--state", required=True)
	recovery_job_state_parser.add_argument("--env", required=True)
	recovery_job_state_parser.add_argument("--blocked", required=True)
	recovery_job_state_parser.set_defaults(handler=command_recovery_job_state)

	recovery_job_run_parser = subparsers.add_parser("recovery-job-run")
	recovery_job_run_parser.add_argument("--state", required=True)
	recovery_job_run_parser.add_argument("--env", required=True)
	recovery_job_run_parser.add_argument("--blocked", required=True)
	recovery_job_run_parser.add_argument("--admission-lock", required=True)
	recovery_job_run_parser.add_argument("--job-lock", required=True)
	recovery_job_run_parser.add_argument("command", nargs=argparse.REMAINDER)
	recovery_job_run_parser.set_defaults(handler=command_recovery_job_run)

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
	except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError, TypeError, AttributeError) as error:
		sys.stderr.write(f"release helper failed: {redact(str(error))}\n")
		return 1


if __name__ == "__main__":
	raise SystemExit(main())
