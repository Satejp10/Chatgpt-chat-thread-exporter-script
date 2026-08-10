# Chat thread exporter

A single-file userscript that exports a **ChatGPT** or **Claude** conversation to
a local Markdown or HTML file. It is an archival tool: nothing leaves the
browser.

## Install

Tampermonkey or Violentmonkey, then add
`ChatGPT Thread Exporter (Robust Auto-Scroll).user.js`. There is no build step
and no dependencies. Auto-update is deliberately absent: the file you reviewed
is the file that runs, and it cannot change under you.

**Upgrading from v4.x:** remove the old *ChatGPT Thread Exporter* entry first.
v5.0 is named *Chat Thread Exporter*, so your script manager treats it as a new
script rather than an update, and leaving both installed puts two Export buttons
on every ChatGPT page.

An **Export Chat** button appears bottom-right on `chatgpt.com` and `claude.ai`.

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

Both sites virtualise long threads: turns that are off screen do not exist in
the DOM, and older history is fetched lazily as you scroll up. The exporter
scrolls the thread to force everything to load, then walks it top to bottom.

Every export states whether that worked. The HTML header and the Markdown
frontmatter carry `capture: complete` or `capture: possibly-truncated` with the
reason. If it is not complete, the exporter says so before you close the dialog.
An archive that quietly drops messages is worse than no archive.

**Scroll the thread yourself first.** Go to the very top, wait for the older
messages to appear, then come back down. The exporter does this on its own, but
a thread the browser has already rendered captures faster and is far less likely
to come back short. The export dialog says so before you pick a format.

**Keep the tab visible while it runs.** Browsers throttle timers in background
tabs and suspend the rendering work that lazy loading depends on, so a capture
with the tab hidden can stall and come back short. Nothing is lost silently if
it does: the export is flagged `possibly-truncated`, and a run that detected the
tab going hidden says so in the reason.

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

## Timestamps

Whatever the page renders is captured. Nothing else is.

Both sites show a date and time at the start of a thread, and separators between
later turn groups. Those are read as written and travel into the export: a
`started_label` in the Markdown frontmatter, a *Thread starts* line in the HTML
header, and a small time beside each turn that had one.

They are **not resolved**. A label reading `Yesterday 8:30 PM` is exported as
that string, because turning it into a date means computing it against the
capture time, and a computed timestamp is one the page never showed. The export
time sits directly above it as an absolute ISO value, so anchoring a relative
label is a subtraction you can do yourself and verify.

Where the page also carries a machine-readable value, a `<time datetime>` or a
`title` attribute holding a full date, that is copied alongside as
`started_exact` and as the hover title on each turn. Copied, not parsed.

A turn with no rendered label gets no timestamp at all, and never inherits one
from the turn above it. "The page showed nothing here" and "the page showed the
same thing here" are different claims, and only one of them is true.

## Artifacts and embedded views

Claude artifacts and inline visualisations are **not exported** in v5.0. They are
not dropped in silence either. Each one leaves a marker where it stood:

```
> [artifact not exported: Sales dashboard]
```

and the count lands in the header (`artifacts_not_exported: 3` in the Markdown
frontmatter, a banner in the HTML). An export with no marker and no count really
did contain no artifacts. Text, links and code blocks around them are unaffected.

This is separate from the capture flag on purpose. A truncated capture means the
exporter does not know what it missed. A marked artifact means it knows exactly
what it missed and where.

## Site support

| | Turn detection | Per-message ids | Artifacts |
|---|---|---|---|
| ChatGPT | `data-message-author-role` | yes | n/a |
| Claude | class and `data-testid` candidates, first match wins | no, position-keyed | marked, not exported |

ChatGPT tags every turn with an attribute, so one selector covers it. Claude has
no such attribute and its class names have changed more than once, so the script
carries a list of candidate layouts and picks the first that matches the live
page. If none match, the export refuses and names the layout it tried, rather
than producing an empty file:

> No messages were found on this page. Tried the "testid" layout for Claude.

That message is the thing to report if Claude changes its markup. Fixing it is a
one-line addition to the `layouts` list at the top of the script.

Export preferences are stored per origin, so ticking a box on `chatgpt.com` does
not change what happens on `claude.ai`.

## Tests

See [`test/README.md`](test/README.md). The userscript stays dependency-free;
the tests are separate tooling.

The suite predates v5.0 and still asserts the old `chatgpt-export` filename and
`generator: ChatGPT Thread Exporter` line, so parts of it fail against the
current script. There is also no Claude fixture yet. Both are outstanding.
