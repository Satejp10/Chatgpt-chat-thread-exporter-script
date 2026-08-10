# Project log: ChatGPT chat exporter

Append-only. Newest entries at the bottom. Never edit or delete a past entry;
corrections go in a new entry as `- correction: ...`.
One entry per working session. `/project-status` builds its reports from this file
plus live git facts, so anything not written here is likely to be lost.

Entry format:

## YYYY-MM-DD | session N | <cli | web | desktop>
- did: <what actually changed>
- decided: <decision> because <reason>
- rejected: <alternative> because <reason>
- broke/fixed: <symptom, and resolution if any>
- open: <unresolved question>
- next: <intended next action>

---

## 2026-08-06 | session 0 | chat
- did: project defined in Claude.ai; HANDOFF.md written (HO-chatgpt-exporter-001)
- decided: audit before features, because a security patch after a feature change is harder to isolate
- decided: anchor nav lives in the exported HTML, not the live site, because the exports are what is hard to navigate
- decided: timestamps are captured only when the page renders them, never synthesized
- rejected: full API-first rewrite, because the user judged it over-engineered for the need
- open: does the script still cover platforms other than ChatGPT; which timestamp source exists today
- next: produce the 12-point security and correctness audit, then stop for approval

## 2026-08-06 | session 1 | web
- did: 12-point audit of v3.0 (300 lines), then implemented the approved remediation and the nav rail as v4.0
- did: added `test/` with unit, end-to-end (headless Chromium) and Trusted Types suites, plus a size/runtime measurement script
- found: HANDOFF.md, docs/ref/ screenshots, the live DOM sample, CLAUDE.md and .claude/ were never committed; repo held only the userscript and a stub README
- found: script is ChatGPT-only, so the session-0 open question about Gemini/Grok/Claude coverage is closed — no shared paths to protect
- found: no network calls, no eval, no persistence, no credentials, no auto-update anywhere in v3.0 — clean on the exfiltration axis
- correction to session 0 hypothesis (a): there was no permissive Trusted Types policy. The real problem was the inverse — two static `innerHTML` writes that *throw* under `require-trusted-types-for 'script'`, breaking the export UI entirely. Reproduced in Chromium: v3.0 modal unusable, v4.0 fine.
- correction to the audit's own priority ordering: HTML escaping was flagged in HANDOFF §8 as the top risk and likely broken. It was adequate — message text lands in a text node, where escaping `&`/`<`/`>` is sufficient. The Markdown export was the one with a real delimiter problem.
- confirmed session 0 hypothesis (b): virtualization loss is real. Measured against a synthetic 120-message lazy-loading thread: v3.0 captured 60 of 120 and reported nothing wrong. v4.0 captures 120 of 120.
- decided: capture ends on a stall counter (3 consecutive zero-yield passes at the bottom) rather than a scroll-position delta, because one non-moving scroll step used to end the whole capture — and that is most likely exactly while older turns are loading
- decided: seek to the top in a loop until height and message count stop growing, because a single `scrollTop = 0` only reaches the top of what is currently mounted
- decided: every export carries a `capture: complete | possibly-truncated` flag with reasons, because silent incompleteness is the failure mode that matters for an archive
- decided: replaced `innerText` extraction with a DOM walker emitting Markdown, because `innerText` is layout-aware (drops collapsed content) and discarded every link URL and code fence
- decided: the nav rail *is* the no-JS fallback — one `<nav>` of real anchors, restyled into a rail by a `html.js` class — rather than HANDOFF's separate collapsed anchor list, because two copies cost ~13 KB and gave nothing back
- decided: added a CSP meta tag to the exported HTML (`default-src 'none'`), because it makes exfiltration from an export structurally impossible for ~150 bytes
- decided: committed a test suite despite the plan saying none was proposed, because it caught two real bugs the code review did not
- rejected: the authenticated conversation API as a timestamp source, because it adds a network call to a tool whose whole promise is that it makes none
- broke/fixed: the fixed rail swallowed pointer events across a 40px strip of the export, including its own toggle. Fixed with `pointer-events: none` on the nav, `auto` on the list.
- broke/fixed: rail tooltips were clipped to 40px because `overflow-y: auto` forces `overflow-x: auto`. Fixed by moving to one shared tooltip element outside the scroll container.
- measured: rail costs 27.4 KB on a 300-message export (284.7 KB total), 9.6%, and depends on zero new chatgpt.com selectors
- open: timestamps are still not implemented — blocked on a live DOM sample in docs/ref/ that was never committed
- open: whether chatgpt.com currently enforces Trusted Types in production (the fix is in either way)
- open: real-world verification on a long thread with the script installed; everything here was verified against a synthetic fixture
- next: user installs v4.0 and exercises it on a real long thread; timestamps only after a DOM sample lands

