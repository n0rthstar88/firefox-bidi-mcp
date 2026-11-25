// Checks that click/type follow a tab the page opens. Usage: FIREFOX_BIDI_PORT=9333 node test/newtab.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "newtab", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../server.js", import.meta.url).pathname], env: { ...process.env } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const out = r.content.map((c) => c.text ?? "").join("\n");
  console.log(`--- ${name}${r.isError ? " ERROR" : ""}\n${out.slice(0, 400)}`);
  return out;
};
const html = `data:text/html,${encodeURIComponent(`<title>Start</title>
<a href="https://example.com/?from-link" target="_blank">open results</a>
<form action="https://example.com/" target="_blank"><input name="q" placeholder="Search"></form>`)}`;
await call("tab_new", { url: html });
const a = await call("click", { ref: "e1" }).catch(() => ""); // refs need read_page first
await call("read_page");
const c = await call("click", { ref: "e1" });
console.log(c.includes("new tab") && c.includes("from-link") ? "PASS click followed new tab" : "FAIL click");
await call("tab_close");
await call("tab_select", { index: Number((await call("tabs_list")).split("\n").find((l) => l.includes(" Start "))?.match(/\[(\d+)\]/)?.[1] ?? -1) });
await call("read_page");
const t = await call("type", { ref: "e2", text: "weather", submit: true });
console.log(t.includes("new tab") && t.includes("example.com") ? "PASS type+Enter followed new tab" : "FAIL type");
await call("tab_close");
const k = await call("press_key", { key: "Escape" });
console.log(!k.includes("new tab") ? "PASS no false new-tab report" : "FAIL press_key");
await call("tab_close");
await client.close();
