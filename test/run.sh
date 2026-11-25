#!/bin/bash
# Runs the tests against a throwaway headless Firefox on port 9333, so your own
# browser is never touched. The profile is launched twice because a brand-new
# profile's first "open tab" command stalls in Firefox.
set -euo pipefail
cd "$(dirname "$0")/.."
FIREFOX="${FIREFOX:-firefox}"
PROFILE=$(mktemp -d)
echo 'user_pref("remote.prefs.recommended", false);' >"$PROFILE/user.js"
PID=""
start() {
  "$FIREFOX" --headless --no-remote --profile "$PROFILE" --remote-debugging-port=9333 >/dev/null 2>&1 &
  PID=$!
  for _ in $(seq 60); do
    (exec 3<>/dev/tcp/127.0.0.1/9333) 2>/dev/null && return
    sleep 0.5
  done
  echo "Firefox didn't open port 9333" >&2
  exit 1
}
stop() { [[ -n $PID ]] && kill "$PID" 2>/dev/null && wait "$PID" 2>/dev/null || true; PID=""; }
trap 'stop; rm -rf "$PROFILE"' EXIT
start; sleep 3; stop; sleep 1; start

fail=0
for t in test/smoke.mjs test/newtab.mjs; do
  out=$(FIREFOX_BIDI_PORT=9333 timeout 120 node "$t" 2>&1) || fail=1
  echo "$out" | grep -E '^(PASS|FAIL)' || true
  echo "$out" | grep -q 'FAIL' && fail=1
done
# smoke.mjs prints every tool result; only the deliberate bad-ref click may error.
errors=$(FIREFOX_BIDI_PORT=9333 timeout 120 node test/smoke.mjs 2>&1 | grep -c ' ERROR$' || true)
[[ $errors == 1 ]] && echo "PASS smoke: all tools ran (1 expected error)" || { echo "FAIL smoke: $errors tool errors"; fail=1; }
exit $fail
