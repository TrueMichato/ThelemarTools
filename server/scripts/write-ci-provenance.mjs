import crypto from "node:crypto";
import fs from "node:fs";

const imageRef = process.env.HUB_CI_IMAGE_REF?.trim();
const archiveSha256 = process.env.HUB_CI_IMAGE_ARCHIVE_SHA256?.trim();
const sourceCommit = process.env.GITHUB_SHA?.trim();
if (!imageRef || !archiveSha256 || !sourceCommit) {
	throw new Error("HUB_CI_IMAGE_REF, HUB_CI_IMAGE_ARCHIVE_SHA256, and GITHUB_SHA are required.");
}
if (!/^[a-f0-9]{64}$/.test(archiveSha256)) {
	throw new Error("HUB_CI_IMAGE_ARCHIVE_SHA256 must be a lowercase SHA-256 checksum.");
}
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("GITHUB_SHA must be a full commit SHA.");

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lockBytes = fs.readFileSync("package-lock.json");
const evidence = {
	schemaVersion: 1,
	source: {
		repository: process.env.GITHUB_REPOSITORY || null,
		commit: sourceCommit,
	},
	image: {
		ref: imageRef,
		archive: {
			path: "hub-bff-image.tar",
			sha256: archiveSha256,
		},
		registryDigest: null,
	},
	versions: {
		app: packageJson.version,
		protocol: "1",
		migration: "0004",
	},
	inputs: {
		packageLockSha256: crypto.createHash("sha256").update(lockBytes).digest("hex"),
	},
	ci: {
		runId: process.env.GITHUB_RUN_ID || null,
		runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
		workflowRef: process.env.GITHUB_WORKFLOW_REF || null,
	},
	generatedAt: new Date().toISOString(),
};

fs.writeFileSync("hub-ci-provenance.json", `${JSON.stringify(evidence, null, 2)}\n`, {mode: 0o600});
process.stdout.write(`${imageRef} archive sha256:${archiveSha256}\n`);
