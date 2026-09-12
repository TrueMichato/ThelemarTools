import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import httpServer from "http-server";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Port 0 atomically acquires a free port; binding errors never reuse someone else's server. */
export async function startLocalServer ({port = 0} = {}) {
	const server = httpServer.createServer({root: REPO_ROOT, cache: 600, cors: true});
	await new Promise((resolve, reject) => {
		server.server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const origin = `http://127.0.0.1:${server.server.address().port}`;
	try {
		const response = await new Promise((resolve, reject) => {
			http.get(`${origin}/items.html`, res => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", chunk => body += chunk);
				res.on("end", () => resolve({status: res.statusCode, body}));
			}).on("error", reject);
		});
		if (response.status !== 200 || response.body !== fs.readFileSync(path.join(REPO_ROOT, "items.html"), "utf8")) {
			throw new Error("Local server did not serve this checkout");
		}
	} catch (e) {
		server.close();
		throw e;
	}
	return {origin, stop: () => server.close()};
}
