import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Hub portable deployment contract", () => {
	const dockerfile = read("server/Dockerfile");
	const dockerignore = read("server/Dockerfile.dockerignore");
	const compose = read("compose.hub.yml");
	const publicCompose = read("compose.hub.public.yml");
	const caddy = read("deploy/hub/Caddyfile");
	const publicCaddy = read("deploy/hub/Caddyfile.public");
	const staticDockerfile = read("deploy/hub/static.Dockerfile");
	const staticDockerignore = read(".dockerignore");
	const serviceWorkerBuild = read("node/build-sw.mjs");
	const opsDockerfile = read("server/ops.Dockerfile");
	const opsDockerignore = read("server/ops.Dockerfile.dockerignore");
	const roles = read("deploy/hub/init-roles.sh");
	const monitor = read("deploy/hub/monitor-host.sh");
	const pullBackups = read("deploy/hub/pull-backups.sh");
	const backupService = read("deploy/hub/systemd/thelemar-hub-backup.service");
	const backupTimer = read("deploy/hub/systemd/thelemar-hub-backup.timer");
	const maintenanceTimer = read("deploy/hub/systemd/thelemar-hub-maintenance.timer");
	const monitorTimer = read("deploy/hub/systemd/thelemar-hub-monitor.timer");
	const oracleOperations = read("docs/hub/runbooks/oracle-operations.md");

	it("builds a separate pinned non-root Node BFF image with safe health checking", () => {
		expect(dockerfile).toContain("FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e");
		expect(dockerfile).toContain("USER 10001:10001");
		expect(dockerfile).toContain("npm ci --omit=dev --ignore-scripts");
		expect(dockerfile).toContain("--fetch-retries=5");
		expect(dockerfile).toContain("ARG NPM_REGISTRY=https://registry.npmjs.org/");
		expect(dockerfile).toContain("org.opencontainers.image.revision");
		expect(dockerfile).toContain("/api/live");
		expect(dockerfile).toContain(`CMD ["node", "server/src/index.js"]`);
	});

	it("keeps package-manager tooling and the build lockfile out of the BFF runtime", () => {
		for (const path of [
			"/usr/local/lib/node_modules",
			"/usr/local/bin/corepack",
			"/usr/local/bin/npm",
			"/usr/local/bin/npx",
			"/usr/local/bin/yarn",
			"/usr/local/bin/yarnpkg",
			"/opt/yarn-v*",
		]) expect(dockerfile).toContain(path);
		expect(dockerfile).toContain("COPY --chown=hub:hub package.json ./");
		expect(dockerfile).not.toContain("COPY --chown=hub:hub package.json package-lock.json ./");
	});

	it("limits the BFF build context to runtime files and its shared patch helper", () => {
		expect(dockerignore).toContain("!server/**");
		expect(dockerignore).toContain("!js/hub/hub-json-patch.js");
		expect(dockerignore).not.toContain("!data");
	});

	it("keeps event snapshot enrichment inside the packaged server tree", () => {
		const memoryStore = read("server/src/memory-hub-store.js");
		const postgresStore = read("server/src/postgres-hub-store.js");
		for (const source of [memoryStore, postgresStore]) {
			expect(source).toContain("from \"./hub-event-snapshots.js\"");
			expect(source).not.toContain("../../js/hub/hub-event-presentation.js");
		}
		expect(dockerfile).toContain("COPY --chown=hub:hub server ./server");
	});

	it("orders database, migration, grants, BFF, static site, and edge services", () => {
		for (const service of ["db:", "migrate:", "grant-roles:", "bff:", "static:", "edge:"]) expect(compose).toContain(`  ${service}`);
		expect(compose).toContain("service_completed_successfully");
		expect(compose).toContain("postgres:17.6-bookworm");
		expect(compose).toContain("pg_isready -h 127.0.0.1");
		expect(compose).toContain("start_period: 30s");
		expect(compose).toContain("read_only: true");
		expect(compose).toContain("hub_runtime:");
		expect(compose).toContain("internal: true");
		expect(compose).toContain("hub-public:");
		expect(compose).toContain("hub-egress:");
		expect(compose).toContain("172.30.0.10");
		expect(compose).toMatch(/bff:[\s\S]*?networks:\n\s+- hub-private\n\s+- hub-egress[\s\S]*?static:/);
		expect(compose).toMatch(/edge:[\s\S]*?networks:\n\s+hub-private:\n\s+ipv4_address: 172\.30\.0\.10\n\s+hub-public:/);
		expect(compose).toMatch(/HUB_TRUST_PROXY: \$\{HUB_TRUST_PROXY:-172\.30\.0\.10}/);
	});

	it("runs every BFF-image service without package-manager tooling", () => {
		const serviceBlocks = [...compose.matchAll(/^ {2}([a-z0-9-]+):\n([\s\S]*?)(?=^ {2}[a-z0-9-]+:|^volumes:)/gm)]
			.filter(([, , block]) => block.includes("dockerfile: server/Dockerfile"));
		expect(serviceBlocks.map(([, name]) => name)).toEqual(["migrate", "grant-roles", "bff", "maintenance"]);
		for (const [, , block] of serviceBlocks) expect(block).not.toMatch(/\b(?:npm|npx|corepack|yarn|yarnpkg)\b/);
		expect(compose).toContain(`command: ["node", "server/scripts/migrate.mjs"]`);
		expect(compose).toContain(`command: ["node", "server/scripts/grant-roles.mjs"]`);
		expect(compose).toContain(`command: ["node", "server/scripts/maintenance.mjs"]`);
	});

	it("keeps API, auth, WebSocket, and static traffic on one edge origin", () => {
		for (const prefix of ["/api/*", "/auth/*", "/ws/*"]) expect(caddy).toContain(`handle ${prefix}`);
		expect(caddy).toContain("reverse_proxy bff:5052");
		expect(caddy).toContain("reverse_proxy static:80");
		expect(caddy).toContain("tls internal");
		for (const config of [caddy, publicCaddy]) {
			expect(config).toContain("header Cache-Control \"public, max-age=0, must-revalidate\"");
			expect(config.indexOf("header Cache-Control")).toBeGreaterThan(config.indexOf("handle {"));
		}
	});

	it("generates production service workers inside the static image build", () => {
		expect(staticDockerfile).toContain("FROM node:24.7.0-bookworm-slim AS service-worker");
		expect(staticDockerfile).toContain("deploy/hub/static-build/package-lock.json");
		expect(staticDockerfile).toContain("npm ci --ignore-scripts");
		expect(staticDockerfile).toContain("node node/build-sw.mjs prod");
		expect(staticDockerfile).toContain("rm -rf deploy node node_modules");
		expect(staticDockerfile).toContain("FROM caddy:2.8.4-alpine");
		expect(staticDockerfile).toContain("COPY --from=service-worker /site /srv");
		expect(staticDockerfile).toContain(`"file-server"`);
		expect(compose).toContain("dockerfile: deploy/hub/static.Dockerfile");
		for (const required of [
			"!package.json",
			"!package-lock.json",
			"!node",
			"!sw-template.js",
			"!sw-injector-template.js",
			"!*.ico",
			"!deploy/hub/static-build/package-lock.json",
		]) expect(staticDockerignore).toContain(required);
		expect(serviceWorkerBuild).toContain(`"*.ico"`);
	});

	it("creates runtime and backup identities without embedding passwords", () => {
		expect(roles).toContain("CREATE ROLE hub_runtime");
		expect(roles).toContain("CREATE ROLE hub_backup");
		expect(roles).toContain("CREATE ROLE hub_operations");
		expect(roles).toContain(":'runtime_password'");
		expect(roles).not.toMatch(/PASSWORD\s+'[^']+'/);
	});

	it("provides one-shot maintenance and encrypted backup profiles", () => {
		expect(compose).toContain(`profiles: ["maintenance"]`);
		expect(compose).toContain(`profiles: ["backup"]`);
		expect(compose).toContain("server/scripts/maintenance.mjs");
		expect(compose).toContain("backup-encrypted.mjs");
		expect(opsDockerfile).toContain("FROM postgres:17.6-bookworm");
		expect(opsDockerfile).toContain("USER postgres");
		expect(opsDockerignore).toContain("!server/scripts/**");
	});

	it("makes Oracle backup output host-readable and safe to copy off-machine", () => {
		expect(publicCompose).toContain("HUB_BACKUP_DIR:-./.hub-backups");
		expect(publicCompose).toContain("HUB_BACKUP_UID:-1000");
		expect(pullBackups).toContain("--ignore-existing");
		expect(pullBackups).toContain("--include='hub-*.dump.enc'");
		expect(pullBackups).not.toContain("--delete");
		expect(pullBackups).toContain("-mmin -1800");
		expect(oracleOperations).toContain("Run this on a different trusted computer, not on the Oracle VM.");
		expect(oracleOperations).toContain("Never restore over the production database.");
	});

	it("ships persistent Oracle maintenance, backup, and monitoring timers", () => {
		for (const timer of [backupTimer, maintenanceTimer, monitorTimer]) expect(timer).toContain("Persistent=true");
		expect(backupService).toContain("RuntimeDirectory=thelemar-hub");
		expect(backupService).toContain("/usr/bin/flock -n /run/thelemar-hub/backup.lock");
		expect(monitor).toMatch(/curl --silent --show-error --fail --max-time 15 "\$\{base_url\}\/api\/ready"/);
		expect(monitor).toMatch(/--header "Authorization: Bearer \$\{HUB_METRICS_TOKEN\}"/);
		expect(monitor).toMatch(/--header "Origin: \$\{base_url\}"/);
		expect(monitor).toContain("openssl x509 -in \"$certificate_file\" -noout -checkend 1209600");
		for (const metric of [
			"hub_outbox_oldest_age_seconds",
			"hub_outbox_failed",
			"hub_last_maintenance_age_seconds",
			"hub_last_backup_age_seconds",
			"hub_last_restore_drill_age_seconds",
		]) expect(monitor).toContain(metric);
		expect(monitor).not.toContain("character");
	});

	it("keeps local secrets out of Git and the BFF image context", () => {
		const gitignore = read(".gitignore");
		expect(gitignore).toContain("**/.env.*");
		expect(dockerignore).toContain("server/.env*");
		expect(dockerignore).toContain("!server/.env*.example");
	});
});
