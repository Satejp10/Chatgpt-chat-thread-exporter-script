# Tests

Test-only tooling. The userscript itself keeps its constraints: single file, no
dependencies, no build step. Nothing in this directory ships with it.

```bash
cd test
npm install          # playwright-core only
npm test             # unit + end-to-end + Trusted Types
npm run measure      # export size and render-time numbers
```

Chromium is located automatically (Playwright's browser dir, then the usual
system paths). Override with `CHROMIUM_PATH=/path/to/chrome`.

## What each file covers

| File | Covers |
|---|---|
| `unit.test.js` | HTML escaping against XSS payloads, URL scheme policy, code-fence handling, filename sanitising, renderer output |
| `e2e.test.js` | Real capture run against a synthetic lazy-loading thread; the same run with the URL and title withheld; then the exported file opened from disk: no network, no script execution, rail behaviour, keyboard nav, tooltip, toggle persistence, and the no-JavaScript fallback. Finally the export preferences over an http origin, since `localStorage` does not work on `file://` |
| `trusted-types.test.js` | Whether the in-page UI survives a page enforcing `require-trusted-types-for 'script'` |
| `measure.js` | Export size, the nav rail's share of it, and render time on a 300-message thread |
| `fixture.html` | Synthetic chat page: virtualised scroll container, lazy-prepended history, and a tall sidebar that a naive scroller search would pick by mistake |

`e2e.test.js` also runs the pre-audit v3.0 script from git as a baseline to show
the capture fix is real (it captured 60 of 120 messages; the current version
captures 120). Set `BASELINE_REF` to compare against a different commit; if the
ref cannot be resolved the comparison is skipped and the rest still runs.

## Not covered here

Anything requiring the real chatgpt.com DOM: selector drift, ChatGPT's actual
virtualisation behaviour, and whether the site enforces Trusted Types in
production. Those need a manual pass in the browser with the script installed.
