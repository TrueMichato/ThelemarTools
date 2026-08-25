import net from "node:net";

const SUPPORTED_CLIENT_IP_HEADERS = new Set(["do-connecting-ip"]);

export function getClientIpHeader (value) {
	if (value == null || value === "") return null;
	const normalized = `${value}`.trim().toLowerCase();
	if (!SUPPORTED_CLIENT_IP_HEADERS.has(normalized)) {
		throw new TypeError(`Unsupported trusted client IP header.`);
	}
	return normalized;
}

export function getRequestClientIp ({request, clientIpHeader = null}) {
	const fallback = request.ip || request.socket?.remoteAddress || null;
	if (!clientIpHeader) return fallback;
	const raw = request.headers?.[clientIpHeader];
	if (typeof raw !== "string") return fallback;
	const candidate = raw.trim();
	if (candidate.includes(",") || !net.isIP(candidate)) return fallback;
	return candidate;
}
