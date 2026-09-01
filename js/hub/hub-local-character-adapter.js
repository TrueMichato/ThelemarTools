const _LOCAL_CHARACTER_STORAGE_KEY = "charsheet-characters";

let _pLoadLocalforage = null;

async function _pGetLocalforage () {
	if (globalThis.localforage) return globalThis.localforage;
	if (typeof document === "undefined") throw new Error("Local character storage is unavailable.");
	if (_pLoadLocalforage) return _pLoadLocalforage;

	_pLoadLocalforage = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = new URL("../../lib/localforage.js", import.meta.url).href;
		script.async = true;
		script.addEventListener("load", () => {
			if (globalThis.localforage) resolve(globalThis.localforage);
			else reject(new Error("Local character storage failed to initialize."));
		}, {once: true});
		script.addEventListener("error", () => reject(new Error("Local character storage could not be loaded.")), {once: true});
		document.head.append(script);
	});
	return _pLoadLocalforage;
}

export async function pGetLocalCharacters ({storage = null} = {}) {
	const activeStorage = storage || await _pGetLocalforage();
	const characters = await activeStorage.getItem(_LOCAL_CHARACTER_STORAGE_KEY);
	if (characters == null) return [];
	if (!Array.isArray(characters)) throw new Error("Local character storage contains invalid data.");
	return characters;
}
