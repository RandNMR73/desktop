# Saved Favorite artwork

When a page fails to load, Gecko can replace its live favicon with the generic information icon. The saved Favorite still has valid artwork. Use that artwork for the tile and color outline while preserving the live favicon and pinned state. Custom icons retain precedence; a new real favicon removes the fallback. Saved-artwork changes refresh all synced windows.

Validation: 802 source tests and 14 checks in a disposable Gecko profile, including computed image content and two synced windows. `browser-artwork.js` runs through the asynchronous chrome-context browser test harness; it refuses the production profile. A separate visual capture confirmed the saved blue-book artwork renders in the candidate. The fixture waits for asynchronous tab identity/pin initialization before setting state.

This fixes the missing/error favicon case. It does not claim all of Arc’s special app artwork is matched, nor full visual or performance parity.
