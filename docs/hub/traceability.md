# Campaign Hub traceability matrix

> **Status:** Active; expand with every continuation change
> **Last verified:** 2026-09-04
> **Owner:** Campaign Hub maintainers

| Requirement/invariant | Decision/reference | Implementation | Primary tests/evidence | Operational reference |
|---|---|---|---|---|
| Local mode remains unchanged | ADR 0001; `current-system.md` | local repositories in Character Sheet/DM Screen | Character Sheet persistence/repository suites; broad Jest gate | staging local-only scenario |
| Same-origin cookie BFF | ADR 0001; `security.md` | `server/src/app.js`, `index.js`, OAuth/security modules | `HubServerApp`, OAuth provider, route contract | `operations.md`; future deployment runbook |
| Tenant/role isolation | `permission-matrix.md` | route guards + PostgreSQL store + tenant constraints | `HubAuthorizationMatrix`, `HubInviteRoleSafety` | incident/member-removal runbooks (planned) |
| One active editor and fencing | ADR 0002 | character/workspace repos, lease tables, store writes | repository, Phase 1/2, Board save tests | troubleshooting lease section |
| Canonical docs, audit/event/outbox | ADR 0002 | migration/store/realtime dispatcher | repository, realtime, migration tests; PostgreSQL drill | future outbox runbook |
| Campaign brew never replaces personal brew | ADR 0003 | Hub brew context + temporary brew seam | `HubBrewContext`, Phase 2, XSS tests | content troubleshooting |
| Cross-user content is safe | ADR 0003; `security.md` | campaign/character validators and renderer escaping | campaign content, cloud validation, XSS contract | security incident runbook (planned) |
| Character quota applies after mutation | `performance.md` | `validateCloudCharacterData` in every write path | cloud validation, Phase 4 oversized grant/transfer | troubleshooting quota section |
| Realtime respects visibility | `realtime-protocol.md` | projections, store visible-event query, realtime | realtime/WebSocket/authorization tests | future outbox/realtime runbook |
| Character projections are authorization-scoped | `adr/0011-authorization-scoped-character-projections.md`, `data-lifecycle.md` | `server/src/character-projection.js`, both stores, `js/hub/hub-character-view.js`, `js/charactersheet/charactersheet-sharing.js` | `HubCharacterProjection`, `HubProjectionPolicy`, `HubProjectionCanary`, `HubProjectionLifecycle`, `HubPartyTrackerProjection` | migration 0004 |
| One-player Cure Wounds targeting is consented, atomic, private, and exactly-once | ADR 0016; V2-T7 | source-cost registry/authority, migration 0007, protocol-4 operation legs, Character Sheet targeting/approval coordinators | `HubSourceCosts`, `HubPeerSourceCostsAuthority`, PostgreSQL semantic authority, operation reconciliation, spell-flow, three-user Chromium journey | source-cost rollout gate and ADR 0016 rollback procedure |
| Transfers cannot duplicate/lose assets | `domain-model.md` | `hub-actions.js`, transactional store locks/escrow | Hub actions and Phase 4 domain | future stuck-transfer runbook |
| Multi-target item awards are atomic, private, and retry-safe | ADR 0017; V2-T4 | strict award route, shared inventory helpers, staged memory writes, PostgreSQL locks/transaction, ordered events, Character Sheet reconciliation | `HubItemAward`, API route/domain/PostgreSQL parity, Character Sheet realtime/party inventory, real-stack lifecycle | award troubleshooting row; incident runbook for suspected asset drift |
| Campaign rules selection is immutable, explainable, compatible, and honestly labeled | ADR 0015; V2-T6 | shared closed catalog/validator/evaluator/legacy adapter, transient Character Sheet and DM projections, policy-fenced carry authority, capability-gated API and manager, memory/PostgreSQL atomic publish/rollback using existing `rules_versions` JSONB | `HubCampaignRuleEvaluator`, `HubCampaignRuleAuthority`, `HubCampaignRulesPolicy`, `HubRulesPolicyApi`, `HubRulesPolicyPostgres`, `HubPageContract`, Character Sheet/Party Tracker lifecycle tests, mutation probes, production-derived lifecycle journey | content rules (source/species/edition) and carry/encumbrance rules enforced; other non-content rules remain advisory |
| New campaign content obeys source/species/edition policy without rewriting legacy characters | ADR 0015; V2-T6 | `js/hub/hub-content-policy.js`, `server/src/campaign-content-policy.js`, generated site/campaign-brew catalog, Character Sheet candidate filters, memory/PostgreSQL admission and delta gates | `HubCampaignContentGating`, `HubRulesPolicyApi`, `HubRulesPolicyPostgres`, Character Sheet content/teardown suites, 11-mutant content-policy suite, production-stack Chromium content journey | existing `rules_versions`; no migration |
| Service worker never caches auth/API | `security.md` | Hub route policy + `sw-template.js` | route-policy/service-worker build | stale-client staging scenario |
| Backup is portable and atomic | `operations.md` | backup/restore/pg-env scripts | local PostgreSQL backup/restore drill | backup/restore runbook |
| Oracle recovery meets RPO/RTO | ADR 0006; `roadmap.md` V1-G1 | encrypted backup/restore and scheduled-operation tooling implemented; off-machine/isolated proof active | exact-release staging restore/rollback evidence required | backup/restore and rollback runbooks |
| Member/session/account lifecycle | ADR 0007; data lifecycle | invite/member/session/deletion APIs, migration 0002, socket closure, purge command | lifecycle administration/API/migration/session tests and PostgreSQL drill | member removal, account deletion, session compromise runbooks |
| Safe schema evolution | ADR 0005; `migrations.md` | checksummed/advisory-locked runner, baseline fingerprint, migration-aware readiness, role grants | migration runner/contract/role tests and PostgreSQL fresh/baseline drills | migration guide; failure runbook pending |
| Reproducible deployment | ADR 0004; `deployment.md` | BFF/static images, Compose DB/migrate/grants/BFF/static/edge, live/ready probes | deployment contract, image build/inspect, Compose config/start/routing/restart probes | deployment guide |
| Technical retention and recovery signals | ADR 0006; `observability.md` | migration 0003, maintenance lock/cleanup, metrics, encrypted backup/restore, evidence role | maintenance/observability/encryption tests and real cleanup/backup/restore drills | operations and incident runbooks |
| Real-stack multi-context behavior | ADR 0008; `ci-and-provenance.md` | test-only BFF image, disposable Compose override/orchestrator, Hub page object and Playwright journeys | lifecycle/load scenarios, BFF/DB restart probes | CI artifacts; Phase 6H game day |
| Reproducible CI and supply-chain evidence | ADR 0008; `ci-and-provenance.md` | pinned workflow, secret scan, exact-image export, SBOMs, provenance writer, image scan; Oracle release from verified tag | `HubCiContract`, local SBOM/image build, GitHub CI, deployed tag `hub-staging-2026-09-01` at `8f181712` | V2-T0 release automation |
| Staging/launch provider | ADR 0010 (supersedes 0009); `provider-comparison.md` | `compose.hub.public.yml`, `deploy/hub/Caddyfile.public`; release `hub-staging-2026-09-01` at `8f181712` deployed on the existing Oracle A1 host under the C-ALT deviation | Compose overlay validation, successful live OAuth/PostgreSQL/API/WebSocket smoke, and exact-image real-stack browser gate; physical game day remains | `runbooks/oracle-provisioning.md`; `runbooks/oracle-operations.md` |
| One BFF replica in private V1 | `provider-comparison.md`; R-15 | single-VM Compose stack is inherently one replica | CI reconnect/replay and Phase 6G deploy-restart drill | shared-fanout ADR required before scale-out |
| Provider client-IP authenticity | ADR 0009 (superseded); R-08 | `server/src/client-ip.js` retained but inactive on Oracle; Caddy is sole ingress and `HUB_TRUST_PROXY` names its fixed private address | `HubClientIp`, `HubWebSocket`; Phase 6G client-IP drill confirms real addresses reach rate limits | re-enable `HUB_CLIENT_IP_HEADER` only if a managed provider is adopted |
| Quiet WebSocket survival | ADR 0010; `realtime-protocol.md` | 25-second server ping/pong heartbeat in `HubRealtime` | `HubRealtime`; managed-ingress idle drill pending | reconnect/resync fallback |
| Whole-site active campaign context | ADR 0013; V2-T5; `active-campaign-context.md` | active-context coordinator/store/channel, switcher, site bootstrap, surface defaults, temporary brew/rules adapters, `campaign.active_context.v1` | coordinator/navigation/bootstrap/privacy Jest; four killed mutants; production-stack active-context Chromium journeys | explicit `?local=1`; reload after blocked teardown |

