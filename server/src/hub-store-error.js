export class HubStoreError extends Error {
	constructor (code, message, {status = 400, details = null} = {}) {
		super(message);
		this.name = "HubStoreError";
		this.code = code;
		this.status = status;
		this.details = details;
	}
}
