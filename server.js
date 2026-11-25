#!/usr/bin/env node
// MCP server that lets an AI agent drive your running Firefox over WebDriver BiDi.
// Firefox must be started with --remote-debugging-port (the launcher wrapper does that).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer from "puppeteer-core";
import { z } from "zod";

const PORT = Number(process.env.FIREFOX_BIDI_PORT || 9222);
const ENDPOINT = `ws://127.0.0.1:${PORT}/session`;

let browser = null;
let current = null; // the tab the agent is working in

async function getBrowser() {
  if (browser?.connected) return browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: ENDPOINT,
      protocol: "webDriverBiDi",
      defaultViewport: null, // use the real window size, don't resize tabs
    });
  } catch (err) {
    browser = null;
    throw new Error(
      `Can't reach Firefox remote control at ${ENDPOINT} (${err.message}). ` +
        `Firefox has to be started with --remote-debugging-port=${PORT}: quit Firefox fully and reopen it ` +
        `from the launcher, or run 'firefox --remote-debugging-port=${PORT}'. ` +
        `Only one remote session is allowed at a time, so another agent session may also be holding it.`
    );
  }
  browser.on("disconnected", () => {
    browser = null;
    current = null;
  });
  return browser;
}

async function pages() {
  const b = await getBrowser();
  return (await b.pages()).filter((p) => !p.isClosed());
}

async function page() {
  if (current && !current.isClosed()) return current;
  const all = await pages();
  if (!all.length) throw new Error("No open tabs.");
  // Prefer the tab the user is looking at.
  for (const p of all) {
    try {
      if (await p.evaluate(() => document.visibilityState === "visible" && document.hasFocus())) {
        return (current = p);
      }
    } catch {}
  }
  for (const p of all) {
    try {
      if (await p.evaluate(() => document.visibilityState === "visible")) return (current = p);
    } catch {}
  }
  return (current = all[all.length - 1]);
}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function describe(p) {
  // Ask the page itself: p.url() can lag after a back/forward cache restore.
  const info = await withTimeout(p.evaluate(() => [document.title, location.href]), 3000).catch(() => null);
  return info ? `${info[0]}\n${info[1]}` : `${await p.title().catch(() => "")}\n${p.url()}`;
}

function withTimeout(promise, ms, what = "Firefox") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} didn't answer within ${ms / 1000}s.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function element(p, { ref, selector }) {
  const sel = ref ? `[data-agent-ref="${ref}"]` : selector;
  if (!sel) throw new Error("Give a ref (from read_page) or a CSS selector.");
  const el = await p.$(sel);
  if (!el) throw new Error(`No element matches ${ref ? `ref ${ref}` : sel}. Run read_page again; refs change when the page does.`);
  return el;
}

// Tags visible interactive elements with data-agent-ref and lists them.
function snapshotScript(limit) {
  const SEL =
    'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],' +
    '[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[role="combobox"],' +
    '[role="textbox"],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
  document.querySelectorAll("[data-agent-ref]").forEach((e) => e.removeAttribute("data-agent-ref"));
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(e);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const out = [];
  let n = 0;
  for (const e of document.querySelectorAll(SEL)) {
    if (!visible(e)) continue;
    if (n >= limit) break;
    const ref = "e" + ++n;
    e.setAttribute("data-agent-ref", ref);
    const tag = e.tagName.toLowerCase();
    const role = e.getAttribute("role");
    const type = e.getAttribute("type");
    let kind = role || (tag === "input" ? `input[${type || "text"}]` : tag);
    let label =
      e.getAttribute("aria-label") ||
      (e.labels && e.labels[0] && e.labels[0].innerText) ||
      e.getAttribute("placeholder") ||
      e.getAttribute("title") ||
      e.getAttribute("alt") ||
      e.innerText ||
      e.getAttribute("name") ||
      "";
    let extra = "";
    if ("value" in e && e.value && tag !== "button") extra += ` value="${clean(e.value)}"`;
    if (e.checked) extra += " checked";
    if (e.disabled) extra += " disabled";
    if (tag === "a") extra += ` -> ${e.getAttribute("href").slice(0, 100)}`;
    if (tag === "select") extra += ` options=[${[...e.options].slice(0, 15).map((o) => clean(o.text)).join(" | ")}]`;
    const r = e.getBoundingClientRect();
    const inView = r.bottom > 0 && r.top < innerHeight ? "" : " (offscreen)";
    out.push(`[${ref}] ${kind} "${clean(label)}"${extra}${inView}`);
  }
  return {
    headings: [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 20).map((h) => `${h.tagName} ${clean(h.innerText)}`),
    elements: out,
    scroll: `scrolled ${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)}px`,
  };
}

