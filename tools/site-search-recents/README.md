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

Empty scopes now admit the history text match directly, including title-only
matches whose URLs cannot be decoded as current engine submissions. They clean
the title before collapsing case-insensitive, canonically equivalent labels,
retaining the newest destination. Equal URL terms with different displayed
labels remain separate. The muxer's engine-host restriction exempts only this
provider's empty-scope search results; ordinary URL results retain that check.
Typed completions still use their separate engine parser and ranking path.

A subsequent normal-UI Arc check visited two temporary local pages with the
YouTube prefix in their titles. Arc admitted the first and collapsed the second
identical label while consuming another history candidate. Both temporary
visits were removed through Arc's History UI and its original paused tab was
restored. No Arc files or databases were edited. The new implementation passes
984 source tests, 90 packaged-browser checks and 44 archive tests. A real
Cmd+T → YouTube → Tab → Enter sequence reopened a title-only match's saved URL.
See `admission-validation-2026-11-04.json` for the results and remaining limits.

Local-file recents now also reopen their saved file URL instead of submitting
its title to the engine. Normal Arc UI confirmed this behavior; a packaged Zen
check verifies filenames with spaces and Unicode, fragments, serialization,
actual page loading and unchanged edited-query behavior. The allowlist remains
HTTP(S) and file for this provider. The 112 packaged-browser checks include the
existing 90 checks plus 22 file checks; source and archive suites also pass.
See `file-validation-2026-11-04.json`.

Other non-web schemes, complete final ranking, and the opening portion of
the flash still need comparison. Same-background samples near 1.22 seconds and
after settling agree closely; they do not establish a frame-perfect animation
match. These checks are not a full parity certificate.
