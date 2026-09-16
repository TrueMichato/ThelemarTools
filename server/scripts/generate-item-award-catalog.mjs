import {mkdir, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {pBuildItemAwardSiteCatalog} from "./item-award-catalog-builder.mjs";

const outputPath = fileURLToPath(new URL("../data/item-award-site-catalog.json", import.meta.url));
const catalog = await pBuildItemAwardSiteCatalog();

await mkdir(fileURLToPath(new URL("../data/", import.meta.url)), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(catalog, null, "\t")}\n`, "utf8");
