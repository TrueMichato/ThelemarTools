const fs = require("node:fs");
const {createRequire} = require("node:module");
const path = require("node:path");
const esbuild = require("esbuild");

module.exports = () => {
	const rootDirectory = path.resolve(__dirname, "../..");
	const outputFile = path.join(rootDirectory, "node_modules/.cache/jest-htmlparser2.cjs");
	const sanitizeHtmlRequire = createRequire(require.resolve("sanitize-html"));

	// Jest cannot synchronously require htmlparser2's ESM-only entry from sanitize-html's CommonJS module.
	fs.mkdirSync(path.dirname(outputFile), {recursive: true});
	esbuild.buildSync({
		bundle: true,
		entryPoints: [sanitizeHtmlRequire.resolve("htmlparser2")],
		format: "cjs",
		outfile: outputFile,
		platform: "node",
		target: "node24",
	});
};
