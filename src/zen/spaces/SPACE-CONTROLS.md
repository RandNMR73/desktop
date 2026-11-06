# Space heading and Clear controls

The Space icon is visible while its pins are expanded and the heading is idle.
Hovering anywhere over the heading replaces it with a downward chevron in the
same 16 pt slot; leaving restores the icon. Collapsing keeps a right chevron in
that slot, including outside hover. The label stays at the same position.

The heading and tab rows share Arc's `SidebarItemBackground` hover color. The
More button paints an additional layer of that color over the heading layer
when hovered. Leaving More clears only its layer; leaving the heading clears
both. An open More menu retains the heading and button highlights. These rules
apply to both pinned and floating sidebars. The previous R83 interpretation
that expanded hover retains the icon and a transparent heading was incorrect;
the user's 2026-11-06 hover references establish the required states.

Clear uses SF `arrow.down`, bold at 10 pt, and a 10 pt bold system label. The
arrow stays visible even when the selected ordinary tab is excluded from Clear;
the close-eligibility attribute must not hide the glyph.
The separator is 0.5 pt. Sidebar entry/exit reveals/hides the control with a 100 ms
ease-out fade. The resting color is BaseAssets ForegroundTertiary (black/white
at 30%); hover uses ForegroundPrimary (Display P3 14/255, 15/255, 16/255 at 90%
in light appearance; white at 80% in dark appearance). Pressing moves the arrow
down 3 pt over 175 ms and changes its color to the primary RGB at 66% alpha.

Reference: installed Arc 1.171.0 arm64, read-only symbols/assets and ordinary UI
captures on 2026-11-06. `SidebarClearButton` font getter 0x10030f9ec resolves
FontSet.sectionHeaderButton; the default at 0x100d97fb4 is 10 pt bold.
`UnpinnedSectionDividerCellView` 0x1001ab0ac uses `arrow.down` with that size and
NSFontWeightBold. The hover publisher callback 0x1003112c4 selects primary versus
tertiary. The press/release offsets and durations are at 0x100310174 and
0x100310334. The divider reveal uses 100 ms ease-out at 0x1001aca18.
`ChevronView` builds two 8-by-2 pt rounded bars, with 1 pt radii and ±45° rotations;
the heading's collapsed branch shows that leading chevron.

The Astralforge profile must not override these with its old after-label caret,
13 pt Clear label, cross/dart glyphs, or permanently visible Space icon. The icon
CSS generator excludes these two fork-owned controls to prevent regeneration
from restoring the obsolete substitutions.

Validation artifacts: `space-header-clear-2026-11-06` in the local Zen validation
folder. Runtime checks cover all five configured Spaces in pinned and floating
sidebars: icon/chevron state, stable label position, hidden/revealed/hover/press/
release states, visible 12 pt Clear glyph, and collapse/expand clicks. Ordinary
pointer movement also verifies sidebar entry/exit and direct Clear hover in
the pinned fixture. Clear closes its eligible ordinary tabs and preserves pins.
Arc captures establish the visible
states; the runtime checks exercise Zen's actual loaded styles, not CSS text
matching. Exact AppKit/Gecko glyph rasterization and pointer-boundary timing are
not asserted to be pixel-identical by these checks.

Expanded hover correction: `space-heading-hover-2026-11-06` validates heading
entry/exit, nested More entry/exit, stable label position, and both chevron
orientations across five Spaces and both sidebar modes. Read-only Arc
`SidebarSectionHeaderView` at 0x1001c4a58 and 0x1001c6bcc loads
`SidebarItemBackground` via 0x100be1274 for the hover layer.
