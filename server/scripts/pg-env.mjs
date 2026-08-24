export function getPgEnv ({databaseUrl, env = process.env}) {
	const url = new URL(databaseUrl);
	if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`DATABASE_URL must use postgres:// or postgresql://.`);
	const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
	if (!database) throw new Error(`DATABASE_URL must include an explicit database name.`);
	return {
		...env,
		PGHOST: url.searchParams.get("host") || url.hostname,
		PGPORT: url.port || "5432",
		PGUSER: decodeURIComponent(url.username),
		PGPASSWORD: decodeURIComponent(url.password),
		PGDATABASE: database,
		...(url.searchParams.get("sslmode") ? {PGSSLMODE: url.searchParams.get("sslmode")} : {}),
	};
}
