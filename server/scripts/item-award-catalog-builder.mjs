import "../../js/parser.js";
import "../../js/utils.js";
import {patchLoadJson, unpatchLoadJson} from "../../node/util.js";

export async function pBuildItemAwardSiteCatalog () {
	patchLoadJson();
	try {
		const [items, baseItems] = await Promise.all([
			DataUtil.loadJSON("data/items.json"),
			DataUtil.loadJSON("data/items-base.json"),
		]);
		const catalogItems = [
			...(items.item || []),
			...(items.baseitem || []),
			...(baseItems.item || []),
			...(baseItems.baseitem || []),
		].map(item => Object.fromEntries(
			Object.entries(item).filter(([key]) => key !== "__prop"),
		));
		const identities = new Set();
		for (const item of catalogItems) {
			const uid = `${item.name || ""}|${item.source || ""}`.toLowerCase();
			if (!item.name || !item.source || identities.has(uid)) {
				throw new Error(`Invalid or duplicate item-award catalog identity: ${uid || "(blank)"}`);
			}
			identities.add(uid);
		}
		return {version: 1, items: catalogItems};
	} finally {
		unpatchLoadJson();
	}
}
