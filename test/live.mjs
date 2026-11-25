// Quick check against your real Firefox: opens one test tab, reads it, closes it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
const client = new Client({ name: "live", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../server.js", import.meta.url).pathname] }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const out = r.content.map((c) => (c.type === "text" ? c.text : `<${c.type}, ${c.data.length} b64 chars>`)).join("\n");
  console.log(`--- ${name}${r.isError ? " ERROR" : ""}\n${out.slice(0, 600)}`);
  return out;
};
const before = await call("tabs_list");
const n = before.split("\n").length;
console.log(`(${n} tabs open)`);
await call("tab_new", { url: "https://example.com" });
await call("read_page");
await call("screenshot");
await call("tab_close");
// Link handoff: open a URL the way clicking a link does, then confirm it landed in this Firefox.
const opener = ["omarchy-launch-browser", "xdg-open"].find((c) => {
  try { execFileSync("sh", ["-c", `command -v ${c}`]); return true; } catch { return false; }
});
if (!opener) { console.log("No link opener found; skipping handoff check."); await client.close(); process.exit(0); }
execFileSync(opener, ["https://example.org/?handoff-test"]);
await new Promise((r) => setTimeout(r, 3000));
const tabs = await call("tabs_list");
const line = tabs.split("\n").find((l) => l.includes("handoff-test"));
console.log(line ? "HANDOFF OK: link opened in the running Firefox" : "HANDOFF: test link not found in tabs");
if (line) await call("tab_close", { index: Number(line.match(/\[(\d+)\]/)[1]) });
await client.close();
