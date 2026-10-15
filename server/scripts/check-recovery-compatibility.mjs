import pg from "pg";
import {pGetMultiTargetRollbackPreflight} from "../src/multi-target-rollback-preflight.js";
import path from "node:path";
import {pathToFileURL} from "node:url";

const MULTI_TARGET_TEMPLATE_REGISTRY_VERSIONS = ["multi-target-effects-v1"];

export async function pGetRecoveryCompatibility (queryable) {
	const singularResult = await queryable.query(`
		WITH singular_operations AS (
			SELECT
				source_entity,
				effect_template_id,
				choice,
				source_cost,
				source_cost_version,
				template_registry_version,
				CASE
					WHEN (
						(effect_template_id = 'spell.cure-wounds.heal' AND source_entity IN (
							'{"type":"spell","uid":"cure wounds|phb","version":"phb-2014-v1"}'::jsonb,
							'{"type":"spell","uid":"cure wounds|xphb","version":"xphb-2024-v1"}'::jsonb
						))
						OR (effect_template_id = 'spell.healing-word.heal' AND source_entity IN (
							'{"type":"spell","uid":"healing word|phb","version":"phb-2014-v1"}'::jsonb,
							'{"type":"spell","uid":"healing word|xphb","version":"xphb-2024-v1"}'::jsonb
						))
					)
						AND source_cost_version = 1
						AND template_registry_version = 'peer-effects-v1'
						AND jsonb_typeof(choice->'castLevel') = 'number'
						AND choice->>'castLevel' ~ '^[1-9]$'
						AND choice = jsonb_build_object('castLevel', choice->'castLevel')
						AND source_cost = jsonb_build_object(
							'version', 1,
							'components', jsonb_build_array(jsonb_build_object(
								'kind', 'spell_slot',
								'pool', 'standard',
								'level', choice->'castLevel',
								'amount', 1
							))
						)
						THEN true
					WHEN effect_template_id = 'ability.lay-on-hands.heal'
						AND source_entity = '{"type":"ability","uid":"lay on hands|xphb","version":"xphb-2024-v1"}'::jsonb
						AND source_cost_version = 1
						AND template_registry_version = 'peer-effects-v1'
						AND jsonb_typeof(choice->'amount') = 'number'
						AND CASE
							WHEN choice->>'amount' ~ '^[1-9][0-9]{0,2}$'
								THEN (choice->>'amount')::integer BETWEEN 1 AND 100
							ELSE false
						END
						AND choice = jsonb_build_object('amount', choice->'amount')
						AND jsonb_typeof(source_cost #> '{components,0,resourceId}') = 'string'
						AND length(source_cost #>> '{components,0,resourceId}') BETWEEN 1 AND 200
						AND source_cost #>> '{components,0,resourceId}' = btrim(source_cost #>> '{components,0,resourceId}')
						AND source_cost #>> '{components,0,resourceId}' !~ '[[:cntrl:]]'
						AND (
							source_cost #>> '{components,0,resourceId}' !~*
								'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
							OR source_cost #>> '{components,0,resourceId}' =
								lower(source_cost #>> '{components,0,resourceId}')
						)
						AND source_cost = jsonb_build_object(
							'version', 1,
							'components', jsonb_build_array(jsonb_build_object(
								'kind', 'feature_use',
								'resourceId', source_cost #> '{components,0,resourceId}',
								'featureRef', source_cost #> '{components,0,featureRef}',
								'amount', choice->'amount'
							))
						)
						AND source_cost #> '{components,0,featureRef}' IN (
							'{"uid":"lay on hands|xphb"}'::jsonb,
							'{"uid":"lay on hands|paladin|xphb|1"}'::jsonb
						)
						THEN true
					ELSE false
				END AS supported
			FROM hub.semantic_operations
			WHERE source_cost_version IS NOT NULL
				AND target_set_version IS NULL
		)
		SELECT
			count(*) AS total_count,
			count(*) FILTER (WHERE NOT supported) AS unsupported_count
		FROM singular_operations
	`);
	const singular = singularResult.rows[0];
	const multiTargetTemplateResult = await queryable.query(`
		SELECT
			count(*) AS total_count,
			count(*) FILTER (
				WHERE NOT COALESCE((
					effect_template_id = 'spell.mass-healing-word.heal'
					AND source_entity IN (
						'{"type":"spell","uid":"mass healing word|phb","version":"phb-2014-v1"}'::jsonb,
						'{"type":"spell","uid":"mass healing word|xphb","version":"xphb-2024-v1"}'::jsonb
					)
					AND source_cost_version = 1
					AND template_registry_version = 'multi-target-effects-v1'
					AND candidate_count BETWEEN 1 AND 6
					AND allow_target_no_op IS TRUE
					AND jsonb_typeof(choice->'castLevel') = 'number'
					AND choice->>'castLevel' ~ '^[3-9]$'
					AND choice = jsonb_build_object('castLevel', choice->'castLevel')
					AND source_cost = jsonb_build_object(
						'version', 1,
						'components', jsonb_build_array(jsonb_build_object(
							'kind', 'spell_slot',
							'pool', 'standard',
							'level', choice->'castLevel',
							'amount', 1
						))
					)
				), false)
			) AS unsupported_count
		FROM hub.semantic_operations
		WHERE target_set_version = 1
	`);
	const multiTargetTemplates = multiTargetTemplateResult.rows[0];
	const multiTarget = await pGetMultiTargetRollbackPreflight({
		queryable,
		target: "bridge",
		supportedTemplateRegistryVersions: MULTI_TARGET_TEMPLATE_REGISTRY_VERSIONS,
	});
	const hasMultiTargetHistory = multiTarget.diagnostics.totalParentCount
		|| multiTarget.diagnostics.totalTargetCount
		|| multiTarget.diagnostics.totalFinalizationCount;
	const blockers = [];
	if (Number(singular.unsupported_count) !== 0) blockers.push("UNSUPPORTED_SINGULAR_TEMPLATE_HISTORY");
	if (Number(multiTargetTemplates.unsupported_count) !== 0) blockers.push("UNSUPPORTED_MULTI_TARGET_SOURCE_HISTORY");
	if (!multiTarget.compatible) blockers.push(...multiTarget.blockers);
	if (!multiTarget.diagnostics.usageMarkerPresent && hasMultiTargetHistory) {
		blockers.push("MULTI_TARGET_MARKER_HISTORY_MISMATCH");
	}
	return {
		target: "qualified-full-workflow-fallback",
		compatible: blockers.length === 0,
		blockers: [...new Set(blockers)],
		diagnostics: {
			singularOperationCount: Number(singular.total_count),
			unsupportedSingularOperationCount: Number(singular.unsupported_count),
			multiTargetOperationCount: Number(multiTargetTemplates.total_count),
			unsupportedMultiTargetOperationCount: Number(multiTargetTemplates.unsupported_count),
			multiTarget: multiTarget.diagnostics,
		},
	};
}

async function main () {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
	const pool = new pg.Pool({
		connectionString: databaseUrl,
		ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
		connectionTimeoutMillis: 5_000,
		query_timeout: 10_000,
		statement_timeout: 10_000,
		max: 1,
	});

	try {
		const result = await pGetRecoveryCompatibility(pool);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (!result.compatible) process.exitCode = 2;
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	main().catch(() => {
		process.stderr.write("RECOVERY_COMPATIBILITY_QUERY_FAILED\n");
		process.exitCode = 1;
	});
}
