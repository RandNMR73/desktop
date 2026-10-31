# Sidebar subtitle priority

Reference: Arc 1.171.0 (89666), arm64 executable SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`.
Read-only Mach-O reflection and disassembly; Arc was not modified.

Arc has one optional String `TabCellState.subtitle` at offsets 0x18/0x20
and one subtitle view in the row. Its constructor at 0x1002b4310 first
calls 0x1002b5bc4. A non-nil result is stored at 0x1002b48f4 and skips
the later rename-hint and live-item subtitle paths.

The first helper reads `SidebarSpaceState.developerModeState` through
field-offset-vector entry metadata+0x94. The vector starts at 0x10, so
this is field 33. It calls 0x100824b74 to format the URL host and optional
port, including bracketed IPv6. The fallback at 0x1002b4a68 reads field
59, `gitHubLiveFoldersEnabled`, through metadata+0xfc before fetching a
LiveItem and calling the provider subtitle helper at 0x102870858.

The developer host therefore takes priority over a provider update.
The title is 17pt high and the single subtitle 14pt high, centered as a
31pt stack inside a 36pt row. A changed pin's reset hover temporarily
replaces that subtitle without moving the title. Disabling Developer
Mode reveals the current provider subtitle again.

Zen previously laid out both labels, creating a 45pt stack extending
4.5pt beyond each row edge. Hiding only the provider element while the
developer host exists preserves its updates and reset behavior.

Validation uses a headed disposable profile with all five configured
Spaces. It checks provider-only, combined, reset-hover, hover-exit,
host-only, and restored-provider states after layout and transitions
settle. Hover uses a pseudo-class lock and the real mouse listeners.
Production profiles are not instrumented.
