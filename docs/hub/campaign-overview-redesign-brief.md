# Campaign Overview redesign brief

Status: implemented as the final Campaign Hub lane. The overview now uses the approved **Pinned session brief**
composition while preserving the existing V1 mutations, authority boundaries, privacy projections, and recovery states.

## Purpose and timing

Campaign Overview should answer two questions quickly: **Is this campaign ready?** and **What needs my attention?**
It should orient players and DMs, summarize campaign state, and expose setup without becoming another active-play
workspace.

The implemented overview is an Operate-mode surface for the live shared campaign. T5 campaign context remains a
whole-site capability. T6 policy remains authoritative in the Hub/API and is enforced consistently by Builder,
LevelUp, Character Sheet, and DM surfaces. This lane changes information architecture and the minimum client behavior
needed to support it; it does not move or weaken server-owned operations.

## Implemented direction

The page reads as the brief for one table rather than a settings portal. Campaign identity, connection, role, and one
role-specific continuation action lead. A dominant party manifest sits beside attention and a compact session/setup
rail. Recent activity follows. Effects, transfers, XP, and item awards remain available in the **Campaign actions**
disclosure, while people, invitations, homebrew, rules, and policy management remain in **Administration**. Native
`details` disclosures preserve keyboard behavior without modal interruption. On narrow screens, the sequence is
identity and primary action, attention, manifest, session/setup, activity, campaign actions, then administration.

## Method and evidence

The source critique used two isolated assessments:

- **Assessment A:** `campaign-design-review`, a design review covering hierarchy, information architecture,
  accessibility, cognitive load, role fit, responsive behavior, and failure states.
- **Assessment B:** `campaign-detector-review`, a deterministic static/browser detector pass.

This was a dual-agent critique, not user research. The local static environment could not authenticate against the Hub
API, so no authentic populated campaign data loaded. Assessment A instead exercised source-faithful representative
DM/player states at 1440 px and 390 px. Assessment B injected the detector in an automated tab. No durable visual
overlay remains because the critique-only servers were stopped, and this brief does not claim screenshots or observed
user behavior.

The static detector returned zero findings. The authenticated-but-hidden DOM scan reported 58 hits across 54 elements:
52 `undersized-ui-text`, 5 `tiny-text`, and 1 `overused-font`. The Inter finding is a false positive because Inter is
the intentional product typeface. The text-size findings remain relevant in markup and CSS, but the unauthenticated
error state prevented visual confirmation of every populated case. At 390 px the representative state had no
horizontal overflow, but the DM page exceeded four viewports.

## Nielsen design health: 19/40

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Strong loading, live/offline, pending, and inline feedback; fatal errors lack retry |
| 2 | Match between system and real world | 2 | "Cloud copy," "snapshot," and "reserve transfer" expose implementation concepts |
| 3 | User control and freedom | 2 | Grants, effects, and published rules lack practical undo |
| 4 | Consistency and standards | 2 | Apply/Accept and Give/Reserve describe similar lifecycle steps inconsistently |
| 5 | Error prevention | 2 | Consequential actions lack impact previews and hurried targeting remains easy |
| 6 | Recognition rather than recall | 2 | Users must remember ownership, balances, and local/cloud/party distinctions |
| 7 | Flexibility and efficiency | 1 | Jump links are the only accelerator; batch/session workflows are absent |
| 8 | Aesthetic and minimalist design | 1 | Duplicate rosters and four operational forms obscure campaign state |
| 9 | Error recovery | 3 | Trustworthy failure copy exists, but terminal errors can lack a recovery action |
| 10 | Help and documentation | 1 | Descriptions exist without contextual onboarding or task-focused help |
| **Total** | | **19/40** | **Poor - redesign information architecture before visual polish** |

The accessible foundations, explicit role rendering, responsive stacking, and trust-preserving network copy are strong.
The composition is nevertheless a generic administration dashboard whose simultaneous jobs overwhelm its D&D-specific
content.

## Priority findings

### P1: Campaign Overview has conflicting purposes

Players and DMs cannot tell whether the route is for opening play, resolving requests, changing characters,
administering membership, or configuring rules. Move active-play work to the surface where its context already lives.
Keep Campaign Overview focused on readiness, roster, attention, activity, and setup.

### P1: The first viewport has no decisive hierarchy