// Runs an action; if it opened a new tab (target=_blank links, some search boxes),
// switches to that tab so the next tools act on what the user would be looking at.
async function act(p, action) {
  const before = new Set(await pages());
  await action();
  await settle();
  let opened = (await pages()).filter((x) => !before.has(x));
  if (!opened.length) {
    await settle(600); // new tabs can take a moment to appear
    opened = (await pages()).filter((x) => !before.has(x));
  }
  if (!opened.length) return `\n${await describe(p)}`;
  current = opened[opened.length - 1];
  await current.bringToFront().catch(() => {});
  await current.waitForFunction(() => document.readyState !== "loading", { timeout: 10000 }).catch(() => {});
  return `\nThat opened a new tab, now the current tab:\n${await describe(current)}`;
}

const server = new McpServer({ name: "firefox", version: "1.0.0" });

// Every tool gets a time limit and returns errors as tool errors instead of hanging.
const TOOL_TIMEOUT = 45000;
const register = server.registerTool.bind(server);
server.registerTool = (name, config, handler) =>
  register(name, config, async (args) => {
    try {
      return await withTimeout(handler(args), TOOL_TIMEOUT, `${name}`);
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  });

server.registerTool(
  "tabs_list",
  { description: "List open Firefox tabs. The one marked * is the tab other tools act on.", inputSchema: {} },
  async () => {
    const all = await pages();
    const cur = await page();
    const lines = await Promise.all(
      all.map(async (p, i) => `${p === cur ? "*" : " "} [${i}] ${await p.title().catch(() => "")} - ${p.url()}`)
    );
    return text(lines.join("\n"));
  }
);

server.registerTool(
  "tab_select",
  { description: "Switch to a tab by its index from tabs_list and bring it to the front.", inputSchema: { index: z.number().int() } },
  async ({ index }) => {
    const all = await pages();
    if (!all[index]) throw new Error(`No tab ${index}; there are ${all.length}.`);
    current = all[index];
    await current.bringToFront().catch(() => {});
    return text(await describe(current));
  }
);

server.registerTool(
  "tab_new",
  { description: "Open a new tab (optionally at a URL) and make it the current tab.", inputSchema: { url: z.string().optional() } },
  async ({ url }) => {
    const b = await getBrowser();
    current = await b.newPage();
    if (url) await current.goto(url, { waitUntil: "load", timeout: 30000 }).catch((e) => e);
    await current.bringToFront().catch(() => {});
    return text(await describe(current));
  }
);

server.registerTool(
  "tab_close",
  { description: "Close a tab by index (defaults to the current tab).", inputSchema: { index: z.number().int().optional() } },
  async ({ index }) => {
    const target = index === undefined ? await page() : (await pages())[index];
    if (!target) throw new Error(`No tab ${index}.`);
    await target.close();
    if (target === current) current = null;
    return text("Closed.");
  }
);

server.registerTool(
  "navigate",
  {
    description: "Go to a URL in the current tab, or use 'back', 'forward' or 'reload'.",
    inputSchema: { url: z.string().describe("A URL, or back / forward / reload") },
  },
  async ({ url }) => {
    const p = await page();
    const opts = { waitUntil: "load", timeout: 30000 };
    let err;
    try {
      if (url === "back" || url === "forward") {
        // goBack/goForward wait for a load event that a back/forward cache restore never fires.
        await p.evaluate((d) => (d === "back" ? history.back() : history.forward()), url);
        await settle(800);
        await p.waitForFunction(() => document.readyState === "complete", { timeout: 15000 }).catch(() => {});
      } else if (url === "reload") await p.reload(opts);
      else await p.goto(/^[a-z]+:/i.test(url) ? url : `https://${url}`, opts);
    } catch (e) {
      err = e.message;
    }
    return text((err ? `Note: ${err}\n` : "") + (await describe(p)));
  }
);

server.registerTool(
  "read_page",
  {
    description:
      "List the current tab's visible interactive elements with refs (e1, e2, ...) for click/type, plus headings. " +
      "Refs are only valid until the page changes.",
    inputSchema: { limit: z.number().int().optional().describe("Max elements, default 150") },
  },
  async ({ limit }) => {
    const p = await page();
    const s = await p.evaluate(snapshotScript, limit || 150);
    return text(
      `${await describe(p)}\n${s.scroll}\n\nHeadings:\n${s.headings.join("\n") || "(none)"}\n\nElements:\n${s.elements.join("\n") || "(none)"}`
    );
  }
);

server.registerTool(
  "get_text",
  {
    description: "Get the readable text of the current tab (or of one element by CSS selector).",
    inputSchema: { selector: z.string().optional(), max_chars: z.number().int().optional() },
  },
  async ({ selector, max_chars }) => {
    const p = await page();
    const t = await p.evaluate((sel) => {
      const root = sel ? document.querySelector(sel) : document.querySelector("main,article") || document.body;
      return root ? root.innerText : null;
    }, selector || null);
    if (t === null) throw new Error(`Nothing matches ${selector}.`);
    const max = max_chars || 20000;
    return text(`${await describe(p)}\n\n${t.length > max ? t.slice(0, max) + `\n...[cut at ${max} of ${t.length} chars]` : t}`);
  }
);

server.registerTool(
  "screenshot",
  { description: "Screenshot the visible part of the current tab. Pixel coordinates match click's x/y.", inputSchema: {} },
  async () => {
    const p = await page();
    const data = await p.screenshot({ encoding: "base64", type: "png" });
    return { content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: await describe(p) }] };
  }
);

