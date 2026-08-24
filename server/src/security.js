import crypto from "node:crypto";

export function getRandomToken (bytes = 32) {
	return crypto.randomBytes(bytes).toString("base64url");
}

export function getSha256 (value) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

export function getPkceChallenge (verifier) {
	return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function getCsrfToken ({csrfSecret, sessionId}) {
	return crypto.createHmac("sha256", csrfSecret).update(sessionId).digest("base64url");
}

export function getDeterministicToken ({secret, namespace, parts}) {
	return crypto.createHmac("sha256", secret)
		.update(`${namespace}\0${parts.join("\0")}`)
		.digest("base64url");
}

export function isConstantTimeEqual (a, b) {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) return false;
	return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function encodeSignedState (state) {
	return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeSignedState (value) {
	const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError(`Invalid OAuth state.`);
	return parsed;
}
