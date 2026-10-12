# Subtraverse

English | [日本語](README.jp.md)

A Firefox extension that starts from the page you are viewing, follows links **only under a URL you specify**, builds a list of URLs, and lets you review it before saving the files you pick as a single ZIP.

## Features

- Follows links from a start URL and lists only those that fall inside the scope (URL prefix match)
- Review the list before saving: toggle checkboxes, filter, and sort
- Copy the URL list or save it as a text file
- Saves the selected URLs into a ZIP that keeps the site's path structure (`_subtraverse_index.tsv` maps saved paths to URLs)
- Works on sites you are logged in to, using the browser's login state
- Extracts links from Shift_JIS / EUC-JP pages as well

## Requirements

Firefox 140 or later (desktop).

## Installation

### Temporary install (for testing)

1. Open `about:debugging#/runtime/this-firefox` in the Firefox address bar
2. Click "Load Temporary Add-on"
3. Select `manifest.json` in this folder (or the ZIP / xpi)

The add-on is removed when Firefox restarts.

### Permanent install

- Mozilla signing is required. Submit the add-on to Firefox Add-ons ( https://addons.mozilla.org/developers/ ) as **unlisted** to receive a signed `.xpi` without publishing it.
- On Firefox Developer Edition, Nightly, or ESR, set `xpinstall.signatures.required` to `false` in `about:config` to use it unsigned.
- For distribution inside an organization, deploying the signed `.xpi` through Firefox enterprise policies (`ExtensionSettings`) is the most reliable approach.

## Usage

1. Open a page of the site you want to fetch (e.g. `https://example.com/docs/index.html`)
2. Open the sidebar with the toolbar icon or `Alt+Shift+S`
3. Click "現在のタブ" (Current tab) to fill in the start URL. The scope is filled in automatically with the folder of the start URL (`https://example.com/docs/`)
4. Edit the scope if needed, then click "一覧を取得" (Get list)
5. Review the list and uncheck anything you do not need
6. Click "選択をZIPで保存" (Save selection as ZIP), or copy / save the URL list

The sidebar UI is currently in Japanese.

### How the scope works

Only URLs that **start with** the scope are targeted.

| Start URL | Auto-filled scope | Included (example) | Excluded (example) |
| --- | --- | --- | --- |
| `https://example.com/docs/index.html` | `https://example.com/docs/` | `https://example.com/docs/a/b.html` | `https://example.com/blog/` |
| `https://example.com/docs/` | `https://example.com/docs/` | `https://example.com/docs/x.pdf` | `https://other.example.com/docs/` |

URLs that redirect outside the scope are skipped without being fetched.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Max depth | 5 | How many link hops to follow from the start page |
| Max items | 300 | Upper limit on discovered URLs (up to 5000) |
| Delay | 300 ms | Wait between requests, to limit server load |
| Concurrency | 2 | Number of simultaneous requests |
| Assets | Off | Include images, CSS, and JS |
| Allow same-site assets outside the scope | Off | Include assets located outside the scope, such as under `/static/` |

## Behavior and limitations

- **While building the list, bodies of non-HTML files are not downloaded.** For PDFs and similar files, only the Content-Type and size are recorded; the files are fetched when the ZIP is created. HTML fetched during the crawl is reused for the ZIP.
- **Links rendered by JavaScript are not detected.** Only `<a href>` and similar elements in the fetched HTML are parsed.
- **`url()` references inside CSS are not followed.** Images and fonts referenced only from CSS are not included.
- **Links inside saved pages are not rewritten.** The ZIP keeps the URL path structure, so many relative links still work, but it is not a complete offline mirror.
- URLs ending in `/` are saved as `index.html`, and HTML without an extension gets `.html`. URLs with a query string get `__q` plus a short hash to keep them distinct.
- `robots.txt` is not checked. Review the target site's terms of use and set an appropriate delay.
- Login state inside Firefox container tabs is not carried over (the default container's cookies are used).

## Files

```
manifest.json
background.js          Crawler and ZIP builder
lib/util.js            Shared helpers (URL normalization, path mapping)
lib/jszip.min.js       JSZip 3.10.2
sidebar/               Sidebar UI
icons/icon.svg
```

## License

JSZip is dual-licensed under MIT or GPL-3.0-or-later ( https://github.com/Stuk/jszip ). The bundled `lib/jszip.min.js` has one change: the unused `new Function` fallback in its `setImmediate` shim was removed to satisfy Mozilla's add-on validation.
