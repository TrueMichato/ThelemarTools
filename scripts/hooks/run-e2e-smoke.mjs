#!/usr/bin/env node
// Curated Playwright smoke subset for pre-push.
// Goal: in ~2-3 minutes, exercise the highest-leverage paths:
//   - Builder wizard (entry point for every character)
//   - Level-up flow (most state-heavy interaction)
//   - Overview tab (renders nearly every state field)
//   - Combat tab (HP, attacks, conditions, death saves)
//   - One TGTT build (proves homebrew layer still loads)
//
// Triggered from run-prepush.mjs when RUN_E2E=1.

import {spawnSync} from "node:child_process";

const SMOKE_GREP = [
	"builder-wizard",
	"levelup\\.spec",
	"overview-tab",
	"combat\\.spec",
	"tgtt-bladesinger-wizard-tabaxi",
].join("|");

console.log("[hooks:e2e-smoke] Running Playwright smoke subset:");
console.log(`                   /${SMOKE_GREP}/`);

const r = spawnSync(
	"npx",
	["playwright", "test", "--grep", SMOKE_GREP],
	{stdio: "inherit", shell: process.platform === "win32"},
);

process.exit(r.status ?? 1);