Campaign identity, account identity, duplicate party summaries, connection state, shortcuts, and actions compete
before the next task is clear. Show one role-specific primary action, a compact readiness/status line, and an attention
queue. Move account controls and administration into the global shell or a secondary setup surface.

### P1: Consequential actions lack impact preview and recovery

Effects, grants, transfers, and policy publication can change another person's character or campaign rules. While
legacy actions remain, preview actor, target, current value, resulting value, scope, and reversibility. Provide
undo/revoke where semantics permit; otherwise explain permanence and the recovery path.

### P2: Two roster concepts expose implementation details

"My characters," "Party roster," local originals, cloud copies, and campaign members overlap. Use one party roster
with ownership, access, privacy, and attach/copy state. Put local-to-campaign migration in a focused onboarding flow.

### P2: Mobile preserves the form wall instead of the urgent task

Mobile removes jump shortcuts while requests and role-primary actions can fall several viewports below the fold. Keep
the primary action and attention count near the top, retain compact access to urgent requests, use the readable text
token floor, and collapse administration.

## Personas and cognitive load

| Persona | Current failure |
|---|---|
| First-time player | Cannot predict which local original, cloud copy, owned character, or party member will open or change; empty states rarely teach the next action |
| In-session player under time pressure | Leaves the sheet, scrolls through forms, and interprets default targets for effects or transfers; mobile hides shortcuts instead of surfacing approvals |
| DM preparing or running a session | Sees setup health as small metadata while operational forms dominate; awards are individual mutations rather than previewable session actions |

The critique found **7 of 8 cognitive-load checklist failures**; only visual grouping passed. The page lacks a single
focus, chunks larger than four choices, weakens hierarchy, presents simultaneous decisions, requires working-memory
recall, and lacks progressive disclosure. Specific overload includes six effect types, nine spell-slot levels,
transfer source/recipient/item/quantity plus five currencies, six rules controls, more than four initial paths, and
four simultaneous DM "At the table" workflows.

## Target component map

```text
Global shell
`- Active campaign switcher - account - local mode

Campaign Overview
|- Campaign header
|  |- name - role - connection/capability state
|  `- one role-primary action
|- Party roster
|  `- one character model with owner/access/privacy/compliance badges
|- Attention queue
|  `- approvals - policy warnings - invitations - recoverable failures
|- Session snapshot
|  `- party readiness - shared inventory summary - next-session information
|- Recent activity
|  `- character-first events with filtering and pagination
|- Campaign actions
|  `- preserved effects - transfers - XP - item awards (collapsed)
`- Setup and administration
   |- people and invitations
   |- rules and source policy
   |- campaign homebrew
   `- lifecycle and export
