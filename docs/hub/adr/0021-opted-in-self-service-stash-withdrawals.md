# ADR 0021: Opted-in self-service party stash withdrawals

Status: Accepted product and authority boundary; implementation pending (2026-10-14)

## Context

GD-FIND-008 requests fewer routine stash approvals, transparent withdrawals and clear custody.
Current player withdrawals are non-debiting `proposed` requests requiring DM approval. Both stores already
implement a separate direct `committed` transfer path that changes both containers atomically for existing
server-authorized callers. This decision extends that architecture; it does not implement or enable it.

The decision owner confirmed:

- self-service applies to all shared stash items and all currency, not DM-marked subsets;
- a DM/co-DM controls campaign-wide opt-in;
- existing campaigns retain approval-required behavior until explicitly enabled;
- the table sees the withdrawing player's name and quantities, while character sharing remains authoritative.

## Decision

### Custody

An active player may withdraw only into an active character they currently own in that same active campaign.
Transfers to another player's character keep their existing recipient-consent contract. Deposits, arbitrary
DM edits, unsafe linked-item movement and the existing ledger remain unchanged.

Withdrawal moves actual inventory/coin custody from the shared stash to the owned character. Stash weight
remains a shared informational total; it is not silently allocated to a character. The target's current
content/carry admission applies. Do not add coin conversion or infer hidden recipient capacity.

Preserve current safe integer/bounded quantities, denominations, stack identity, complete metadata and
whole/partial-stack eligibility. One bounded mixed item/currency withdrawal is all-or-nothing.

### Immutable policy and compatible intent

Prefer the existing immutable campaign-policy publish/activate/rollback machinery rather than a parallel
mutable setting. A separately identified inventory rule defaults to approval required and is independent of
the TGTT master. Inventory authority stays campaign metadata, never a personal character setting or export.

Implementation must preserve existing schema-1/catalog-1 policy identities and content/carry behavior.
Missing inventory policy means approval required. Current strict catalog equality and historical-rule
requirements need an explicit compatible version path; do not rewrite old rules versions or make unknown
catalogs permissive. No database migration is presumed: policy bodies are already JSONB. A demonstrated
persistence requirement must receive its own reservation, compatibility review and release policy.

Advertise supported self-service authority separately from the campaign's enabled state. A new client must
have the supported capability, installed current policy and an explicit Withdraw intent, bound with the
policy version to the actor/body-scoped idempotency command.

Extend the existing transfer command with a closed, explicit self-service intent only after its protocol/
capability/schema contract is proven. A legacy or persisted request without that intent remains an approval
request even after the campaign opts in. Never turn a previously queued Request into an immediate withdrawal.
An older or disabled server must reject/hide the unsupported new action, not silently reinterpret it.

Disabling or rolling back policy fences new withdrawals; it does not undo completed transfers. Successful
exact retries preserve the original outcome/identities under current authorization and privacy shaping.

### One atomic transaction

Reuse the existing direct `pProposeTransfer` path in both stores. Do not implement withdrawal as a browser
proposal followed by another acceptance call, impersonate a DM, or introduce a second asset ledger.

Within the authoritative command, recheck current membership, ownership, campaign/character lifecycle,
policy pin, source stock/currency, transfer eligibility, target content/carry admission and document bounds.
Preserve receipt-first serialization and stable sorted participant locks; do not introduce lock upgrades
after asynchronous work. Memory must revalidate after asynchronous policy/content loading before publication.

Source debit, destination credit, terminal transfer, required audit/events/outbox and receipt commit together.
Insufficient stock, unsafe metadata, stale policy or an invalid target changes neither container and produces
no partial workflow evidence. Exact body changes under a used key fail rather than becoming another debit.

### Contention and recovery

- Two withdrawals for the last unit cannot both commit. The winner gets that unit; the loser receives the
  bounded insufficient-source result with no negative balance or partial mixed-payload movement.
- Withdrawal, DM approval and stash-backed awards conserve the same canonical source under the existing
  participant locks.
- Reuse insufficient-stash-request terminalization after direct debit. Cancel only pending requests that the
  remaining source definitively cannot fund; affordable requests stay pending.
- Lost-response recovery uses the original request/key and current authorized reads. Expired recovery never
  blindly creates a replacement withdrawal.
- Policy disable, ownership/membership changes, archive and move must fence an uncommitted command under the
  existing lifecycle/locking contract. Already committed outcomes remain historical and privacy-shaped.
- Open Sheets use the serialized repository/reconciliation path. Do not bypass owner leases, introduce
  simultaneous co-editing or overwrite unrelated queued edits.
- A confirmed commit followed by refresh failure remains a confirmed commit. Apply the shared B0 feedback
  contract; refresh recovery is not another proposal.

### Transparent, privacy-minimized activity

The table's withdrawal record shows the actor's already-authorized member display name and the shared
item/coin quantities. Use bounded server-derived display data and stable committed command/event identity.

Do not broaden existing private transfer events wholesale. If necessary, add a distinct minimal stash-
activity projection. It must not expose the destination's canonical identifier, hidden character identity/
ownership, HP/carry, private metadata/notes, provider subjects or unrelated inventories.

Owner/DM canonical reconciliation and metadata-only projection invalidations retain their existing audiences.
Current authorization shapes history/replay; access loss conceals old rows before late reads can publish.

### Required proof

Use matching Memory and real `hub_runtime` PostgreSQL tests, plus independent player/DM browser contexts:

- default-off, historical policy reads and legacy/frozen Request intent;
- non-owner, out-of-campaign, spectator and stale-policy rejection;
- exact retry, body mismatch, lost response and expired recovery;
- last stack/coin contention, withdrawal versus approval/award and mixed-payload rollback;
- policy disable across the actual asynchronous boundary;
- move/archive/membership/ownership races and queued-save reconciliation;
- safe metadata round trips and table-activity privacy;
- current and predecessor client/application behavior without relaxing workload or timeout budgets.

## Consequences and delivery

The campaign has an explicit custody choice rather than a hidden change to every old request.
Self-service reduces routine approval while retaining conservation, explainable outcomes and table visibility.
It does not grant player-to-player write authority or broaden private-profile sharing.

Implementation must wire routes, shared policy/authority, both stores, capabilities, Hub/Sheet controls and
records together. The capability and campaign opt-in default off. Publication is not deployment, and this
decision authorizes no live migration, release, campaign activation or private-launch GO.

Reserve a different available ADR if later critical-roll authority changes; 0021 now belongs to this decision.