## 2026-08-06 | session 2 | web
- did: PR #1 merged to main as 75f0f9f; generated status report SR-chatgpt-chat-thread-exporter-script-001
- did: re-verified the whole suite from a clean checkout — unit 56/56, e2e 28/28, measure, security grep, node --check, metadata grep
- broke/fixed: test/trusted-types.test.js read its baseline from `git show HEAD:`, so once the v4.0 commit landed it compared the new script against itself and reported both sides clean — a false pass on the session-1 headline finding. Fixed to BASELINE_REF (default 5405be1), matching e2e.test.js, and guarded the click so a script that dies under Trusted Types records the error instead of aborting the run. Finding reproduces: baseline modal unusable with `TypeError: Failed to set the 'innerHTML' property on 'Element'`, current clean.
- decided: any comparison test pins an explicit ref, never HEAD, because HEAD becomes the thing under test the moment the work is committed
- open: everything from session 1 still open — timestamps blocked on a docs/ref/ DOM sample, no real-world run yet, production Trusted Types enforcement unknown
- open: whether test/ stays (it was outside the approved plan) and whether the conventions should move into a CLAUDE.md
- next: deliver report 001 to chat; wait for the user's real-world run before any further code

## 2026-08-09 | session 3 | web
- did: v4.1 — export privacy toggles for the conversation URL and title, plus a tab-visibility warning on the capture loader
- confirmed: user ran v4.0 on a real thread and it worked, closing the session-1 open item on real-world verification
- decided: two toggles, not one. The URL is `chatgpt.com/c/<uuid>` and opaque to anyone not signed into the account; the title is plain English and lands in the *filename*, so it shows in a file manager or an upload preview before the file is opened. A URL toggle alone is an incomplete privacy control.
- decided: withheld means the field is omitted from the file entirely, never blanked and never `null`, because an empty `Source:` still discloses that one existed. Same invariant already applied to timestamps.
- decided: without the title the filename falls back to `chatgpt-export-<date>-<time>`. The time is required, not cosmetic: date alone collides on the second export of the day and reintroduces the P3-c defect v4.0 fixed.
- decided: prefs persist in localStorage, because a privacy control you must re-tick every time is one you will forget. Cost: the README's "no localStorage" guarantee was reworded to "no conversation content; one preferences key". Reworded rather than quietly broken.
- decided: the pref value is parsed as untrusted input (booleans only in and out), because the key shares an origin with chatgpt.com's own scripts and they can write to it
- rejected: GM_setValue, which would keep prefs out of the page's reach but requires changing `@grant none` and moves the whole script into Tampermonkey's sandbox context — a behaviour change across every part of the script for one boolean
- rejected: a rail toggle, because it saves 9.6% of export size, protects nothing, and costs a second export layout for every rail assertion to run against
- rejected: a settings panel. Two checkboxes sit in the export modal, where the choice is made.
- decided: the loader carries a standing "keep this tab visible" warning, and a run that saw `document.hidden` adds that as a reason when the capture comes back incomplete. Advisory only; it never changes what is captured. Browsers throttle background timers and suspend the rendering work ChatGPT's lazy loading depends on.
- broke/fixed: `localStorage` is unavailable on `file://` in Chromium (opaque origin), so the persistence assertions silently could not run against the existing fixture. Added a ~15-line `node:http` static server in e2e.test.js and pointed that one section at `http://127.0.0.1:<port>`.
- measured: userscript 45.3 KB -> 52.4 KB (+7.1 KB, +15.7%). Export size unchanged at 284.7 KB with defaults on; the rail is still 27.4 KB / 9.6%. Tests 56 -> 79 unit assertions and 28 -> 41 e2e.
- open: timestamps still blocked on a live DOM sample in docs/ref/
- open: whether test/ stays, and whether the conventions should move into a CLAUDE.md — asked twice now, still unanswered
- next: user exports once with defaults and once with both boxes unticked, and confirms the second file carries no URL and no title anywhere including the filename

