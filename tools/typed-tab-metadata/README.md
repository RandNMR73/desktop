# Typed tab result metadata

Typed tab results now use the current window’s live tab metadata in the active Space and visible Favorites. This covers restored tabs without Places records. An eligible split view is represented once with its pane labels and icons and a “Switch to Split View” action. Results carry the existing window-local identity guards; a split that no longer exists cannot activate as a stale split result.

The Places open-page join is scoped before history conversion. Consequently, a visited page in another Space remains a history result, while an unvisited tab outside the scope is excluded. The scope uses parameterized JSON keys containing URL, container, and group. No app names, domains, or icon colors are hardcoded.

The renderer retains the query when selecting a live tab, shows its icon in the input, and avoids replacing a saved tab title with cached history metadata. Pane icon cells use the selected/unselected states observed in Arc.

Validation is recorded in [validation-2026-11-03.json](validation-2026-11-03.json). The native scripts require an isolated `zen-search-color-retention-` profile and must never run against normal browsing profiles. The robot indicator visible in local fixture screenshots is Firefox’s Marionette indicator. The normal installed app does not use that test controller.

This is a candidate, not a claim of full Arc parity. Packaging, query-cost validation, result ranking, and further split/duplicate edge cases remain before release.
