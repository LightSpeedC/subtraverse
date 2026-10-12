/* Subtraverse - サイドバー UI */
"use strict";

const U = SubUtil;
const $ = (id) => document.getElementById(id);

const DEFAULT_OPTIONS = {
  maxDepth: 5,
  maxPages: 300,
  delayMs: 300,
  concurrency: 2,
  includeAssets: false,
  assetsSameOrigin: false,
};

const KIND_LABEL = { page: "ページ", file: "ファイル", asset: "付随" };
const STATUS_LABEL = {
  queued: "待機中",
  fetching: "取得中",
  ok: "",
  error: "エラー",
  skipped: "スキップ",
  canceled: "中断",
};

const items = new Map(); // url -> item
const deselected = new Set(); // ユーザーが外したURL
let state = null;
let scopeTouched = false;
let renderTimer = null;

/* ---------- 入力欄 ---------- */

function readOptions() {
  return {
    maxDepth: Number($("maxDepth").value),
    maxPages: Number($("maxPages").value),
    delayMs: Number($("delayMs").value),
    concurrency: Number($("concurrency").value),
    includeAssets: $("includeAssets").checked,
    assetsSameOrigin: $("assetsSameOrigin").checked,
  };
}

function writeOptions(o) {
  o = Object.assign({}, DEFAULT_OPTIONS, o || {});
  $("maxDepth").value = o.maxDepth;
  $("maxPages").value = o.maxPages;
  $("delayMs").value = o.delayMs;
  $("concurrency").value = o.concurrency;
  $("includeAssets").checked = !!o.includeAssets;
  $("assetsSameOrigin").checked = !!o.assetsSameOrigin;
}

function updateScopeFromStart() {
  if (scopeTouched) return updateScopeHint();
  try {
    $("scope").value = U.deriveScope($("startUrl").value.trim());
  } catch (e) {
    $("scope").value = "";
  }
  updateScopeHint();
}

