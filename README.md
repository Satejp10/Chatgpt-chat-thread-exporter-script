# Chat thread exporter

A single-file userscript that exports a **ChatGPT** or **Claude** conversation to
a local Markdown or HTML file. It is an archival tool: nothing leaves the
browser.

## Install

Tampermonkey or Violentmonkey, then use the download link under
[Releases](#releases), or copy
`ChatGPT Thread Exporter (Robust Auto-Scroll).user.js` out of this repo by hand.
There is no build step and no dependencies. Auto-update is deliberately absent:
the file you reviewed is the file that runs, and it cannot change under you.

**Upgrading from v4.x:** remove the old *ChatGPT Thread Exporter* entry first.
v5.0 is named *Chat Thread Exporter*, so your script manager treats it as a new
script rather than an update, and leaving both installed puts two Export buttons
on every ChatGPT page.

An **Export Chat** button appears bottom-right on `chatgpt.com` and `claude.ai`.

Not on the coding surfaces: `chatgpt.com/codex` and `claude.ai/code` are
excluded, both in the metadata and again at runtime, because both sites are
single-page apps and navigating there from a chat does not reload the document.

## Releases

**[Download v5.6](https://raw.githubusercontent.com/Satejp10/Chatgpt-chat-thread-exporter-script/6be8b12216516c6eb9a4b2b4d26b7791acaadd65/ChatGPT%20Thread%20Exporter%20%28Robust%20Auto-Scroll%29.user.js)**

Open that with Tampermonkey or Violentmonkey installed and the script manager
shows you its install prompt with the full source in it. Nothing installs until
you say yes.

The link is pinned to a single commit, so the file behind it cannot change after
you have read it. There is still no auto-update, by design: a new version means
coming back here and clicking again. That is the same reason `@downloadURL` and
`@updateURL` are absent from the script itself.

Any other version is the same URL with a different commit id in it. The
[history of the script file](https://github.com/Satejp10/Chatgpt-chat-thread-exporter-script/commits/main/ChatGPT%20Thread%20Exporter%20%28Robust%20Auto-Scroll%29.user.js)
lists them, and each version bump is its own commit.

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
flag, plus the title and source URL when those are included. The count is also
broken down by role, so a total that looks wrong can be checked against the
number of prompts you actually sent:

```yaml
messages: 18
messages_by_role:
  user: 9
  assistant: 9
```

The HTML header carries the same split inline: `18 messages (9 user, 9 assistant)`. Turns are numbered
(`## [7] User`) so a parser can check the sequence runs 1..N against the
declared count.

Both preserve link URLs, fenced code blocks with their language, lists, tables
and blockquotes. Image and attachment *contents* are not exported, by design;
each one leaves a marker in place (see below).

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

## Artifacts, images and embedded views

Claude artifacts, inline visualisations and images are **not exported**. They are
not dropped in silence either. Each one leaves a marker where it stood:

```
> [artifact not exported: Sales dashboard]
> [image not exported: screenshot-2026-08-10.png]
```

and the count lands in the header (`artifacts_not_exported: 3` in the Markdown
frontmatter, a banner in the HTML). An export with no marker and no count really
did contain none. Text, links and code blocks around them are unaffected.

Images are named from `alt`, then `title`, then the file name in the `src`. Blob
and data URLs give no name, so the marker carries none rather than a wall of
base64. Anything the page declares as 48px or smaller, or hides from screen
readers, is treated as an avatar or icon and left out.

This is separate from the capture flag on purpose. A truncated capture means the
exporter does not know what it missed. A marked artifact means it knows exactly
what it missed and where.

## Dropped turns

A turn that yields no text at all is not exported, because there is nothing to
export. Before v5.4 that was silent, and it lost real messages: a prompt that was
nothing but a screenshot had all of its content skipped, so the turn came out
empty, got discarded, and the file still said `capture: complete`.

Two things changed. Images now leave a marker, so an image-only turn has text and
survives. Anything still empty is counted as `turns_dropped_empty` in the header,
and the capture is flagged `possibly-truncated` — a file that dropped a turn can
no longer call itself complete.

## Duplicate turns

Turn identity comes from the site's own message id where there is one. ChatGPT
provides `data-message-id`; Claude does not, so identity there is the role plus
the **full** text of the turn.

That matters because both sites remount turns while you scroll. Keying on the
turn's position in the DOM, which is what v5.0 and v5.1 did, breaks under
exactly that: the same turn comes back at a different index and reads as new.
A real 14-message Claude thread exported as 29, one turn appearing five times.

Full text, never a prefix. A 50-character prefix was tried in v4.0 and merged
genuinely distinct short turns. The remaining risk runs the other way: two
turns with byte-identical text collapse into one. So every merge is counted and
the count is written into the export (`merged_duplicates` in the frontmatter, a
line in the HTML header). If that number looks wrong, it is visible.

## Site support

| | Turn detection | Per-message ids | Artifacts |
|---|---|---|---|
| ChatGPT | `data-message-author-role` | yes | n/a |
| Claude | class and `data-testid` candidates, first match wins | no, text-keyed | marked, not exported |

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

## Mobile browsers

Works in any mobile browser that runs a userscript manager, with one difference:
the button docks to the middle of the right edge instead of the bottom right.
Both sites fill the bottom of a narrow viewport with the composer, its attach
button and its mic, and the export button used to sit on top of them.

The switch happens at 820px of viewport width and follows rotation and the
on-screen keyboard, so a narrow desktop window gets the mobile placement too. The
dialog and the progress box are sized against the viewport as well, so neither is
clipped on a small screen.

Scrolling a long thread on a phone is slower and more likely to stall than on a
desktop. The advice at the top of the dialog matters more here: scroll the thread
top to bottom yourself first.

## Tests

See [`test/README.md`](test/README.md). The userscript stays dependency-free;
the tests are separate tooling.

The suite stopped running against v5.0 and nobody noticed until v5.6. It was
not asserting the wrong things, which is what this section used to say; it was
not reaching its assertions at all. The unit half threw at import, because v5.0
resolves a site adapter from `location.hostname` at load and the Node harness
had no `location`. The end-to-end half loaded its fixture over `file://`, where
the hostname is empty, so the script correctly declined to add its button and
every capture check timed out waiting for it.

Both are fixed: the harness stubs the environment it needs, and the fixture is
served under the real hostname so the page origin is one the script recognises.
The timestamp recogniser, which shipped broken twice, now has a table of the
labels both sites actually render.

There is still no Claude fixture, so `claude.ai` selectors, artifact markers and
image-only turns have no automated coverage. That is the largest remaining gap.
