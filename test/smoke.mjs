// Drives server.js through a real MCP client. Usage: FIREFOX_BIDI_PORT=9333 node test/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../server.js", import.meta.url).pathname], env: { ...process.env } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const out = r.content.map((c) => (c.type === "text" ? c.text : `<${c.type} ${c.data.length} b64 chars>`)).join("\n");
  console.log(`--- ${name} ${JSON.stringify(args)}${r.isError ? " ERROR" : ""}\n${out.slice(0, 1200)}`);
  return r;
};
console.log((await client.listTools()).tools.map((t) => t.name).join(", "));
const html = `data:text/html,${encodeURIComponent(`<title>Smoke</title><h1>Test form</h1><input id=q placeholder="Search"><select id=s><option value=a>Apple</option><option value=b>Banana</option></select><button onclick="document.getElementById('out').textContent='clicked '+document.getElementById('q').value+' '+document.getElementById('s').value">Go</button><p id=out></p><div style="height:3000px"></div>`)}`;
await call("tab_new", { url: html });
await call("tabs_list");
await call("read_page");
await call("type", { ref: "e1", text: "hello firefox" });
await call("select_option", { ref: "e2", option: "Banana" });
await call("click", { ref: "e3" });
await call("get_text", { selector: "#out" });
await call("evaluate", { code: "return document.title + ' ' + innerWidth" });
await call("scroll", { direction: "down" });
await call("screenshot");
await call("navigate", { url: "example.com" });
await call("navigate", { url: "back" });
await call("wait_for", { text: "Test form" });
await call("press_key", { key: "Control+a" });
await call("click", { ref: "e99" });
await call("tab_close");
await client.close();
