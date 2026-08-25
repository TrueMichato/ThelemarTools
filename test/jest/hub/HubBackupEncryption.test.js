import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getEncryptionKey,
	pDecryptFile,
	pEncryptFile,
} from "../../../server/scripts/backup-crypto.mjs";

describe("Hub encrypted backups", () => {
	it("round-trips backup bytes and returns bounded evidence", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-backup-test-"));
		try {
			const source = path.join(dir, "source.dump");
			const encrypted = path.join(dir, "source.dump.enc");
			const restored = path.join(dir, "restored.dump");
			const bytes = crypto.randomBytes(64 * 1024);
			fs.writeFileSync(source, bytes);
			const evidence = await pEncryptFile({source, target: encrypted, key: crypto.randomBytes(32)});
			expect(evidence).toEqual({sizeBytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/)});
			const key = getEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
			const encrypted2 = path.join(dir, "source2.dump.enc");
			await pEncryptFile({source, target: encrypted2, key});
			await pDecryptFile({source: encrypted2, target: restored, key});
			expect(fs.readFileSync(restored)).toEqual(bytes);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects invalid keys and tampered ciphertext without leaving plaintext", async () => {
		expect(() => getEncryptionKey("not-a-32-byte-key")).toThrow(/exactly 32 bytes/);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-backup-test-"));
		try {
			const source = path.join(dir, "source.dump");
			const encrypted = path.join(dir, "source.dump.enc");
			const restored = path.join(dir, "restored.dump");
			const key = crypto.randomBytes(32);
			fs.writeFileSync(source, "private backup");
			await pEncryptFile({source, target: encrypted, key});
			const tampered = fs.readFileSync(encrypted);
			tampered[Math.floor(tampered.length / 2)] ^= 0xff;
			fs.writeFileSync(encrypted, tampered);
			await expect(pDecryptFile({source: encrypted, target: restored, key})).rejects.toThrow(/authentication failed/);
			expect(fs.existsSync(restored)).toBe(false);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
});