Use `not implemented` explicitly. A planned row must not be presented as current capability.

## Content rule-by-surface compliance

| Rule | Admin/publication | Candidate UI | Existing character | New/admitted character | Authoritative delta/semantic writes | Context lifecycle |
|---|---|---|---|---|---|---|
| `content.sources.allowed` | Canonical case-insensitive IDs must exist in the generated site catalog or active campaign brew catalog; aliases normalize before immutable publication; campaign brew cannot redefine official source metadata | Filters race/species, class/subclass, background, feat, every source-bearing feature, optional-feature, combat-method, spell, and item candidate | Bounded UID/rule warning; play, unrelated edits, removals, and existing stack changes remain available; deterministic root-owned feature repair is permitted only while its class/subclass level, species/race, or background root is unchanged | Create/import/clone/attach/cross-campaign move rejects unknown or disallowed sources | Direct patches, item grants/awards, and accepted transfers into characters re-evaluate introduced `kind + uid` multiplicity under the exact active version | Rollback/reconnect/switch/access loss clears prior candidates and reports by generation; authoritative access loss fails closed before ordered full teardown; local/signed-out behavior is unchanged |
| `content.species.allowed` | Canonical case-insensitive `name\|source`; base, subrace, and named variant identities must be catalogued | Builder and replacement surfaces show only permitted canonical species identities | Existing race/species remains usable and is never rewritten | Whole-document admission rejects disallowed, unknown, or malformed species identities | Replacing/adding race or subrace is blocking; removing it is permitted | Same teardown and version fence as source policy |
| `content.editions.allowed` | Exactly 2014, 2024, or both; unknown edition metadata fails closed | All governed candidate pools intersect edition with source/species policy | PHB/XPHB conflicts are grandfathered and reported | New/admitted documents must use only enabled editions | Every introduced governed identity, including spells/features/items, must resolve to an enabled edition | Same teardown and version fence as source policy |