```

### Action hierarchy

1. **Primary:** exactly one role-specific continuation action - **Open character** for a player or **Open DM
   workspace** for a DM.
2. **Attention:** the next resolvable approval, invitation, policy warning, or recoverable failure, ordered by urgency
   and explained in user language.
3. **Campaign context:** roster, readiness, shared inventory summary, and recent activity for orientation rather than
   mutation.
4. **Setup:** people, rules/source policy, homebrew, lifecycle, and export behind progressive disclosure.
5. **Global:** campaign switching, account controls, and local mode in the shell rather than the campaign task area.
6. **Contextual operations:** generic active-play forms remain in a labeled disclosure so no accepted capability is
   lost, but they never compete with the primary action.

The player primary action depends on campaign-character count:

- **Zero:** **Add a local character copy** moves focus to the existing campaign-copy import.
- **One:** **Open _character name_** opens that character directly.
- **Many:** **Choose a character** opens an accessible chooser, then opens the explicit selection. It never silently
  chooses or opens the first character.

### Roster consolidation

Render one party roster, not parallel "My characters" and "Party roster" concepts. Each row represents a character
and names its owner, access, privacy/compliance state, campaign attachment, readiness, and available continuation
action. Local originals and cloud copies appear only when attachment or migration requires that distinction; explain
the consequence before copy, attach, or move. Membership administration remains in setup rather than creating a
second operational roster.

Roster badges are projection- and role-scoped:

- **DM/co-DM:** truthful owner, access, and compliance state plus the exact peer-projection preview.
- **Character owner:** canonical truth for their own character.
- **Peer or spectator:** only badges permitted by the shared peer projection.

Peer/spectator rows never expose hidden canonical truth, raw sharing overrides, or badges whose presence or wording
allows replacement state to be inferred.

### Responsive composition

On desktop, keep the campaign header full width; place attention and session readiness immediately below it; then use
the available width for roster and recent activity before collapsed setup. At 390 px portrait, use one reading order:
header and primary action, status, attention, roster, snapshot, activity, then setup. A compact attention affordance
may remain reachable while scrolling, but it must not cover content, focus, or browser controls. Desktop and mobile
present the same information priority rather than preserving desktop form density in a narrow column.

## Architecture decision

The final Campaign Overview preserves generic effect, transfer, XP, and item-grant forms behind one collapsed
**Campaign actions** disclosure. Character-specific work should still prefer the Character Sheet and DMs should still
prefer the DM workspace, but equivalent contextual flows are not assumed and no accepted capability is removed in this
lane. The existing Hub API, authorization, protocol/version fences, policy enforcement, privacy projections,
idempotency behavior, and personal-versus-campaign storage boundaries remain unchanged. Campaign Overview foregrounds
summaries, attention, activity, readiness, policy visibility, and setup; mutations are findable but subordinate.

## Staged migration

1. **Stabilize responsibilities:** shipped tracks define authorization, capability, failure, reconnect, privacy, and
   observability behavior; the overview consumes those contracts without broadening them.
2. **Reshape Campaign Overview:** implemented the role-primary action, manifest, attention, session/setup rail,
   activity, collapsed campaign actions, and administration hierarchy.
3. **Preserve mutation access:** kept every incumbent effect, transfer, XP, item, membership, homebrew, and rules path
   reachable through progressive disclosure.
4. **Keep contextual evolution independent:** future Character Sheet or DM Screen replacements can be evaluated on
   their own evidence; this overview does not pre-emptively delete fallback capability.
5. **Run bounded QA:** validate authenticated desktop/mobile day/night states and retain the release gates described in
   the Hub testing guide.

## State matrix

| State | Player experience | DM experience | Required behavior |
|---|---|---|---|
| Loading | Character action and campaign summaries use labeled placeholders | Workspace action, attention, and readiness use labeled placeholders | Preserve heading structure, announce loading once, and prevent stale actions |
| Ready | Open the owned/accessible character; review attention, roster, and activity | Open the DM workspace; review attention, readiness, roster, and activity | Show one role-primary action and only authorized data/actions |
| Empty | Explain how to attach or create a campaign character | Explain how to invite people or prepare the campaign | Teach one valid next step; do not show empty operational forms |
| Recoverable error | Preserve readable cached context and offer retry | Preserve readable cached context and identify the failed summary/action | State what failed, whether data changed, and the direct recovery action |
| Terminal error | Explain why the campaign cannot open and where to go next | Explain authorization/lifecycle failure without leaking hidden campaign data | Move focus to the error, expose a safe exit/recovery route, and reveal no private detail |
| Offline/stale | Allow orientation from clearly dated safe data; disable network mutations | Allow orientation from clearly dated safe data; disable network mutations | Distinguish offline from stale, show last update, and announce reconnection |

Role changes do not create a third layout. A member who has both player and DM capabilities receives one explicit
role-primary action at a time and can switch context without losing campaign orientation. Pending and partially loaded
sections use the same component positions to avoid focus and layout jumps.

## Acceptance criteria

- **DM and player jobs:** the first viewport exposes one correct role-primary action, campaign readiness, and urgent
  attention without internal IDs or developer vocabulary. Capability, policy, ownership, access, privacy, and
  compliance state are understandable where they affect a decision.
- **390 px portrait:** no horizontal overflow; the role-primary action and attention count remain near the top; urgent
  requests stay directly reachable; administration is progressively disclosed. Mobile landscape also remains usable.
- **Keyboard and screen reader:** landmarks, headings, labels, focus order, visible focus, status announcements,
  disclosures, and all actions work without pointer input. Dynamic updates communicate useful context without noise.
- **Error and offline:** loading, empty, stale, reconnecting, offline, recoverable error, and terminal error states
  preserve trust, state whether data changed, and provide retry or a concrete recovery route.
- **Long data:** long campaign and character names, large parties, long activity histories, many attention items, and
  extensive setup data wrap, paginate, filter, or collapse without obscuring primary work.
- **Migration safety:** old and new task completion are compared during coexistence; removing legacy forms does not
  weaken authorization, privacy, local mode, observability, or any accepted player/DM capability.

The archived [full Impeccable critique](../../.impeccable/critique/2026-09-01T13-25-49Z__campaign-html.md) is the
evidence record for this brief.
