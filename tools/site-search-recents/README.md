# Empty site-search recent results

An empty explicit engine scope reads recent visible history. A typed scope uses
the separate completion/ranking path documented in `../site-search-history`.

Recent labels use saved page titles and the first matching site-title rule. This
matters when a page corrects spelling, includes a notification count, or gives a
title different from the terms in its URL. The saved URL remains separate from
the display label: selecting a recent reopens that URL with its filters and
fragment intact. Typing a new query still submits through the selected engine.

Read-only Arc 1.171.0 ARM64 inspection on 2026-11-04 found:

- `0x102b77f88` constructs search-history results from each history page's title
  and original URL (`0x102b78260`, `0x102b7829c`, type 2 at `0x102b78488`).
- `0x102b799a0` converts them to Chromium search-history archetypes and invokes
  the generic title cleaner at `0x102b7a154`–`0x102b7a1f0`, retaining the URL.
- `0x1013d1914` selects the first host/path/fragment rule, applies its ordered
  modifiers, and rejects an empty rewrite without trimming the returned label.
- The display getter also invokes that cleaner at `0x1022118ec`.

`ZenSiteSearchTitleRules.mjs` records all 51 host entries in the installed
reference's current web-content configuration. It includes the current Notion
rules, which differ from the older 52-host bundled fallback. The rules have no
user history or account data. They are packaged with Zen and require no Arc
installation at runtime. `ZenSiteSearchTitles.mjs` implements ordered matching,
one `www.` removal, Foundation path/fragment behavior and Unicode whitespace.

Validation covers 982 source tests and 64 checks in a disposable packaged browser:
YouTube, Google, Amazon and Reddit label/destination checks, plus the existing
YouTube/Google candidate-budget and untitled-visit checks. A real Cmd+T → YouTube
→ Tab → Down → Enter sequence displayed the cleaned titles and opened the second
row's original query and filter. External requests were blocked in that fixture.
The source patch reconstructs the packaged module exactly; the managed overlay
reproduces the tested archive and is a no-op when reapplied.

This change preserves the existing parser and query-deduplication behavior.
Their complete reference equivalence, the full Arc activation pipeline, final
ranking, and time-aligned flash/color parity remain under investigation. The
title and destination checks are not a full parity certificate.
