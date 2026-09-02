// Shared between the Hub server and the browser. Keep this module dependency-free so it can load in both
// runtimes; `server/src/hub-store-error.js` re-exports it so server `instanceof` checks keep one class identity.
export class HubStoreError extends Error {
	constructor (code, message, {status = 400, details = null} = {}) {
		super(message);
		this.name = "HubStoreError";
		this.code = code;
		this.status = status;
		this.details = details;
	}
}
