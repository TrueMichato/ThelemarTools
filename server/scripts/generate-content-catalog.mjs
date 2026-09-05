import {mkdir, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {pBuildCampaignContentSiteCatalog} from "../src/campaign-content-policy.js";

const outputPath = fileURLToPath(new URL("../data/campaign-content-site-catalog.json", import.meta.url));
const catalog = await pBuildCampaignContentSiteCatalog();

await mkdir(fileURLToPath(new URL("../data/", import.meta.url)), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(catalog, null, "\t")}\n`, "utf8");
