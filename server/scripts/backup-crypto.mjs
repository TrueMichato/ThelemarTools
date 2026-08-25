import crypto from "node:crypto";
import fs from "node:fs";
import {pipeline} from "node:stream/promises";

const MAGIC = Buffer.from("HUBENC1\0", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function getEncryptionKey (value = process.env.HUB_BACKUP_ENCRYPTION_KEY) {
	if (!value) throw new Error(`HUB_BACKUP_ENCRYPTION_KEY is required.`);
	const key = Buffer.from(value, "base64");
	if (key.length !== 32) throw new Error(`HUB_BACKUP_ENCRYPTION_KEY must be base64 for exactly 32 bytes.`);
	return key;
}

export async function pEncryptFile ({source, target, key}) {
	const iv = crypto.randomBytes(IV_BYTES);
	await fs.promises.writeFile(target, Buffer.concat([MAGIC, iv]), {flag: "wx", mode: 0o600});
	try {
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
		await pipeline(
			fs.createReadStream(source),
			cipher,
			fs.createWriteStream(target, {flags: "a", mode: 0o600}),
		);
		await fs.promises.appendFile(target, cipher.getAuthTag());
		return pGetFileEvidence(target);
	} catch (error) {
		await fs.promises.rm(target, {force: true});
		throw error;
	}
}

export async function pDecryptFile ({source, target, key}) {
	const stat = await fs.promises.stat(source);
	const headerBytes = MAGIC.length + IV_BYTES;
	if (stat.size <= headerBytes + TAG_BYTES) throw new Error(`Encrypted backup is truncated.`);
	const file = await fs.promises.open(source, "r");
	let header;
	let tag;
	try {
		header = Buffer.alloc(headerBytes);
		await file.read(header, 0, header.length, 0);
		tag = Buffer.alloc(TAG_BYTES);
		await file.read(tag, 0, tag.length, stat.size - TAG_BYTES);
	} finally {
		await file.close();
	}
	if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`Encrypted backup header is invalid.`);
	const iv = header.subarray(MAGIC.length);
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	try {
		await pipeline(
			fs.createReadStream(source, {start: headerBytes, end: stat.size - TAG_BYTES - 1}),
			decipher,
			fs.createWriteStream(target, {flags: "wx", mode: 0o600}),
		);
	} catch (error) {
		await fs.promises.rm(target, {force: true});
		throw new Error(`Encrypted backup authentication failed.`, {cause: error});
	}
}

export async function pGetFileEvidence (filePath) {
	const hash = crypto.createHash("sha256");
	await pipeline(fs.createReadStream(filePath), hash);
	const stat = await fs.promises.stat(filePath);
	return {
		sizeBytes: stat.size,
		sha256: hash.digest("hex"),
	};
}
