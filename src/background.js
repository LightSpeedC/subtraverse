/* Subtraverse - background: クロール(範囲限定の幅優先探索)と ZIP 生成 */
"use strict";

const U = SubUtil;

const DEFAULT_OPTIONS = {
  maxDepth: 5,
  maxPages: 300,
  delayMs: 300,
  concurrency: 2,
  includeAssets: false,
  assetsSameOrigin: false,
};

let items = new Map(); // url -> item(UIへ送る軽量情報)
let blobs = new Map(); // url -> Blob(取得済みHTMLのキャッシュ)
let ctx = null; // 実行中クロールの文脈
let state = newState();
let dirty = new Map();
let flushTimer = null;
let zipCancel = false;

function newState() {
  return {
    status: "idle", // idle | running | stopped | done
    busy: "", // "" | "zip"
    message: "",
    startUrl: "",
    scope: "",
    options: Object.assign({}, DEFAULT_OPTIONS),
    truncated: false,
    progress: null, // { label, current, total }
  };
}

/* ---------- UI への通知 ---------- */

function counts() {
  const c = { total: items.size, queued: 0, done: 0, errors: 0 };
  for (const it of items.values()) {
    if (it.status === "queued" || it.status === "fetching") c.queued++;
    else if (it.status === "ok") c.done++;
    else if (it.status === "error") c.errors++;
  }
  return c;
}

function publicState() {
  return Object.assign({}, state, { counts: counts() });
}

function flushNow(full) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const payload = {
    type: "update",
    full: !!full,
    state: publicState(),
    items: full ? Array.from(items.values()) : Array.from(dirty.values()),
  };
  dirty.clear();
  browser.runtime.sendMessage(payload).catch(() => {}); // サイドバーが閉じていても無視
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(() => flushNow(false), 200);
}

