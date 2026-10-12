/* Subtraverse - 共通ユーティリティ(ブラウザ/Node 両対応の純粋関数のみ) */
(function (root) {
  "use strict";

  /** href を base で絶対化。http/https 以外は null。フラグメントは除去。 */
  function normalizeUrl(href, base) {
    try {
      const u = new URL(href, base);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.hash = "";
      return u.href;
    } catch (e) {
      return null;
    }
  }

  /** 開始URLから既定の取得範囲(ディレクトリ単位の前方一致プレフィックス)を求める */
  function deriveScope(startUrl) {
    const u = new URL(startUrl);
    const p = u.pathname;
    const dir = p.endsWith("/") ? p : p.slice(0, p.lastIndexOf("/") + 1);
    return u.origin + dir;
  }

  function inScope(url, scope) {
    return url.startsWith(scope);
  }

  function sameOrigin(a, b) {
    try {
      return new URL(a).origin === new URL(b).origin;
    } catch (e) {
      return false;
    }
  }

  /** 短い文字列ハッシュ(衝突回避の接尾辞用) */
  function hash36(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36).slice(0, 6);
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function sanitizeSegment(s) {
    let out = s.replace(/[\\:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");
    if (out.length > 120) {
      const ext = /\.[A-Za-z0-9]{1,8}$/.exec(out);
      out = out.slice(0, 100) + "_" + hash36(out) + (ext ? ext[0] : "");
    }
    return out || "_";
  }

  function isHtmlType(type) {
    return type === "text/html" || type === "application/xhtml+xml";
  }

  /** URL を ZIP 内の相対パス(ホスト名/パス…)に変換 */
  function urlToPath(rawUrl, type) {
    const u = new URL(rawUrl);
    const endsWithSlash = u.pathname.endsWith("/");
    let segs = safeDecode(u.pathname)
      .split("/")
      .filter((s) => s && s !== "." && s !== "..");
    if (endsWithSlash || segs.length === 0) {
      segs.push("index.html");
    } else if (isHtmlType(type) && !/\.[A-Za-z0-9]{1,8}$/.test(segs[segs.length - 1])) {
      segs[segs.length - 1] += ".html";
    }
    segs = segs.map(sanitizeSegment);
    if (u.search) {
      let last = segs.pop();
      const tag = "__q" + hash36(u.search);
      const dot = last.lastIndexOf(".");
      last = dot > 0 ? last.slice(0, dot) + tag + last.slice(dot) : last + tag;
      segs.push(last);
    }
    const host = sanitizeSegment(u.host.replace(":", "_"));
    return [host].concat(segs).join("/");
  }

  /** 大文字小文字を区別しないファイルシステムも考慮して重複を避ける */
  function uniquePath(path, used) {
    let candidate = path;
    let n = 1;
    while (used.has(candidate.toLowerCase())) {
      n++;
      const dot = path.lastIndexOf(".");
      const slash = path.lastIndexOf("/");
      candidate =
        dot > slash + 1
          ? path.slice(0, dot) + "_" + n + path.slice(dot)
          : path + "_" + n;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  /** HTML のバイト列を、Content-Type または <meta charset> に従ってデコード(Shift_JIS/EUC-JP 対応) */
  function decodeBuffer(buf, contentType) {
    let cs = null;
    const m1 = /charset\s*=\s*["']?([\w\-]+)/i.exec(contentType || "");
    if (m1) cs = m1[1];
    if (!cs) {
      const head = new TextDecoder("latin1").decode(
        new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096))
      );
      const m2 = /<meta[^>]+charset\s*=\s*["']?([\w\-]+)/i.exec(head);
      if (m2) cs = m2[1];
    }
    try {
      return new TextDecoder(cs || "utf-8").decode(buf);
    } catch (e) {
      return new TextDecoder("utf-8").decode(buf);
    }
  }

  function parseSrcset(v) {
    return String(v || "")
      .split(",")
      .map((s) => s.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function formatSize(n) {
    if (n == null) return "?";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  const api = {
    normalizeUrl,
    deriveScope,
    inScope,
    sameOrigin,
    hash36,
    sanitizeSegment,
    isHtmlType,
    urlToPath,
    uniquePath,
    decodeBuffer,
    parseSrcset,
    formatSize,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SubUtil = api;
  }
})(typeof self !== "undefined" ? self : this);
