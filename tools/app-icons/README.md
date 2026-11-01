# App icon choices

On macOS, Settings → Look and Feel → App Icon lists the catalog shipped with
Astralforge. The catalog includes six desktop assets (Original, Candy, Neon,
Fluted Glass, Schoolbook, and Colorful) and twelve mobile screenshot crops.
The mobile designs retain the user's photo artwork at 92–180px source resolution;
larger ICNS representations are resized copies. Images are copied byte for
byte; opening Settings never selects an icon. A click applies the choice to the
running browser's Dock and Finder icon. Use Default Icon removes the custom icon.

The native helper only changes its own application bundle. It uses AppKit's
`NSWorkspace.setIcon` and `NSApplication.applicationIconImage`; it does not modify
signed files in Contents, restart the Dock, change macOS permissions, or re-sign
the browser. A rejected write leaves the previous selection intact. The choice
is stored per application path, shared across browser profiles and windows, and
restored when the app next starts (including after a browser update).

AppKit stores a custom Finder icon in a resource fork/Finder metadata. Normal
code-signature verification continues to pass; strict metadata verification
reports that custom icon until it is cleared. Clearing the custom icon makes
strict verification pass again without re-signing. Do not strip this metadata
from a running user's app as part of validation.

Build the helper and catalog:

```sh
python3 tools/app-icons/build.py --icons /path/to/Astralforge/config/zen/icon \
  --output /path/to/Astralforge/config/zen/icon
```

Astralforge's `zen_app_icons.install` verifies the manifest and native signature,
then copies the helper and assets into an owned staging bundle before signing.
`TestAppIcons.m` must run inside a disposable app bundle with its own identifier;
never point tests at a production browser. Tests exercise catalog choices,
invalid choices, reset, and artwork persistence across processes. The restart
pixel check normalizes AppKit's display-color-space snapshot to sRGB first.

## Mobile artwork

The user authorized direct extraction from the three supplied photos. Astralforge
stores twelve complete crops, matching previews and ICNS files, plus crop bounds
and hashes in `config/zen/icon/mobile-crops.json`. Partial edge neighbors are
excluded. These are separate choices from the similarly named desktop assets.
The chooser reads the packaged catalog dynamically; adding these assets requires
no additional hard-coded preferences UI entries.