server.registerTool(
  "click",
  {
    description: "Click an element by ref (from read_page) or CSS selector, or click at x/y page-viewport coordinates.",
    inputSchema: {
      ref: z.string().optional(),
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
  },
  async ({ ref, selector, x, y }) => {
    const p = await page();
    const el = x !== undefined && y !== undefined ? null : await element(p, { ref, selector });
    const note = await act(p, () => (el ? el.click() : p.mouse.click(x, y)));
    return text(`Clicked.${note}`);
  }
);

server.registerTool(
  "type",
  {
    description: "Type text into an input by ref or selector (clears it first unless append is true). submit presses Enter.",
    inputSchema: {
      text: z.string(),
      ref: z.string().optional(),
      selector: z.string().optional(),
      append: z.boolean().optional(),
      submit: z.boolean().optional(),
    },
  },
  async ({ text: t, ref, selector, append, submit }) => {
    const p = await page();
    if (ref || selector) {
      const el = await element(p, { ref, selector });
      await el.click();
      if (!append) {
        await el.evaluate((e) => {
          if ("value" in e) e.value = "";
          else if (e.isContentEditable) e.textContent = "";
          e.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
    }
    const note = await act(p, async () => {
      await p.keyboard.type(t);
      if (submit) await p.keyboard.press("Enter");
    });
    return text(`Typed.${note}`);
  }
);

server.registerTool(
  "press_key",
  {
    description: "Press a key or combo in the current tab, e.g. Enter, Escape, Tab, ArrowDown, Control+a.",
    inputSchema: { key: z.string() },
  },
  async ({ key }) => {
    const p = await page();
    const parts = key.split("+");
    const main = parts.pop();
    const note = await act(p, async () => {
      for (const m of parts) await p.keyboard.down(m);
      await p.keyboard.press(main);
      for (const m of parts.reverse()) await p.keyboard.up(m);
    });
    return text(`Pressed ${key}.${note}`);
  }
);

server.registerTool(
  "select_option",
  {
    description: "Choose an option in a <select> by ref or selector, matching option value or visible text.",
    inputSchema: { option: z.string(), ref: z.string().optional(), selector: z.string().optional() },
  },
  async ({ option, ref, selector }) => {
    const p = await page();
    const el = await element(p, { ref, selector });
    const chosen = await el.evaluate((s, want) => {
      const o = [...s.options].find((o) => o.value === want || o.text.trim() === want);
      if (!o) return null;
      s.value = o.value;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return o.text;
    }, option);
    if (chosen === null) throw new Error(`No option "${option}".`);
    return text(`Selected "${chosen}".`);
  }
);

server.registerTool(
  "scroll",
  {
    description: "Scroll the current tab up/down by a number of pixels (default one screen), or scroll an element (ref/selector) into view.",
    inputSchema: {
      direction: z.enum(["up", "down"]).optional(),
      amount: z.number().optional(),
      ref: z.string().optional(),
      selector: z.string().optional(),
    },
  },
  async ({ direction, amount, ref, selector }) => {
    const p = await page();
    if (ref || selector) {
      await (await element(p, { ref, selector })).evaluate((e) => e.scrollIntoView({ block: "center" }));
    } else {
      await p.evaluate(
        (dir, amt) => window.scrollBy(0, (dir === "up" ? -1 : 1) * (amt ?? window.innerHeight * 0.8)),
        direction || "down",
        amount ?? null
      );
    }
    await settle(250);
    return text(await p.evaluate(() => `scrolled ${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)}px`));
  }
);

server.registerTool(
  "wait_for",
  {
    description: "Wait until a CSS selector or some text appears in the current tab.",
    inputSchema: { selector: z.string().optional(), text: z.string().optional(), timeout_ms: z.number().optional() },
  },
  async ({ selector, text: want, timeout_ms }) => {
    const p = await page();
    const timeout = timeout_ms || 10000;
    if (selector) await p.waitForSelector(selector, { timeout });
    else if (want) await p.waitForFunction((t) => document.body && document.body.innerText.includes(t), { timeout }, want);
    else await settle(Math.min(timeout, 5000));
    return text("Ready.");
  }
);

server.registerTool(
  "evaluate",
  {
    description: "Run JavaScript in the current tab and return the result (JSON). The code is an expression or a function body using return.",
    inputSchema: { code: z.string() },
  },
  async ({ code }) => {
    const p = await page();
    const result = await p.evaluate((src) => {
      let v;
      try {
        v = (0, eval)(src);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        v = new Function(src)();
      }
      return Promise.resolve(v).then((r) => {
        try {
          return JSON.stringify(r, null, 2) ?? String(r);
        } catch {
          return String(r);
        }
      });
    }, code);
    return text(result);
  }
);

await server.connect(new StdioServerTransport());

const shutdown = async () => {
  try {
    await browser?.disconnect();
  } catch {}
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