function touch(item) {
  dirty.set(item.url, item);
  scheduleFlush();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- クロール ---------- */

function sanitizeOptions(o) {
  const n = (v, def, min, max) => {
    v = Number(v);
    if (!Number.isFinite(v)) v = def;
    return Math.min(max, Math.max(min, Math.round(v)));
  };
  o = o || {};
  return {
    maxDepth: n(o.maxDepth, DEFAULT_OPTIONS.maxDepth, 0, 20),
    maxPages: n(o.maxPages, DEFAULT_OPTIONS.maxPages, 1, 5000),
    delayMs: n(o.delayMs, DEFAULT_OPTIONS.delayMs, 0, 10000),
    concurrency: n(o.concurrency, DEFAULT_OPTIONS.concurrency, 1, 6),
    includeAssets: !!o.includeAssets,
    assetsSameOrigin: !!o.assetsSameOrigin,
  };
}

function failStart(message) {
  state = Object.assign(newState(), { message });
  items = new Map();
  blobs = new Map();
  flushNow(true);
}

async function startCrawl(req) {
  if (state.busy) return;
  stopCrawl();
  const opts = sanitizeOptions(req.options);
  const start = U.normalizeUrl(req.startUrl || "", req.startUrl || "");
  if (!start) return failStart("開始URLが正しくありません(http/https のみ対応)。");

  let scope;
  try {
    scope = req.scope && req.scope.trim() ? req.scope.trim() : U.deriveScope(start);
    new URL(scope);
  } catch (e) {
    return failStart("取得範囲のURLが正しくありません。");
  }
  if (!U.inScope(start, scope)) {
    return failStart("開始URLが取得範囲に含まれていません。範囲は開始URLの前方部分にしてください。");
  }

  items = new Map();
  blobs = new Map();
  dirty.clear();
  state = Object.assign(newState(), {
    status: "running",
    startUrl: start,
    scope,
    options: opts,
  });

  const thisCtx = {
    opts,
    scope,
    origin: new URL(scope).origin,
    queue: [],
    seen: new Set(),
    ac: new AbortController(),
    active: 0,
  };
  ctx = thisCtx;
  enqueue(thisCtx, start, 0, "page", null);
  flushNow(true);

  await runCrawl(thisCtx);
  if (ctx === thisCtx) {
    state.status = thisCtx.ac.signal.aborted ? "stopped" : "done";
    flushNow(false);
  }
}

function stopCrawl() {
  if (ctx && state.status === "running") ctx.ac.abort();
}

function enqueue(c, url, depth, kind, from) {
  if (c.seen.has(url)) return;
  if (items.size >= c.opts.maxPages) {
    state.truncated = true;
    return;
  }
  c.seen.add(url);
  const item = {
    url,
    depth,
    kind, // page | file | asset
    status: "queued", // queued | fetching | ok | error | skipped | canceled
    type: "",
    size: null,
    from,
    finalUrl: null,
    error: "",
  };
  items.set(url, item);
  c.queue.push(url);
  touch(item);
}

function allowed(c, url, kind) {
  if (U.inScope(url, c.scope)) return true;
  return kind === "asset" && c.opts.assetsSameOrigin && U.sameOrigin(url, c.origin);
}

async function runCrawl(c) {
  const signal = c.ac.signal;
  async function worker() {
    while (!signal.aborted) {
      const url = c.queue.shift();
      if (!url) {
        if (c.active === 0) return;
        await sleep(50);
        continue;
      }
      c.active++;
      try {
        await processItem(c, items.get(url));
      } catch (e) {
        const it = items.get(url);
        if (it && it.status === "fetching") {
          it.status = signal.aborted ? "canceled" : "error";
          it.error = String((e && e.message) || e);
          touch(it);
        }
      } finally {
        c.active--;
      }
      if (c.opts.delayMs) await sleep(c.opts.delayMs);
    }
  }
  await Promise.all(Array.from({ length: c.opts.concurrency }, worker));
}

async function cancelBody(res) {
  try {
    if (res.body) await res.body.cancel();
  } catch (e) {
    /* 無視 */
  }
}

async function processItem(c, item) {
  if (!item) return;
  item.status = "fetching";
  touch(item);

  let res;
  try {
    res = await fetch(item.url, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: c.ac.signal,
    });
  } catch (e) {
    item.status = c.ac.signal.aborted ? "canceled" : "error";
    item.error = String((e && e.message) || e);
    touch(item);
    return;
  }

  if (!res.ok) {
    item.status = "error";
    item.error = "HTTP " + res.status;
    await cancelBody(res);
    touch(item);
    return;
  }

  // リダイレクト先が範囲外なら取得しない
  const finalUrl = U.normalizeUrl(res.url, res.url);
  if (finalUrl && finalUrl !== item.url) {
    item.finalUrl = finalUrl;
    if (!allowed(c, finalUrl, item.kind)) {
      item.status = "skipped";
      item.error = "範囲外へリダイレクトされました";
      await cancelBody(res);
      touch(item);
      return;
    }
    if (c.seen.has(finalUrl)) {
      item.status = "skipped";
      item.error = "リダイレクト先は取得済みです";
      await cancelBody(res);
      touch(item);
      return;
    }
    c.seen.add(finalUrl);
  }

  const rawType = res.headers.get("content-type") || "";
  const type = rawType.split(";")[0].trim().toLowerCase();
  item.type = type || "?";

  if (U.isHtmlType(type)) {
    const buf = await res.arrayBuffer();
    item.size = buf.byteLength;
    blobs.set(item.url, new Blob([buf], { type }));
    item.status = "ok";
    touch(item);
    if (item.depth < c.opts.maxDepth) {
      const html = U.decodeBuffer(buf, rawType);
      extractAndEnqueue(c, html, finalUrl || item.url, item);
    }
  } else {
    // HTML 以外は本体を読まず、ヘッダの情報だけを記録する
    const len = res.headers.get("content-length");
    item.size = len ? Number(len) : null;
    if (item.kind === "page") item.kind = "file";
    item.status = "ok";
    await cancelBody(res);
    touch(item);
  }
}

