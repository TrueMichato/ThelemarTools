# Hub browser surfaces

The Hub's browser layer is `js/hub/`, rendered into two pages, `hub.html`
and `campaign.html`. Most Hub work eventually touches it, and the game day showed that its problems are not
cosmetic: divergence between entry paths, unclear sharing, and unreadable failure states were among the loudest
findings. This file covers how the surface is put together and the constraints it must keep.

For authority and data-flow rules see [Architecture and authority](./architecture-and-authority.md); for the
defect patterns behind the guidance here see [Pitfalls and failure modes](./pitfalls-and-failure-modes.md).

## Layout of the browser layer

`campaign.html` loads exactly two scripts: `js/styleswitch.js` and `js/hub/hub-page.js` as a module. Everything
else arrives through the module graph, which is deliberate and budgeted — see the boot budgets below.

| Concern | Modules |
|---|---|
| Page controller for both Hub pages | `hub-page.js` |
| Transport | `hub-api-client.js`, `hub-realtime-client.js`, `hub-capabilities.js`, `hub-store-error.js` |
| Character data and conflict handling | `hub-http-character-repository.js`, `hub-character-repository.js`, `hub-character-operation-reconciler.js`, `hub-character-operation-events.js`, `hub-json-patch.js` |
| DM workspaces | `hub-http-dm-workspace-repository.js`, `hub-dm-workspace-repository.js` |
| Active campaign context | `hub-active-campaign-store.js`, `-record.js`, `-channel.js`, `-coordinator.js`, `-switcher.js`, `hub-campaign-context.js`, `hub-site-context.js`, `hub-surface-defaults.js`, `hub-route-policy.js` |
| Rules, content, carry | `hub-campaign-rules.js`, `hub-campaign-rule-evaluator.js`, `hub-rules-policy-manager.js`, `hub-content-policy.js`, `hub-carry-authority.js`, `hub-carry-contract.js`, `hub-brew-context.js` |
| Inventory and awards | `hub-inventory-contract.js`, `hub-inventory-equivalence.js`, `hub-item-award.js`, `hub-item-catalog.js`, `hub-source-costs.js` |
| Semantic targeting | `hub-multi-target-operations.js`, `hub-healing-word-spells.js`, `hub-lay-on-hands.js`; shared Sheet source/incoming controllers |
| Presentation | `hub-activity-render.js`, `hub-event-presentation.js`, `hub-effect-presentation.js`, `hub-character-view.js`, `hub-condition-catalog.js`, `hub-semantic-hp.js` |
| Cross-tab and local bridging | `hub-broadcast-sync.js`, `hub-local-character-adapter.js`, `hub-roll-log-adapter.js`, `hub-auth-providers.js` |

`hub-page.js` and `hub-http-character-repository.js` are both very large and both are hot spots. Prefer adding a
focused module and wiring it in over growing either further.

## The two-flow problem

A character or DM Screen can be reached two ways: through the campaign, or through the ordinary site with a
campaign context selected. During the game day these produced materially different controls — campaign entry
exposed sharing configuration, ordinary entry exposed none — and the owner called the divergence itself "a huge
problem", separately from any individual bug.

Treat it as a standing design constraint rather than a backlog item. When you add or change a Hub-aware surface,
work out what the other entry path does and make any difference deliberate and explainable. The active-context
modules (`hub-active-campaign-*`, `hub-site-context.js`, `hub-surface-defaults.js`, `hub-route-policy.js`) exist
to give ordinary pages the same campaign awareness; use them rather than special-casing the campaign page.

## Contracts the UI must keep

`test/jest/hub/HubPageContract.test.js` encodes these, so they are enforced rather than aspirational. The
recurring themes:

- **Every state is explicit.** Signed-out, loading, error, and signed-in all exist, plus explicit campaign
  loading, connection, empty, and mutation feedback. A surface with no empty state or no failure state will fail
  the contract.
- **Failures are actionable.** Protocol, service, access, resource, and validation problems each say something
  the user can act on. "Something went wrong" is not acceptable, and neither is a raw error code.
- **Unavailable means absent, not disabled-looking.** Role-specific controls stay out of campaign views the user
  cannot act in; a control that fails closed when pressed is worse than no control.
- **Progressive disclosure is semantic.** The campaign reads as a pinned session brief before administration,
  and every action stays reachable behind that disclosure rather than being hidden outright.
- **Keyboard first.** Campaign creation is inline and keyboard-addressable, and opening campaign actions moves
  focus to the requested task in the right order.
- **Attention is announced in text.** Colour is restrained and never the sole carrier of meaning.
- **Offline is honest.** Loaded campaign data stays visible while offline, and a refresh is required after
  reconnecting rather than silently assuming the view is still current.
- **DM inspection is labelled as inspection,** not presented as editing another member's sheet.
- **History paging stays fenced** across authorization changes and errors, including for archived campaigns.

## Sharing must be legible

Sharing worked at the game day but nobody could tell what it did: owners could not see what peers actually
received, and the controls took free-form text where a fixed set of options existed.

So when you touch sharing, make the effect visible from the owner's side — `expectSavedSharingPreview` and
`expectSharedProfile` exist in the E2E page object for exactly this — and offer the known options as a choice,
with free-form entry only as an addition rather than the only input. Privacy that users cannot verify does not
feel like privacy, and the correct server behaviour underneath does not fix that.

## Boot and transfer budgets

`test/jest/hub/HubPerformanceBudget.test.js` holds the Hub to a small boot graph, because these pages must load
fast and must not drag in the general 5etools data graph:

- Signed-out provider controls load only through the lazy helper, not the static graph.
- The signed-out static module graph has a request budget, counted across every static declaration form — so a
  new top-level `import` in the boot path can fail the budget even when the code is small.
- Active-context selection modules stay within 8 KiB transfer, the persisted selection record within 1 KiB, and
  those modules must stay free of heavy dependencies.
- Campaign brew is rejected above 1 MB and HTTP bodies above 2 MB before route handling.

The E2E suite adds live budgets on top: no third-party requests, no loading of `/data`, `/fonts`, `/homebrew`,
`/prerelease`, or `/search`, an initial request ceiling, and an LCP budget. If you need something heavy, load it
lazily behind the interaction that needs it.

## Styling

`scss/hub.scss` defines a `--hub-*` custom-property palette — surface, recessed, text, secondary, muted, border,
primary, danger, success, warning, focus — and `.ve-night-mode` re-declares the same variables. Night mode is
therefore a palette swap, not a second set of rules.

Style against the variables rather than literal colours, and add a night-mode value whenever you add a variable.
`dmscreen-hub.scss` covers the Hub-aware DM Screen surface. The E2E suite audits accessible names, 44 px touch
targets, and mobile reflow without horizontal overflow, so new controls need labels and adequate hit areas from
the start.
