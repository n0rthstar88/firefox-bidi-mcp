#!/bin/bash
# Removes what install.sh added. Your Firefox profile is left alone except for
# the one remote.prefs.recommended line.
set -euo pipefail
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

if grep -q 'firefox-bidi-mcp' "$DATA/applications/firefox.desktop" 2>/dev/null ||
  grep -q "$DATA/firefox-bidi-mcp/bin/firefox" "$DATA/applications/firefox.desktop" 2>/dev/null; then
  rm -f "$DATA/applications/firefox.desktop"
fi
rm -rf "$DATA/firefox-bidi-mcp"

for root in "${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/firefox" "$HOME/.mozilla/firefox"; do
  for js in "$root"/*/user.js; do
    [[ -f $js ]] || continue
    sed -i '/firefox-bidi-mcp/d; /remote control is enabled\.$/d; /user_pref("remote.prefs.recommended", false);/d' "$js"
  done
done

echo "Removed. Restart Firefox to turn remote control off, and remove the firefox server from your MCP client."
