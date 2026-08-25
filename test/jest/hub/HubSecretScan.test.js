import {getPotentialSecretFindings} from "../../../server/scripts/check-secrets.mjs";

describe("Hub tracked-file secret scan", () => {
	it("detects Hub credential assignments and provider tokens", () => {
		const findings = getPotentialSecretFindings({
			file: "server/config.yml",
			content: [
				"HUB_" + `COOKIE_SECRET: "01234567890123456789012345678901"`,
				"GITHUB_" + "CLIENT_SECRET=actual-client-secret",
				"DATABASE_" + "URL=postgresql://hub:real-password@database.internal/hub",
				`token: "${"ghp_"}abcdefghijklmnopqrstuvwxyz1234567890"`,
				`fine: "${"github_" + "pat_"}abcdefghijklmnopqrstuvwxyz1234567890"`,
			].join("\n"),
		});
		expect(findings).toEqual(expect.arrayContaining([
			expect.stringContaining("hard-coded HUB_COOKIE_SECRET"),
			expect.stringContaining("hard-coded GITHUB_CLIENT_SECRET"),
			expect.stringContaining("hard-coded DATABASE_URL"),
			expect.stringContaining("GitHub token"),
			expect.stringContaining("GitHub fine-grained token"),
		]));
	});

	it("allows runtime injection and documented placeholders", () => {
		const findings = getPotentialSecretFindings({
			file: "compose.hub.yml",
			content: [
				`HUB_COOKIE_SECRET: \${HUB_COOKIE_SECRET:?Set HUB_COOKIE_SECRET}`,
				`HUB_BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 32)"`,
				`DATABASE_URL=postgresql://.../hub_restore_drill`,
			].join("\n"),
		});
		expect(findings).toEqual([]);
	});

	it("detects shell export, Docker ENV, and inline JSON assignments", () => {
		const secretName = "HUB_" + "COOKIE_SECRET";
		const findings = getPotentialSecretFindings({
			file: "deploy/config.txt",
			content: [
				`export ${secretName}=shell-secret-value`,
				`ENV ${secretName}=docker-secret-value`,
				`{"mode":"prod","${secretName}":"json-secret-value"}`,
			].join("\n"),
		});
		expect(findings.filter(it => it.includes(`hard-coded ${secretName}`))).toHaveLength(3);
	});

	it("detects continued shell and Docker assignments", () => {
		const secretName = "HUB_" + "COOKIE_SECRET";
		const findings = getPotentialSecretFindings({
			file: "deploy/config.txt",
			content: [
				`export ${secretName}=\\`,
				"  continued-shell-secret",
				`ENV ${secretName} \\`,
				"  continued-docker-secret",
			].join("\n"),
		});
		expect(findings.filter(it => it.includes(`hard-coded ${secretName}`))).toHaveLength(2);
	});

	it("rejects a tracked non-example environment file", () => {
		expect(getPotentialSecretFindings({file: ".env.production", content: ""})).toEqual([
			".env.production: tracked environment file",
		]);
	});
});
