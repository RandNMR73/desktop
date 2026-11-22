#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Install (or remove) the scheduled upstream sync as a per-user LaunchAgent.
#   scripts/sync/install-sync-agent.sh             install + load (checks every 30 min)
#   scripts/sync/install-sync-agent.sh --print     show the plist, change nothing
#   scripts/sync/install-sync-agent.sh --uninstall unload + remove
# The job copies live in ~/Library/Application Support/astral-sync/bin, so it
# keeps working whatever branch or worktree this checkout is on. See SYNCING.md.
set -euo pipefail

LABEL="com.astral.zen-upstream-sync"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$HOME/Library/Application Support/astral-sync"
BIN="$DIR/bin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/astral-sync"
DOMAIN="gui/$(id -u)"
PY="$(command -v python3)"
PATH_FOR_JOB="$HOME/.local/share/mise/shims:$HOME/.cargo/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$PY</string>
		<string>$BIN/astral_sync_job.py</string>
		<string>check</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key><string>$PATH_FOR_JOB</string>
	</dict>
	<!-- Every 30 minutes; the job itself does nothing unless a sync is due and the
	     user has been idle for 10 minutes. -->
	<key>StartInterval</key><integer>1800</integer>
	<key>RunAtLoad</key><false/>
	<key>ProcessType</key><string>Background</string>
	<key>LowPriorityIO</key><true/>
	<key>Nice</key><integer>10</integer>
	<key>StandardOutPath</key><string>$LOGS/agent.log</string>
	<key>StandardErrorPath</key><string>$LOGS/agent.log</string>
</dict>
</plist>
EOF
}

case "${1:-}" in
  --print) plist; exit 0 ;;
  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL (state and logs kept in $DIR and $LOGS)"
    exit 0 ;;
  "") ;;
  *) echo "usage: $0 [--print|--uninstall]" >&2; exit 2 ;;
esac

mkdir -p "$BIN" "$LOGS" "$(dirname "$PLIST")"
install -m 0755 "$HERE/astral_sync_job.py" "$HERE/check_engine_patches.py" "$BIN/"
plist > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null
mv "$PLIST.tmp" "$PLIST"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "installed $LABEL: checks every 30 min; logs in $LOGS; state: $PY $BIN/astral_sync_job.py status"
