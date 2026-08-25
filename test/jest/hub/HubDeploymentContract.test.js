import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Hub portable deployment contract", () => {
	const dockerfile = read("server/Dockerfile");
	const dockerignore = read("server/Dockerfile.dockerignore");
	const compose = read("compose.hub.yml");
	const caddy = read("deploy/hub/Caddyfile");
	const staticDockerfile = read("deploy/hub/static.Dockerfile");
	const roles = read("deploy/hub/init-roles.sh");

	it("builds a separate pinned non-root Node BFF image with safe health checking", () => {
		expect(dockerfile).toContain("FROM node:24.7.0-bookworm-slim");
		expect(dockerfile).toContain("USER 10001:10001");
		expect(dockerfile).toContain("npm ci --omit=dev --ignore-scripts");
		expect(dockerfile).toContain("--fetch-retries=5");
		expect(dockerfile).toContain("ARG NPM_REGISTRY=https://registry.npmjs.org/");
		expect(dockerfile).toContain("org.opencontainers.image.revision");
		expect(dockerfile).toContain("/api/live");
		expect(dockerfile).toContain(`CMD ["node", "server/src/index.js"]`);
	});

	it("limits the BFF build context to runtime files and its shared patch helper", () => {
		expect(dockerignore).toContain("!server/**");
		expect(dockerignore).toContain("!js/hub/hub-json-patch.js");
		expect(dockerignore).not.toContain("!data");
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

	it("keeps API, auth, WebSocket, and static traffic on one edge origin", () => {
		for (const prefix of ["/api/*", "/auth/*", "/ws/*"]) expect(caddy).toContain(`handle ${prefix}`);
		expect(caddy).toContain("reverse_proxy bff:5052");
		expect(caddy).toContain("reverse_proxy static:80");
		expect(caddy).toContain("tls internal");
	});

	it("serves the existing static build context from a lightweight dedicated image", () => {
		expect(staticDockerfile).toContain("FROM caddy:2.8.4-alpine");
		expect(staticDockerfile).toContain(`"file-server"`);
		expect(compose).toContain("dockerfile: deploy/hub/static.Dockerfile");
	});

	it("creates runtime and backup identities without embedding passwords", () => {
		expect(roles).toContain("CREATE ROLE hub_runtime");
		expect(roles).toContain("CREATE ROLE hub_backup");
		expect(roles).toContain(":'runtime_password'");
		expect(roles).not.toMatch(/PASSWORD\\s+'[^']+'/);
	});

	it("keeps local secrets out of Git and the BFF image context", () => {
		const gitignore = read(".gitignore");
		expect(gitignore).toContain("**/.env.*");
		expect(dockerignore).toContain("server/.env*");
		expect(dockerignore).toContain("!server/.env*.example");
	});
});
