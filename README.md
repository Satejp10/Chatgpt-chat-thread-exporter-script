# ChatGPT chat thread exporter

A single-file userscript that exports a ChatGPT conversation to a local Markdown
or HTML file. It is an archival tool: nothing leaves the browser.

## Install

Tampermonkey or Violentmonkey, then add
`ChatGPT Thread Exporter (Robust Auto-Scroll).user.js`. There is no build step
and no dependencies. Auto-update is deliberately absent — the file you reviewed
is the file that runs, and it cannot change under you.

An **Export Chat** button appears bottom-right on `chatgpt.com`.

## What it guarantees

- **No network access.** No `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket,
  or image-ping anywhere in the script, and `@grant none` with no `@connect`.
- **No stored conversation content.** No `GM_setValue`, no cookies, and nothing
  from your conversations in `localStorage`. The single stored value is your
  export preference (two booleans, under `cge-export-prefs`). The download you
  ask for is the only place content goes.
- **No remote or dynamic code.** No `eval`, no `Function()`, no injected script
  tags, no `@downloadURL`/`@updateURL`.
- **Exports are inert.** All message content is HTML-escaped before it reaches
  the file, only `https:` and `mailto:` links survive as links, and the exported
  page carries `Content-Security-Policy: default-src 'none'` so it cannot reach
  the network even if something did slip through.

## Capture completeness

ChatGPT virtualises long threads: turns that are off screen do not exist in the
DOM, and older history is fetched lazily as you scroll up. The exporter scrolls
the thread to force everything to load, then walks it top to bottom.

Every export states whether that worked. The HTML header and the Markdown
frontmatter carry `capture: complete` or `capture: possibly-truncated` with the
reason. If it is not complete, the exporter says so before you close the dialog.
An archive that quietly drops messages is worse than no archive.

**Keep the tab visible while it runs.** Browsers throttle timers in background
tabs and suspend the rendering work that ChatGPT's lazy loading depends on, so
a capture with the tab hidden can stall and come back short. Nothing is lost
silently if it does: the export is flagged `possibly-truncated`, and a run that
detected the tab going hidden says so in the reason.

## What goes in the file

Two identifying fields are optional, ticked by default, in the export dialog:

- **The conversation URL.** `chatgpt.com/c/<id>`, opaque to anyone who is not
  signed into your account, but still an identifier.
- **The conversation title.** This one also lands in the **filename**, so it is
  visible in a file manager or an upload preview before anyone opens the file.
  It usually leaks more than the URL does.

Unticked means the field is left out of the file entirely, not blanked and not
written as `null`. Without the title the filename falls back to
`chatgpt-export-<date>-<time>`, so same-day exports still do not collide. The
choice is remembered between exports.

## The export

**HTML** — self-contained, opens offline. A navigation rail on the right edge
has one tick per prompt; hover for a preview, click to jump, `j`/`k` (or
`Alt`+arrows) to step between prompts, and a toggle to hide it. With JavaScript
disabled the rail degrades to a plain list of anchor links at the top and
everything stays readable.

**Markdown** — YAML frontmatter with the export time, message count and capture
flag, plus the title and source URL when those are included. Turns are numbered
(`## [7] User`) so a parser can check the sequence runs 1..N against the
declared count.

Both preserve link URLs, fenced code blocks with their language, lists, tables
and blockquotes. Images and attachments are not exported, by design.

## Tests

See [`test/README.md`](test/README.md). The userscript stays dependency-free;
the tests are separate tooling.
