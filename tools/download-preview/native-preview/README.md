# Native download preview

Completed PDF and image downloads now open a per-window native preview from
both the four-item hover stack and Library Downloads. Other files retain their
normal opening behavior. The preview uses compact QLPreviewView, file navigation,
Escape, a backdrop click, the default application, and the five-item native More
menu. Hide/Trash reuse the existing download-history and private-window rules.
Only these destructive-to-the-list actions cross the event queue; Open, Copy,
and Show in Finder execute directly in the native menu event.

Reference: Arc 1.171.0 (89666), executable SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`.
The source was inspected read-only; Arc files, preferences and actions were not
modified. Its public lecture PDF was opened read-only in the disposable Zen
profile for the same-file visual comparison. No reference document is checked in.

## Reference measurements

- MediaPreviewWindow constructor `0x102632d28`: borderless, transparent,
  unreleased-on-close child window. Present `0x10262eb24`: parent's frame,
  ordered above, key window. `0x10262eb1c` permits key-window status.
- Panel sizing `0x102631170`: each dimension is
  `max(100, round(parentDimension * 0.8) - 50)`, centered by `0x102630fec`.
- Backdrop `0x102631378`: black, opacity 0.7, continuous 10-point corners.
  Modal container `0x1026318a0`: white, continuous 16-point corners.
- Toolbar `0x10262a4c4`: outer spacing 4 and horizontal padding 8.
  Navigation spacing is explicitly zero (`0x10262a908`); the Open label's
  text/symbol spacing is 4 (`0x10262b9ac`). Filename: system 14 semibold;
  date: system 14, opacity 0.5 (`0x10262b400`).
- ToolbarButtonStyle `0x1026348f4`: label pressed opacity 0.66, font 14 semibold,
  horizontal padding 10, minimum width/height 30, corner radius 6, vertical
  padding 8, disabled opacity 0.5. This produces a 46-point toolbar.
- Read-only native color lookup of BaseHomeComponents Background/Background2:
  dark white at 0.10/0.15; light sRGB (0,0,0.09) at 0.07 and (0,0,0.092) at 0.12.
  The preview uses native legacy Dark/Light material. Explicit active material
  is required in Zen's borderless child to reproduce Arc's translucent fill;
  AppKit's follow-window state produced an incorrect solid dark fill here.
- BlurredItemContent `0x10262b9e4`, `0x10262bdf8`: image stretched into 20% of
  the panel dimensions, blur radius 30, scale 7, drawing group. The implementation
  obtains a cancellable Quick Look thumbnail for this background. Its 512-point
  request size has not been established as Arc's original thumbnail request size.
- Compact QLPreviewView style 1 is created at `0x100ac1a1c`. Same-file native
  screenshots at a 1720×992 browser window exposed the additional 16-point
  content inset; adding it aligns the rendered PDF size and panel margins.

## Ownership and validation

The ABI accepts bounded JSON and matches the native handle by enumerating the
process's windows; it never dereferences caller-supplied window pointers.
Sessions are main-thread-only and bounded. File actions use stable original
item tokens, so navigation and removal cannot act on a replacement session.
The event buffer is allocated only when there is an event, and polling stops
on close/unload. No production profile is instrumented.

An initial headed test exposed a Quick Look double-deactivation abort during
SwiftUI's deferred teardown. SwiftUI dismantle now owns the single explicit
close, and automatic window closure is disabled on QLPreviewView. The native
lifecycle test now drains the autorelease pool before declaring success.

The Media grid's existing HTML preview and its thumbnail morph are unchanged
by this increment. Download-source feed coverage, image-specific Arc preview
behavior, first-frame/motion parity and broad browser performance comparisons
remain separate verification work. This is not a claim of full Arc parity or
browser-wide speed superiority.

Final native checks also cover More → Escape (menu closes, preview remains),
Left/Right file navigation and backdrop dismissal. The key monitor defers to
the active native menu. Separate backdrop and panel views plus native view
controllers match the reference ownership structure.

A suspected image-only gray backdrop was isolated to an automated click:
clicking only the PDF filename reproduced the same gray capture in both Arc
and Zen. Native window transparency, parent ownership and layer flags stayed
unchanged. This observation is not evidence of an image-specific Zen defect.

Validation: 444 source tests, 112 configuration tests, 51 native lifecycle and
geometry checks (after deferred teardown), and 462 logical headed checks. The
file-menu suite initially inherited an active progress fixture; its 35 menu
checks passed after fixture cleanup without changing product code. The seven
file-action checks had already passed. See validation.json for limitations.
