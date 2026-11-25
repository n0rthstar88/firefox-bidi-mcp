# firefox-bidi-mcp

Let an AI agent drive **your everyday Firefox**, with your real profile, tabs
and logins, instead of a separate automation browser. It's a small
[MCP](https://modelcontextprotocol.io) server that talks to Firefox's built-in
[WebDriver BiDi](https://w3c.github.io/webdriver-bidi/) remote control, so it
works with any MCP client.

No browser extension is involved, so nothing needs signing by Mozilla.

## Why not an extension?

Release Firefox only installs add-ons that Mozilla has signed, and many
agent browser extensions are Chrome-only. Firefox already has a standard
remote-control protocol, so this uses that: start Firefox with
`--remote-debugging-port`, and the server connects to it on `127.0.0.1`.

## Install

Linux, Firefox 129 or newer, Node.js 18 or newer.

```sh
git clone https://github.com/n0rthstar88/firefox-bidi-mcp
cd firefox-bidi-mcp
./install.sh
```

The installer prints the server entry to add to your MCP client. Then **quit
Firefox completely** (Ctrl+Q), start it again, and restart your MCP client.
While remote control is on, Firefox shows a robot icon and a striped address
bar.

`install.sh` sets up three things, and `./uninstall.sh` removes them:

| What | Where | Why |
|---|---|---|
| Wrapper | `~/.local/share/firefox-bidi-mcp/bin/firefox` | Starts the real Firefox with `--remote-debugging-port=9222` |
| Desktop entry | `~/.local/share/applications/firefox.desktop` | Your launcher, and links from other apps, start Firefox through the wrapper |
| Profile pref | `user.js` in your default profile | `remote.prefs.recommended=false`, see below |

The wrapper is named `firefox` on purpose. Some launchers, such as Omarchy's,
read only the first word of the desktop entry's `Exec` line and focus the
window by that command's name.

### The profile pref matters

When remote control is on, Firefox applies its automation defaults unless told
not to. Those defaults turn off Safe Browsing (phishing and malware
protection), the popup blocker and updates. That's fine for a test browser,
but not for the one you use every day, so the installer sets
`remote.prefs.recommended` to `false`.

### Adding it to your MCP client

Run `node /path/to/firefox-bidi-mcp/server.js` as a stdio MCP server. For
clients that read an `mcpServers` config:

```json
"firefox": {
  "command": "node",
  "args": ["/path/to/firefox-bidi-mcp/server.js"],
  "env": { "FIREFOX_BIDI_PORT": "9222" }
}
```

To use a port other than 9222, set `FIREFOX_BIDI_PORT` for both `install.sh`
and the server.

## Tools

| Tool | Does |
|---|---|
| `tabs_list`, `tab_select`, `tab_new`, `tab_close` | Manage tabs. Tools act on the "current" tab, which starts as the one you're looking at |
| `navigate` | Go to a URL, or `back`, `forward`, `reload` |
| `read_page` | List visible links, buttons and fields with short refs (`e1`, `e2`, ...) plus headings |
| `get_text` | Readable text of the page or one element |
| `screenshot` | PNG of the visible page; its pixels match `click`'s x/y |
| `click`, `type`, `press_key`, `select_option` | Interact by ref, CSS selector or coordinates |
| `scroll`, `wait_for` | Scroll by a screen or to an element; wait for a selector or text |
| `evaluate` | Run JavaScript in the page |

If a click, a typed search or a key press opens a new tab, the tool switches to
that tab and says so, so the next step happens where the result is.

## Things to know

- **One session at a time.** Firefox allows a single remote session, so two
  agent sessions can't control it together. The server connects on first use
  and lets go when the session ends.
- **Local access.** The port listens on `127.0.0.1` only, but any program
  running as you can use it while Firefox is open, as with any local browser
  automation bridge. Remove it with `./uninstall.sh` if that's not acceptable.
- **Brand-new profiles.** On a profile's very first launch, Firefox's "open
  tab" command can stall. Every tool gives up after 45 seconds, so the client
  never hangs; it works from the second launch on.
- **Firefox updates.** The desktop entry is a copy, so it doesn't change when
  your Firefox package does. Re-run `./install.sh` after a big update if the
  menu entry looks out of date.

## Tests

```sh
npm test          # throwaway headless Firefox on port 9333; your browser isn't touched
node test/live.mjs  # against your running Firefox: opens and closes test tabs
```

## License

MIT
