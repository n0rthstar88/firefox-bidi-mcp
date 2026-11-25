#!/bin/bash
# Sets up Firefox so an MCP client can drive it:
#   1. a wrapper that starts Firefox with WebDriver BiDi on localhost
#   2. a per-user firefox.desktop that launches the wrapper
#   3. remote.prefs.recommended=false in your default profile's user.js
#   4. prints how to add the MCP server to your client
# Re-running is safe. Undo with ./uninstall.sh.
set -euo pipefail

PORT="${FIREFOX_BIDI_PORT:-9222}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
WRAPPER_DIR="$DATA/firefox-bidi-mcp/bin"
DESKTOP_OUT="$DATA/applications/firefox.desktop"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

# --- find the real Firefox binary (not a wrapper, not ours) ---
FIREFOX_BIN=""
for c in /usr/lib/firefox/firefox /usr/lib64/firefox/firefox /usr/lib/firefox-esr/firefox-esr /opt/firefox/firefox; do
  [[ -x $c ]] && FIREFOX_BIN=$c && break
done
if [[ -z $FIREFOX_BIN ]] && command -v firefox >/dev/null; then
  FIREFOX_BIN=$(readlink -f "$(command -v firefox)")
fi
[[ -n $FIREFOX_BIN && $FIREFOX_BIN != "$WRAPPER_DIR"/* ]] || { echo "Firefox not found." >&2; exit 1; }
say "Firefox: $FIREFOX_BIN"

# --- node deps ---
command -v node >/dev/null || { echo "Node.js 18+ is required." >&2; exit 1; }
if [[ ! -d $HERE/node_modules ]]; then
  say "Installing npm dependencies"
  (cd "$HERE" && npm install --omit=dev --no-fund --no-audit)
fi

# --- 1. wrapper (named "firefox" so launchers that match the window by the
#        command's basename, like Omarchy's, still find the window) ---
mkdir -p "$WRAPPER_DIR"
cat >"$WRAPPER_DIR/firefox" <<EOF
#!/bin/bash
# Firefox with WebDriver BiDi remote control on 127.0.0.1:$PORT (firefox-bidi-mcp).
exec "$FIREFOX_BIN" --remote-debugging-port=$PORT "\$@"
EOF
chmod +x "$WRAPPER_DIR/firefox"
say "Wrapper: $WRAPPER_DIR/firefox"

# --- 2. desktop entry ---
SRC=""
for d in /usr/share/applications /usr/local/share/applications; do
  for n in firefox.desktop firefox-esr.desktop; do
    [[ -f $d/$n ]] && SRC=$d/$n && break 2
  done
done
if [[ -n $SRC ]]; then
  mkdir -p "$(dirname "$DESKTOP_OUT")"
  # Replace the binary at the start of every Exec= line, whatever it was called.
  sed -E "s#^Exec=[^ ]+#Exec=$WRAPPER_DIR/firefox#" "$SRC" >"$DESKTOP_OUT"
  command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP_OUT")" 2>/dev/null || true
  say "Desktop entry: $DESKTOP_OUT (from $SRC)"
else
  say "No firefox.desktop found; start Firefox with $WRAPPER_DIR/firefox yourself"
fi

# --- 3. profile pref ---
# Without it, enabling remote control also turns off Safe Browsing, the popup
# blocker and updates (Firefox's automation defaults).
PROFILE=""
for root in "${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/firefox" "$HOME/.mozilla/firefox"; do
  [[ -f $root/profiles.ini ]] || continue
  # The profile Firefox actually opens: an [Install...] section in profiles.ini,
  # then any section of installs.ini, then the profile marked Default=1.
  rel=$(awk -F= '/^\[/{i=($0 ~ /^\[Install/)} i&&$1=="Default"{print $2;exit}' "$root/profiles.ini")
  [[ -z $rel && -f $root/installs.ini ]] && rel=$(awk -F= '$1=="Default"{print $2;exit}' "$root/installs.ini")
  if [[ -z $rel ]]; then
    rel=$(awk -F= '/^\[Profile/{p="";d=0} $1=="Path"{p=$2} $1=="Default"&&$2=="1"{d=1} d&&p{print p;exit}' "$root/profiles.ini")
  fi
  if [[ -n $rel ]]; then
    [[ $rel == /* ]] && PROFILE=$rel || PROFILE=$root/$rel
    break
  fi
done
if [[ -n $PROFILE && -d $PROFILE ]]; then
  if ! grep -q 'remote.prefs.recommended' "$PROFILE/user.js" 2>/dev/null; then
    cat >>"$PROFILE/user.js" <<'EOF'
// firefox-bidi-mcp: keep Safe Browsing, the popup blocker and updates on while
// remote control is enabled.
user_pref("remote.prefs.recommended", false);
EOF
  fi
  say "Profile pref set in $PROFILE/user.js"
else
  say "Default profile not found: add user_pref(\"remote.prefs.recommended\", false); to your profile's user.js"
fi

# --- 4. MCP client setup ---
echo
echo "Done. Add this stdio MCP server to your MCP client:"
echo
echo "  command: node"
echo "  args:    $HERE/server.js"
echo "  env:     FIREFOX_BIDI_PORT=$PORT"
echo
echo "As JSON, for clients that read an mcpServers config:"
echo "  \"firefox\": { \"command\": \"node\", \"args\": [\"$HERE/server.js\"], \"env\": { \"FIREFOX_BIDI_PORT\": \"$PORT\" } }"
echo
echo "Then quit Firefox completely (Ctrl+Q), start it again, and restart your MCP client."
