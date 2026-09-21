import {jest} from "@jest/globals";
import {pGetMultiTargetRollbackPreflight} from "../../../server/src/multi-target-rollback-preflight.js";

function getQueryable (row) {
	return {
		query: jest.fn(async () => ({rows: [row]})),
	};
}

const EMPTY_DIAGNOSTICS = {
	usage_marker_present: false,
	first_used_at: null,
	total_parent_count: "0",
	live_parent_count: "0",
	oldest_collection_closes_at: null,
	oldest_finalization_deadline: null,
	oldest_terminal_at: null,
	unsupported_template_parent_count: "0",
	total_target_count: "0",
	pending_target_count: "0",
	selected_target_count: "0",
	applied_leg_count: "0",
	total_finalization_count: "0",
	incomplete_parent_count: "0",
	cleanup_ready_parent_count: "0",
};

describe("Hub multi-target rollback preflight", () => {
	it("allows a true pre-0011 target only while marker and normalized history are absent", async () => {
		const queryable = getQueryable(EMPTY_DIAGNOSTICS);
		await expect(pGetMultiTargetRollbackPreflight({
			queryable,
			target: "pre-0011",
		})).resolves.toMatchObject({
			target: "pre-0011",
			compatible: true,
			blockers: [],
			diagnostics: {
				usageMarkerPresent: false,
				totalParentCount: 0,
				totalTargetCount: 0,
				totalFinalizationCount: 0,
			},
		});
	});

	it("blocks a true pre-0011 target permanently when the usage marker exists", async () => {
		const result = await pGetMultiTargetRollbackPreflight({
			queryable: getQueryable({
				...EMPTY_DIAGNOSTICS,
				usage_marker_present: true,
				first_used_at: new Date("2026-09-21T12:00:00Z"),
			}),
			target: "pre-0011",
		});
		expect(result).toMatchObject({
			compatible: false,
			blockers: ["USAGE_MARKER_PRESENT"],
			diagnostics: {
				usageMarkerPresent: true,
				totalParentCount: 0,
			},
		});
		expect(result.diagnostics).not.toHaveProperty("firstOperationId");
	});

	it("fails closed on normalized history even if the marker is unexpectedly absent", async () => {
		await expect(pGetMultiTargetRollbackPreflight({
			queryable: getQueryable({
				...EMPTY_DIAGNOSTICS,
				total_parent_count: "1",
				total_target_count: "3",
			}),
			target: "pre-0011",
		})).resolves.toMatchObject({
			compatible: false,
			blockers: ["MULTI_TARGET_HISTORY_PRESENT"],
		});
	});

	it("reports bridge diagnostics and blocks incomplete or unsupported history", async () => {
		const queryable = getQueryable({
			...EMPTY_DIAGNOSTICS,
			usage_marker_present: true,
			total_parent_count: "4",
			live_parent_count: "1",
			total_target_count: "8",
			pending_target_count: "2",
			total_finalization_count: "3",
			incomplete_parent_count: "1",
			unsupported_template_parent_count: "2",
		});
		const result = await pGetMultiTargetRollbackPreflight({
			queryable,
			target: "bridge",
			supportedTemplateRegistryVersions: ["multi-target-effects-v1"],
		});
		expect(result).toMatchObject({
			compatible: false,
			blockers: ["INCOMPLETE_MULTI_TARGET_HISTORY", "UNSUPPORTED_TEMPLATE_VERSION"],
			diagnostics: {
				totalParentCount: 4,
				liveParentCount: 1,
				totalTargetCount: 8,
				pendingTargetCount: 2,
				totalFinalizationCount: 3,
			},
		});
		expect(queryable.query).toHaveBeenCalledWith(
			expect.stringContaining("semantic_multi_target_usage"),
			[["multi-target-effects-v1"]],
		);
	});

	it("rejects unknown rollback target modes before querying", async () => {
		const queryable = getQueryable(EMPTY_DIAGNOSTICS);
		await expect(pGetMultiTargetRollbackPreflight({
			queryable,
			target: "old",
		})).rejects.toThrow(/pre-0011.*bridge/);
		expect(queryable.query).not.toHaveBeenCalled();
	});
});
