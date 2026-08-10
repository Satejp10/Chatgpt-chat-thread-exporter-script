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

## 2026-08-10 | session 6 | web
- did: v5.0 — added claude.ai support behind a site-adapter layer, and artifact/embedded-view markers
- note: renumbered from session 5 to 6 on merge. Session 5 ran in parallel on main (report 002, the timestamp write-up) and claimed the slot first; this session branched from a944265 and never saw it.
- decided: a site contributes exactly four things (find message elements, tell whose turn it is, name the conversation, name the file). Scroller, walker, both renderers, rail and modal were already site-agnostic and were not touched, so the port is additive rather than a rewrite.
- found: ChatGPT's coupling was thinner than expected — `MSG_SELECTOR`, `data-message-author-role`, `data-message-id`, the title suffix and the filename prefix. Nothing else in 1132 lines knew what site it was on.
- decided: Claude gets a *list* of candidate layouts (`testid`, `msg-class`, `legacy`) resolved against the live page, because it has no role attribute and its class names have changed more than once. First layout matching both roles wins and is cached; a layout matching one role is used but not cached, since a new chat legitimately shows one role.
- decided: when nothing matches, the export refuses and names the layout it tried, because a silently empty file is the failure mode this project exists to avoid. That message is the bug report.
- decided: dedup nested matches by walking each node's ancestors against a Set, not pairwise `contains`. On Claude an assistant container and its inner prose block can both match; pairwise is O(n²) and `collect()` runs once per scroll step, so at 300 messages that was ~10M DOM calls per capture.
- decided: artifacts and inline visualizations are NOT exported in v5.0, but each leaves `> [artifact not exported: <name>]` in place and increments `artifacts_not_exported` in the header. Same doctrine as the capture flag: the file states what is missing.
- decided: the artifact and iframe checks run before SKIP_TAGS and before the `role=button` rule, because an artifact cell is usually a button and an embedded view is an iframe — both were already being swallowed without trace.
- decided: artifact count is reported separately from the capture flag, because they mean different things. Truncated = the exporter does not know what it missed. Marked artifact = it knows exactly what it missed and where.
- decided: `@name` changed to "Chat Thread Exporter", accepting that script managers treat it as a new script rather than an update. Same forking hazard the `@namespace` invariant warns about. Taken deliberately because the old name is now wrong on half the supported sites; mitigated with an explicit "remove the old entry first" note in the README install section.
- broke invariant, deliberately and at the user's request: `@match` gained `https://claude.ai/*`. The invariant says widening scope is a security regression and must be escalated, not just done. Escalated in chat, user asked for it in as many words. No other `@match` line touched.
- rejected: exporting artifact source into the file, because it is a v5.1 decision that needs the CSP question answered first (the export is `default-src 'none'`; embedding runnable code contradicts that, shipping source as a code block does not)
- rejected: clicking each artifact card open to read the side panel, because it is a second scroll-and-settle problem layered on the one already solved, and it belongs with the rest of artifact capture
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. Re-grepped after the change; all clean. `node --check` passes.
- open: every Claude selector is a guess. No live DOM sample was available, so the candidate-layout mechanism is the hedge — it fails loudly and is a one-line fix when it is wrong.
- open: test/ predates v5.0 and asserts the old filename prefix and generator string, so parts of it fail against the current script. No Claude fixture exists.
- open: timestamps still blocked on a live DOM sample in docs/ref/
- next: user installs v5.0, removes the v4.2 entry, and reports which Claude layout resolves (or the refusal message if none does)

## 2026-08-10 | session 7 | web
- did: v5.1 — timestamps, finally, and a pre-scroll instruction in the export modal
- found: the blocker dissolved. The user reported that a session date and time is rendered on the page and visible while scrolling, which is exactly the evidence report 002 said was missing. No `docs/ref/` sample was needed in the end: the answer was "capture what is visible", not "identify the one true selector".
- decided: transcribe, never resolve. A relative label (`Yesterday 8:30 PM`) is exported as that literal string. Turning it into a date means computing it against the capture time, and a computed timestamp is one the page never showed — that is the never-synthesize invariant, and it holds. The absolute export time sits directly above it in both formats, so a reader can anchor it and check the arithmetic.
- decided: detect labels structurally, not by class name. A `<time>` element wins outright; otherwise an element whose *entire* trimmed text matches a date/time pattern and is under 48 chars. This has no chatgpt.com or claude.ai selectors in it at all, so unlike the timestamp designs considered in sessions 1-5 it cannot break on a renderer change. That is why it could be built without a DOM sample.
- decided: search a bounded neighbourhood before each turn (6 previous siblings across 4 ancestor levels) and stop dead on hitting the previous turn. Unbounded search eventually finds an unrelated date elsewhere on the page and staples it to the wrong message, which is worse than reporting nothing.
- decided: a turn with no rendered label gets no timestamp and never inherits the one above it, because "the page showed nothing here" and "the page showed the same thing here" are different claims. Same invariant as a withheld URL being omitted rather than blanked.
- decided: `exact` (from `<time datetime>` or a `title` attribute) is copied, never parsed. If the attribute is malformed that is the page's statement, and rewriting it would be synthesis by another route.
- decided: the label is read on first sight of a turn, inside `collect()`, because the neighbourhood is still mounted then. After the scroller moves past, virtualization may have removed it.
- did: added a standing pre-scroll instruction to the export modal (scroll to top, let history load, come back down) plus the tab-visibility warning, which until now only appeared in the loader after the run had already started. Advisory only; it changes nothing about what is captured.
- note: claude.ai support was already merged as v5.0 in PR #6, so this session sits on top of it rather than before it. The user's ordering request was based on v5.0 not yet being in.
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. Re-grepped; clean. `node --check` passes.
- open: the label patterns are unverified against either live site. They are structural rather than selector-based, so the failure mode is a missed label (no timestamp written) rather than a wrong one, but a real run is what confirms the shape of what chatgpt.com actually renders.
- open: test/ still predates v5.0, no Claude fixture, no coverage of any of this
- open: artifact contents and inline visualizations remain unexported, marked only
- next: user exports a thread that shows a session time and confirms the label lands in the frontmatter and beside the turn
