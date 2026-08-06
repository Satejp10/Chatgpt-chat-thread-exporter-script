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
- **No stored conversation content.** No `localStorage`, `GM_setValue`, or
  cookies. The download you ask for is the only output.
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

## The export

**HTML** — self-contained, opens offline. A navigation rail on the right edge
has one tick per prompt; hover for a preview, click to jump, `j`/`k` (or
`Alt`+arrows) to step between prompts, and a toggle to hide it. With JavaScript
disabled the rail degrades to a plain list of anchor links at the top and
everything stays readable.

**Markdown** — YAML frontmatter with the title, source URL, export time, message
count and capture flag. Turns are numbered (`## [7] User`) so a parser can check
the sequence runs 1..N against the declared count.

Both preserve link URLs, fenced code blocks with their language, lists, tables
and blockquotes. Images and attachments are not exported, by design.

## Tests

See [`test/README.md`](test/README.md). The userscript stays dependency-free;
the tests are separate tooling.