function updateScopeHint() {
  const hint = $("scopeHint");
  const start = $("startUrl").value.trim();
  const scope = $("scope").value.trim();
  if (start && scope && !start.startsWith(scope)) {
    hint.textContent = "開始URLが取得範囲に含まれていません。範囲は開始URLの前方部分にしてください。";
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

async function useCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0] && tabs[0].url;
  if (url && /^https?:/i.test(url)) {
    $("startUrl").value = url.replace(/#.*$/, "");
    scopeTouched = false;
    updateScopeFromStart();
  } else {
    setStatus("このタブは対象外です(http/https のページで使ってください)。", true);
  }
}

/* ---------- 選択状態 ---------- */

function isSelectable(it) {
  return it.status === "ok";
}

function selectedUrls() {
  const out = [];
  for (const it of items.values()) {
    if (isSelectable(it) && !deselected.has(it.url)) out.push(it.url);
  }
  return out;
}

/* ---------- 表示 ---------- */

function displayPath(it) {
  const scope = (state && state.scope) || "";
  let rest;
  if (scope && it.url.startsWith(scope)) {
    rest = it.url.slice(scope.length);
    if (!rest) rest = "(開始ページ)";
  } else {
    rest = it.url.replace(/^https?:\/\//, "");
  }
  return rest;
}

function visibleItems() {
  const q = $("filter").value.trim().toLowerCase();
  const kind = $("kind").value;
  let list = Array.from(items.values()).filter((it) => {
    if (kind !== "all" && it.kind !== kind) return false;
    if (q && !it.url.toLowerCase().includes(q)) return false;
    return true;
  });
  if ($("sort").value === "path") {
    list = list
      .map((it) => ({ it, key: displayPath(it) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((x) => x.it);
  }
  return list;
}

function renderSoon() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, state && state.status === "running" ? 250 : 80);
}

function buildRow(it) {
  const selectable = isSelectable(it);
  const row = document.createElement("div");
  row.className = "item" + (selectable ? "" : " off");
  row.setAttribute("role", "listitem");
  row.title = it.url + (it.error ? "\n" + it.error : "");
  row.dataset.url = it.url;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.disabled = !selectable;
  cb.checked = selectable && !deselected.has(it.url);
  row.appendChild(cb);

  const body = document.createElement("div");
  const path = document.createElement("div");
  path.className = "path";
  const full = displayPath(it);
  const q = full.indexOf("?");
  const pure = q >= 0 ? full.slice(0, q) : full;
  const cut = pure.lastIndexOf("/", pure.length - 2) + 1;
  const dir = document.createElement("span");
  dir.className = "dir";
  dir.textContent = full.slice(0, cut);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = full.slice(cut);
  path.append(dir, name);

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [KIND_LABEL[it.kind] || it.kind];
  if (it.type && it.type !== "?") parts.push(it.type);
  if (it.status === "ok") parts.push(U.formatSize(it.size));
  meta.append(...parts.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  const st = STATUS_LABEL[it.status];
  if (st) {
    const s = document.createElement("span");
    s.className = "st-" + it.status;
    s.textContent = it.error ? st + "(" + it.error + ")" : st;
    meta.appendChild(s);
  }

  body.append(path, meta);
  row.appendChild(body);
  return row;
}

function render() {
  const list = $("list");
  const vis = visibleItems();
  const frag = document.createDocumentFragment();

  if (!vis.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = items.size
      ? "条件に合うURLがありません。絞り込みを変えてください。"
      : "ここに、取得範囲内で見つかったURLが並びます。";
    frag.appendChild(p);
  } else {
    for (const it of vis) frag.appendChild(buildRow(it));
  }
  list.replaceChildren(frag);
  updateControls();
}

function setStatus(text, isError) {
  const el = $("statusText");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

function updateControls() {
  const st = state || { status: "idle", busy: "", counts: { total: 0, queued: 0, done: 0, errors: 0 } };
  const running = st.status === "running";
  const busy = !!st.busy;
  const sel = selectedUrls();

  $("start").disabled = running || busy;
  $("stop").disabled = !(running || busy);
  $("zip").disabled = running || busy || sel.length === 0;
  $("zip").textContent = sel.length ? "選択 " + sel.length + " 件をZIPで保存" : "選択をZIPで保存";
  $("copy").disabled = sel.length === 0;
  $("saveList").disabled = sel.length === 0;

  const okCount = st.counts.done;
  $("selCount").textContent = okCount ? "選択 " + sel.length + " / " + okCount : "";

  // 状況表示
  const c = st.counts;
  const lines = [];
  if (st.busy === "zip" && st.progress) {
    lines.push(st.progress.label + "… " + st.progress.current + " / " + st.progress.total);
  } else if (running) {
    lines.push("探索中… 取得済み " + c.done + " 件 / 発見 " + c.total + " 件(待機 " + c.queued + ")");
  } else if (st.status === "done") {
    lines.push("探索が完了しました。" + c.done + " 件を取得" + (c.errors ? "、エラー " + c.errors + " 件" : "") + "。");
  } else if (st.status === "stopped") {
    lines.push("停止しました。" + c.done + " 件を取得済みです。");
  } else if (!st.message) {
    lines.push("開始URLを指定して「一覧を取得」を押してください。");
  }
  if (st.truncated) lines.push("最大件数に達したため、これ以上は探索していません。");
  if (st.message) lines.push(st.message);
  const isErr = st.status === "idle" && !!st.message;
  setStatus(lines.join("\n"), isErr);

  const bar = $("bar");
  if (st.busy === "zip" && st.progress) {
    bar.hidden = false;
    bar.max = st.progress.total || 100;
    bar.value = st.progress.current;
  } else if (running && c.total) {
    bar.hidden = false;
    bar.max = c.total;
    bar.value = c.total - c.queued;
  } else {
    bar.hidden = true;
  }
}

/* ---------- 受信 ---------- */

function applyUpdate(msg) {
  state = msg.state;
  if (msg.full) {
    items.clear();
    deselected.clear();
  }
  for (const it of msg.items) items.set(it.url, it);
  renderSoon();
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "update") applyUpdate(msg);
});

/* ---------- 操作 ---------- */

async function startCrawl() {
  const options = readOptions();
  await browser.storage.local.set({ options });
  items.clear();
  deselected.clear();
  await browser.runtime.sendMessage({
    cmd: "start",
    startUrl: $("startUrl").value.trim(),
    scope: $("scope").value.trim(),
    options,
  });
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function saveList() {
  const urls = selectedUrls();
  if (!urls.length) return;
  let host = "list";
  try {
    host = new URL(urls[0]).host.replace(/[^\w.-]/g, "_");
  } catch (e) {
    /* 無視 */
  }
  const blob = new Blob([urls.join("\n") + "\n"], { type: "text/plain" });
  const objUrl = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({
      url: objUrl,
      filename: "subtraverse-urls-" + host + "-" + timestamp() + ".txt",
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  }
}

async function copyList() {
  const urls = selectedUrls();
  if (!urls.length) return;
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    setStatus(urls.length + " 件のURLをクリップボードにコピーしました。", false);
  } catch (e) {
    setStatus("コピーに失敗しました。「URL一覧を保存」を使ってください。", true);
  }
}

function setVisibleSelection(on) {
  for (const it of visibleItems()) {
    if (!isSelectable(it)) continue;
    if (on) deselected.delete(it.url);
    else deselected.add(it.url);
  }
  render();
}

function wire() {
  $("useTab").addEventListener("click", useCurrentTab);
  $("startUrl").addEventListener("input", updateScopeFromStart);
  $("scope").addEventListener("input", () => {
    scopeTouched = $("scope").value.trim() !== "";
    updateScopeHint();
  });
  $("start").addEventListener("click", startCrawl);
  $("stop").addEventListener("click", () => browser.runtime.sendMessage({ cmd: "stop" }));
  $("zip").addEventListener("click", () =>
    browser.runtime.sendMessage({ cmd: "download", urls: selectedUrls() })
  );
  $("copy").addEventListener("click", copyList);
  $("saveList").addEventListener("click", saveList);
  $("selAll").addEventListener("click", () => setVisibleSelection(true));
  $("selNone").addEventListener("click", () => setVisibleSelection(false));
  ["filter", "kind", "sort"].forEach((id) => $(id).addEventListener("input", render));

  $("list").addEventListener("click", (e) => {
    const row = e.target.closest(".item");
    if (!row || row.classList.contains("off")) return;
    const url = row.dataset.url;
    if (deselected.has(url)) deselected.delete(url);
    else deselected.add(url);
    const cb = row.querySelector("input");
    // チェックボックス自身のクリックは、ブラウザが先に切り替え済み
    if (e.target !== cb) cb.checked = !deselected.has(url);
    updateControls();
  });
}

async function init() {
  wire();
  const saved = await browser.storage.local.get("options");
  writeOptions(saved.options);

  let snap = null;
  try {
    snap = await browser.runtime.sendMessage({ cmd: "getState" });
  } catch (e) {
    /* background 起動直後は無視 */
  }

  if (snap && snap.state && snap.state.startUrl) {
    state = snap.state;
    for (const it of snap.items) items.set(it.url, it);
    $("startUrl").value = state.startUrl;
    $("scope").value = state.scope;
    scopeTouched = true;
    writeOptions(state.options);
  } else {
    if (snap) state = snap.state;
    await useCurrentTab().catch(() => {});
  }
  updateScopeHint();
  render();
}

init();
