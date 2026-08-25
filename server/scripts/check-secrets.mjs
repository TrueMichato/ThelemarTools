import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const patterns = [
	["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
	["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
	["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
	["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
	["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
const credentialNames = [
	"DATABASE_URL",
	"GITHUB_CLIENT_SECRET",
	"HUB_BACKUP_DB_PASSWORD",
	"HUB_BACKUP_ENCRYPTION_KEY",
	"HUB_COOKIE_SECRET",
	"HUB_CSRF_SECRET",
	"HUB_METRICS_TOKEN",
	"HUB_OPERATIONS_DATABASE_URL",
	"HUB_OPERATIONS_DB_PASSWORD",
	"HUB_POSTGRES_PASSWORD",
	"HUB_RUNTIME_DB_PASSWORD",
	"HUB_TEST_AUTH_SECRET",
];
const credentialAssignments = [
	new RegExp(`^\\s*(?:export\\s+)?["']?(${credentialNames.join("|")})["']?\\s*(?::|=)\\s*(.+)$`),
	new RegExp(`^\\s*ENV\\s+["']?(${credentialNames.join("|")})["']?(?:\\s+|=)\\s*(.+)$`),
	new RegExp(`(?:^|[{,])\\s*["'](${credentialNames.join("|")})["']\\s*:\\s*(".*?"|'.*?'|[^,}]+)`, "g"),
];

function isSafeCredentialAssignment ({file, rawValue}) {
	const value = rawValue
		.replace(/\s+#.*$/, "")
		.replace(/\s*\\\s*$/, "")
		.replace(/[;,]\s*$/, "")
		.trim()
		.replace(/^(["'])(.*)\1$/, "$2");
	if (!value) return true;
	if (/\$\{|\$\(|\$[A-Z_]|process\.env|crypto\.randomBytes|^<.+>|^\.\.\.(?:\s|$)/i.test(value)) return true;
	if (/^postgresql:\/\/.*(?:\.\.\.|127\.0\.0\.1)/.test(value)) return true;
	if (/replace|example|placeholder|change-me|redacted/i.test(value)) return true;
	if (/^server\/\.env.*\.example$/.test(file)) return true;
	if (/^(?:hub-(?:owner|runtime|backup|operations)|e2e(?:-secret)?|test-secret)$/.test(value)
		&& /^(?:\.github\/workflows\/|test\/|compose\.hub\.test\.yml$)/.test(file)) return true;
	if (/^postgresql:\/\/[^@]+@127\.0\.0\.1(?::\d+)?\//.test(value)
		&& /^(?:\.github\/workflows\/|test\/)/.test(file)) return true;
	return false;
}

export function getPotentialSecretFindings ({file, content}) {
	const findings = [];
	if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file)) {
		return [`${file}: tracked environment file`];
	}
	for (const [label, pattern] of patterns) {
		if (pattern.test(content)) findings.push(`${file}: ${label}`);
	}
	const logicalLines = [];
	let current = null;
	for (const [index, physicalLine] of content.split(/\r?\n/).entries()) {
		const isContinued = /\\\s*$/.test(physicalLine);
		const part = physicalLine.replace(/\\\s*$/, "").trim();
		if (!current) current = {index, text: part};
		else current.text += ` ${part}`;
		if (!isContinued) {
			logicalLines.push(current);
			current = null;
		}
	}
	if (current) logicalLines.push(current);
	for (const {index, text: line} of logicalLines) {
		for (const pattern of credentialAssignments) {
			pattern.lastIndex = 0;
			const matches = pattern.global ? line.matchAll(pattern) : [pattern.exec(line)].filter(Boolean);
			for (const match of matches) {
				if (!isSafeCredentialAssignment({file, rawValue: match[2]})) {
					findings.push(`${file}:${index + 1}: hard-coded ${match[1]}`);
				}
			}
		}
	}
	return findings;
}

function main () {
	const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {encoding: "utf8"});
	if (listed.error) throw listed.error;
	if (listed.status !== 0) throw new Error(`git ls-files failed.`);
	const files = listed.stdout.split("\0").filter(Boolean);
	const findings = [];
	let scannedFiles = 0;
	let skippedBinaryFiles = 0;
	for (const file of files) {
		if (/\.(?:png|jpe?g|gif|webp|woff2?|ttf|ico|pdf|zip|gz|br|wasm|mp[34]|webm|ogg|dump|enc)$/i.test(file)) {
			skippedBinaryFiles++;
			continue;
		}
		scannedFiles++;
		findings.push(...getPotentialSecretFindings({file, content: fs.readFileSync(file, "utf8")}));
	}
	if (findings.length) {
		process.stderr.write(`Potential tracked secrets:\n${findings.map(it => `- ${it}`).join("\n")}\n`);
		process.exit(1);
	}
	process.stdout.write(`Hub secret scan passed (${scannedFiles} text files scanned; ${skippedBinaryFiles} known binary files skipped).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