function extractAndEnqueue(c, html, pageUrl, parent) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let base = pageUrl;
  const baseEl = doc.querySelector("base[href]");
  if (baseEl) {
    try {
      base = new URL(baseEl.getAttribute("href"), pageUrl).href;
    } catch (e) {
      /* 無視 */
    }
  }

  const links = new Set();
  const assets = new Set();
  const add = (set, v) => {
    if (!v) return;
    const u = U.normalizeUrl(String(v).trim(), base);
    if (u) set.add(u);
  };

  doc.querySelectorAll("a[href], area[href]").forEach((e) => add(links, e.getAttribute("href")));
  doc.querySelectorAll("iframe[src], frame[src]").forEach((e) => add(links, e.getAttribute("src")));

  if (c.opts.includeAssets) {
    doc
      .querySelectorAll("img[src], script[src], source[src], video[src], audio[src], embed[src]")
      .forEach((e) => add(assets, e.getAttribute("src")));
    doc
      .querySelectorAll("img[srcset], source[srcset]")
      .forEach((e) => U.parseSrcset(e.getAttribute("srcset")).forEach((v) => add(assets, v)));
    doc.querySelectorAll("link[href]").forEach((e) => {
      const rel = (e.getAttribute("rel") || "").toLowerCase();
      if (/\b(stylesheet|icon|apple-touch-icon)\b/.test(rel)) add(assets, e.getAttribute("href"));
    });
  }

  const depth = parent.depth + 1;
  for (const u of links) {
    if (U.inScope(u, c.scope)) enqueue(c, u, depth, "page", parent.url);
  }
  for (const u of assets) {
    if (allowed(c, u, "asset")) enqueue(c, u, depth, "asset", parent.url);
  }
}

/* ---------- ZIP 生成 ---------- */

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

async function buildZip(urls) {
  if (state.busy) return;
  const targets = urls.filter((u) => items.has(u) && items.get(u).status === "ok");
  if (!targets.length) {
    state.message = "保存対象がありません。";
    return flushNow(false);
  }

  zipCancel = false;
  state.busy = "zip";
  state.message = "";
  state.progress = { label: "取得中", current: 0, total: targets.length };
  flushNow(false);

  const zip = new JSZip();
  const used = new Set(["_subtraverse_index.tsv", "_subtraverse_errors.txt"]);
  const index = ["path\turl"];
  const failures = [];
  const delay = state.options.delayMs;

  try {
    for (let i = 0; i < targets.length; i++) {
      if (zipCancel) throw new Error("canceled");
      const url = targets[i];
      const item = items.get(url);
      let blob = blobs.get(url);
      if (!blob) {
        try {
          const res = await fetch(url, { credentials: "include", cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          blob = await res.blob();
        } catch (e) {
          failures.push(url + "\t" + String((e && e.message) || e));
          state.progress.current = i + 1;
          scheduleFlush();
          continue;
        }
        if (delay) await sleep(delay);
      }
      const path = U.uniquePath(U.urlToPath(item.finalUrl || url, item.type), used);
      zip.file(path, blob);
      index.push(path + "\t" + url);
      state.progress.current = i + 1;
      scheduleFlush();
    }

    zip.file("_subtraverse_index.tsv", index.join("\n") + "\n");
    if (failures.length) zip.file("_subtraverse_errors.txt", failures.join("\n") + "\n");

    state.progress = { label: "ZIP を作成中", current: 0, total: 100 };
    flushNow(false);
    const out = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (meta) => {
        state.progress.current = Math.round(meta.percent);
        scheduleFlush();
      }
    );

    const host = new URL(state.scope).host.replace(/[^\w.-]/g, "_");
    const filename = "subtraverse-" + host + "-" + timestamp() + ".zip";
    const objUrl = URL.createObjectURL(out);
    await browser.downloads.download({ url: objUrl, filename, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(objUrl), 5 * 60 * 1000);

    state.message =
      filename + " を保存しました(" + (targets.length - failures.length) + " 件" +
      (failures.length ? "、取得失敗 " + failures.length + " 件" : "") + ")。";
  } catch (e) {
    state.message =
      e && e.message === "canceled" ? "ZIP の作成を中止しました。" : "ZIP の作成に失敗しました: " + ((e && e.message) || e);
  } finally {
    state.busy = "";
    state.progress = null;
    flushNow(false);
  }
}

/* ---------- メッセージ処理 ---------- */

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.cmd) return undefined;
  switch (msg.cmd) {
    case "getState":
      return Promise.resolve({ state: publicState(), items: Array.from(items.values()) });
    case "start":
      startCrawl(msg);
      return Promise.resolve({ ok: true });
    case "stop":
      if (state.busy === "zip") zipCancel = true;
      else stopCrawl();
      return Promise.resolve({ ok: true });
    case "download":
      buildZip(Array.isArray(msg.urls) ? msg.urls : []);
      return Promise.resolve({ ok: true });
    default:
      return undefined;
  }
});

browser.browserAction.onClicked.addListener(() => browser.sidebarAction.toggle());