Campaign brew augments only the active campaign content universe. It does not mutate personal brew, and personal
brew absent from the active bundle cannot satisfy campaign admission. Browser filtering is explanatory only;
the server rechecks the same normalized policy in the authoritative transaction. Official source identity and
edition metadata are reserved; conflicting custom-source declarations fail closed. Publication rechecks
authorization after asynchronous catalog loading in memory, while PostgreSQL keeps the equivalent check inside
its locked transaction. Brew create and activation both revalidate the complete catalog; activation does so before
any active pointer, audit, event, outbox, or receipt write. Exact active-import replay returns the stored character
after authorization/locking but before evaluating discarded input; archived reactivation remains a new admission.
The legacy activation route accepts only schema-v1 targets and cannot replace an active schema-v2 policy; rollback
of schema-v2 content policy publishes a new immutable schema-v2 version.

## Content-policy integration collision map

| Shared hotspot | Content-policy ownership | Descendant integration requirement |
|---|---|---|
| `js/hub/hub-campaign-rules.js`, `hub-rules-policy-manager.js`, `campaign.html`, `scss/hub.scss` | Stable content IDs, enforced labels, typed source/species/edition controls | Preserve non-content rules as advisory until their lane supplies independent enforcement; merge catalog/UI changes additively |
| `js/hub/hub-campaign-context.js`, `js/dmscreen/dmscreen-hub-controller.js`, `hub-active-campaign-coordinator.js`, `hub-site-context.js`, `js/charactersheet/charactersheet.js` | Content catalog/policy projection, owner-mediated DM brew refresh, immediate fail-closed access loss, and generation-fenced full filter/report teardown | Preserve V2-T5 activation order, temporary brew boundary, exact rules/brew cursor pinning, and coordinator-owned teardown order |
| `js/charactersheet/charactersheet-builder.js`, `charactersheet-levelup.js` | Content-specific candidate projection and final authoritative save behavior | Compose with house-rule evaluators; do not replace the centralized content filter or trust picker state |
| `server/src/app.js`, `memory-hub-store.js`, `postgres-hub-store.js` | Rules-version pin, schema-v2 activation fence, publication reauthorization, and admission/delta checks for character writes, grants/awards, and transfer acceptance | Keep checks inside existing authorization/lock/transaction boundaries; preserve memory/PostgreSQL response and evidence parity; rejected writes emit no content/private event |
| `test/e2e/pages/HubCampaignPage.ts`, `CharacterSheetPage.ts`, Hub/Character Sheet policy tests | Content fixtures, bypass/grandfather/teardown assertions | Retain content cases when resolving parallel rules-lane fixture/page-object edits |
| Hub/Character Sheet status, testing, traceability, and architecture docs | Truthful content-enforced/non-content-advisory boundary | Resolve wording as a descendant merge; do not regress content rules to Planned or claim all house rules enforced |

The content-specific modules (`js/hub/hub-content-policy.js`,
`server/src/campaign-content-policy.js`, `server/scripts/generate-content-catalog.mjs`, and
`server/data/campaign-content-site-catalog.json`) are isolated from non-content rule evaluation. Migration
`server/migrations/0007*` is untouched; immutable `rules_versions` storage is sufficient.