## 2026-08-09 | session 4 | web
- did: v4.2 — removed the per-message Copy button the script injected into chatgpt.com
- found: a real defect no test had caught. The button was `position:absolute; top:5px; right:5px` inside each message. User bubbles have a rounded gutter so it landed in whitespace, but assistant turns run full width, so it sat on top of the first line of text. Present since v3.0; invisible to the suite because the synthetic fixture's messages are narrow. Found by the user from a screenshot of the live site.
- correction to the v4.0 audit: item P2-c treated addCopyButtons purely as a performance problem (the mutation storm) and rated the debounce a fix. The function had a second, visual defect that the audit did not look for, because the audit never rendered the script against a real thread.
- decided: remove rather than fix, because ChatGPT has native copy on both roles and also yields Markdown, so the feature was duplicating the site. Removal also deletes the only place this script wrote to ChatGPT's own elements (`msg.style.position = 'relative'`, needed solely to anchor the button) and turns a refresh from a walk over every message into one querySelector.
- rejected: hover-only reveal plus repositioning, which keeps the DOM mutation and the per-message work to preserve a redundant feature
- did: dropped the now-dead `.custom-copy-btn` selectors from the three extraction paths; `button` already covered them
- did: added two e2e regression guards so this cannot come back silently — no buttons inside `[data-message-author-role]`, and no inline style written onto page messages. The fixture has no buttons of its own, so anything found came from us.
- note: the exported HTML keeps its own copy buttons. Different context: an offline file has no native copy to fall back on.
- measured: userscript 52.4 KB -> 51.0 KB. Export size unchanged. 79 unit assertions, 44 e2e (was 41).
- open: timestamps still blocked on a live DOM sample in docs/ref/
- open: whether test/ stays, and whether the conventions should move into a CLAUDE.md — asked three times now, still unanswered
- next: user confirms on the live site that no Copy buttons appear on messages and the Export Chat button still does

## 2026-08-10 | session 5 | web
- did: PR #4 merged to main as a944265, closing the v4.2 work. No code changed this session.
- did: wrote down the timestamp blocker properly, because the reason it was never built existed only as a one-line `open:` and would not have survived a fresh pickup
- confirmed: still zero per-message timestamp code in the userscript. A grep for `time|timestamp|datetime` returns only `setTimeout` calls, the `<time datetime>` element in `renderHtml` that carries the *export* time, and unrelated comments. The only time in any export is `stats.capturedAt`, which is when the export ran, not when a message was sent.
- found: chatgpt.com does render a per-message time. First hard evidence in this project — a user screenshot showing `Yesterday 8:30 PM` above a user turn. Until now every rung of the timestamp source ladder was a guess with nothing behind it.
- found: the rendered value is *relative* (`Yesterday`), not a date. This is the crux. A relative label cannot be exported as-is: turning it into a date means resolving it against the capture time, which is synthesis, and the never-synthesize invariant forbids that. The usual pattern is an absolute value hiding in a `title` or `datetime` attribute on the same element, which is exactly what a DOM sample would show. Unconfirmed either way.
- found: the label appears to sit above a turn *group*, not on every message, so it may date a block rather than each turn. Unconfirmed.
- decided: the blocker is now two specific artefacts, not the vague "a DOM sample". (1) the `outerHTML` of the `Yesterday 8:30 PM` element, (2) whether hovering it reveals a full-date tooltip. Both are about ten seconds of work on the live page and neither can be obtained from the fixture or from here. `docs/ref/` still does not exist.
- estimated: 1–2 KB of script, a few bytes per message in the export. Explicitly an estimate, not a measurement — it cannot be measured before the markup is known. The durable cost is a new chatgpt.com selector to maintain, and those break on redesign.
- rejected (restated, so it is not re-proposed): the authenticated conversation API as a timestamp source. It is a network call, and "this script never touches the network" is the tool's main promise.
- open: whether test/ stays, and whether the conventions should move into a CLAUDE.md — asked four times now, still unanswered. Stopping the ask; will act only if raised.
- open: user has not yet confirmed v4.2 on the live site (no Copy buttons on messages, Export Chat still bottom-right)
- did: generated status report SR-chatgpt-chat-thread-exporter-script-002, superseding 001. Report 001 was delivered to chat. 002 carries a dedicated §2.8 "Why there are no timestamps" so the reason survives a cold pickup.
- note: the test suite was not re-run this session, at the user's standing instruction that they run tests themselves. Static checks only: node --check, size, metadata block, forbidden-API greps, all clean. Assertion counts in the report are carried forward from session 4 and tagged as such.
- next: nothing in flight. Work resumes when the element markup lands.
