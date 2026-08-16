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

## 2026-08-10 | session 8 | web
- did: v5.2 — fixed the duplicate-turn bug found by the first real claude.ai export, stopped the dialog reappearing after download, excluded the coding surfaces
- found: FIRST REAL RUN OF ANY VERSION AGAINST A LIVE SITE. Everything before this was verified against a synthetic fixture. It found a bug in one export.
- found: a 14-message Claude thread exported as 29. Analysed the user's file: 29 articles, 14 unique by role plus full text, one turn duplicated five times, another four times. The capture flag said `complete`, which it was — the extra turns were not missing content, they were the same content collected repeatedly.
- root cause: `domPath`, the positional dedup key used when a site has no message id. It is an index chain among siblings, and virtualization renumbers siblings constantly. A remounted turn lands at a different index and reads as a brand new message. ChatGPT never exposed this because `data-message-id` always won; Claude has no id, so every turn took the positional path.
- correction to v5.0: the session-6 entry claimed Claude "always takes the positional path" as a neutral fact. It was the bug, written down as a design note and not recognised. The nesting-dedup work in that session addressed a different duplicate source and gave false confidence that duplicates were handled.
- decided: identity is now the site's message id where one exists, otherwise role plus the *full* text. Full, never a prefix — a 50-char prefix was tried in v4.0 and merged genuinely distinct short turns. Verified against the user's export: role + full text yields exactly 14 from 29.
- decided: a WeakSet of nodes sits in front of the content key. It stops re-collecting a node still on screen, which is most passes, and it means the content key is only computed for genuinely new nodes. Net cost is lower than the old `domPath` call per node per pass.
- decided: every merge is counted and reported (`merged_duplicates`), because content identity can over-merge two byte-identical turns and the project's rule is that nothing is dropped silently. The residual risk is now visible rather than eliminated.
- broke/fixed: the export dialog reappeared after a successful download. Not a new bug in the usual sense — v5.1 deliberately held it open to report skipped artifacts, and since the overlay is hidden during the run, that read to the user as the popup opening a second time. Reverted: a complete capture closes the dialog regardless of artifacts. The file's own header already reports them prominently.
- did: excluded `chatgpt.com/codex` and `claude.ai/code` via `@exclude`, backed by a runtime `location.pathname` check in `refresh()` that also removes an already-injected button. `@exclude` alone is insufficient: both sites are single-page apps, so navigating from a chat to the coding surface never reloads the document.
- found: the Claude artifact selectors did NOT match. All three placeholders in the user's export came from the generic `IFRAME` branch, labelled "embedded view". The hedge worked; the guesses did not. Real selectors still unknown.
- found: no timestamp was captured on claude.ai. Either the page renders none on that view or the patterns missed it. The user's original observation may have been about chatgpt.com. Unresolved, and it fails silently by design.
- note: the exported artifact placeholders are preceded by the literal text "MindMap MindMap" from the tool-use header and card label. Cosmetic, left alone.
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. Re-grepped; clean. `node --check` passes.
- open: Claude artifact selectors are still unverified guesses; only the iframe fallback works
- open: whether chatgpt.com renders a session timestamp the patterns can see
- open: test/ still predates v5.0 and would have caught none of this, since the fixture does not remount turns
- next: user re-exports the same Claude thread and confirms 14 messages, no repeats, dialog closes on its own

## 2026-08-10 | session 9 | web
- did: v5.3 — per-role message counts in both exports, and hardened the coding-surface exclusion
- did: cross-checked the user's second live export against the v5.2 fix. 18 articles, 18 unique by role plus full text, zero duplicates, 9 user and 9 assistant, header count and rail agreeing. The v5.2 dedup fix is confirmed working on real data.
- note: `merged_duplicates` was absent from that export, so no content-key merge occurred. The WeakSet alone handled it. The fix is proven; the content-key fallback beneath it is still unexercised on a live thread.
- decided: report counts per role, because the whole reason the v5.2 bug was caught is that the user knew how many prompts they had sent and the total did not match. A bare total is not checkable; a split against your own prompt count is.
- decided: nested `messages_by_role` rather than a key per role, so system and tool turns report without inventing frontmatter keys, and the HTML header carries the same split inline.
- did: added the exclusion guard to `addExportButton()` itself, on top of the one in `refresh()`. It is the only function that injects the button, so the guard cannot be bypassed by a future call site forgetting to check.
- did: broadened the `@exclude` globs with explicit `/*` variants, since managers differ on whether a trailing `*` crosses a path separator.
- found (unresolved): user reports the button still appears on `chatgpt.com/codex/cloud`. The code is correct — `/^\/codex(?:\/|$)/i` matches `/codex/cloud`, and the metadata excludes it. Leading hypothesis is that the v4.2 entry is still installed alongside v5.x: it is ChatGPT-only with no excludes, which fits the symptom exactly, since `claude.ai/code` was not reported as broken and v4.2 does not match that host at all. Second hypothesis is a tab predating the update. Both are install-state, not code.
- correction to the session-6 decision on renaming `@name`: it was taken knowingly, with a README note as the mitigation. A README note is not a mitigation for a duplicate install, because the person who needs it has already installed. The cost of that rename is now showing up as a bug report against code that is correct.
- found: a real defect, NOT fixed this session, flagged for the user. An image-only turn yields no text, is counted into `emptySkipped`, generates a reason string — and then the reason is discarded, because reasons only render when `!complete` and `emptySkipped` does not affect `complete`. The turn is dropped and the file still says `capture: complete`. Visible in the user's export as two consecutive assistant turns where the prompt between them is missing. Present since v4.0. This is precisely the silent-omission failure the project exists to prevent.
- found: the same export marked zero artifacts where the previous one marked three. The MindMap connector was still rendering ("Connecting to MindMap..."), so no iframe existed to mark. The exporter recorded what was on screen, which is correct, but the practical result is that the mindmaps left no trace.
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. Re-grepped; clean. `node --check` passes.
- open: silent empty-turn drops. Ranked first on the unfixed list.
- open: Claude artifact selectors still unverified; only the iframe fallback has ever matched
- open: whether chatgpt.com renders a session timestamp the patterns can see
- open: test/ still predates v5.0
- next: user confirms whether a stale v4.2 entry is installed, and re-exports to see the role split

## 2026-08-10 | session 10 | web
- resolved: the button on `chatgpt.com/codex/cloud` was a stale v4.2 entry installed alongside v5.x, exactly as hypothesised in session 9. User deleted it and reinstalled; the coding surfaces are now clean. No code was at fault — v5.2's exclusion worked from the start.
- confirms the session-9 correction: renaming `@name` in v5.0 forked the install, and the README note was never going to reach someone who had already installed. The cost landed as a bug report against correct code, and cost a round trip to diagnose.
- decided: do not rename `@name` again. If a future version needs a different identity, the release notes and the repo README both have to carry a delete-the-old-entry step at the top, not buried in an install section.
- note: v5.3's exclusion hardening (guard on `addExportButton()`, wider `@exclude` globs) stands anyway. It was defence in depth against a cause that turned out to be elsewhere, and it costs nothing.
- next: unfixed list, in order — silent empty-turn drops (real data loss, since v4.0), Claude artifact selectors, artifacts leaving no trace when the connector is mid-render, ChatGPT timestamps, stale test/

## 2026-08-10 | session 11 | web
- did: v5.4 — fixed the silent empty-turn drop, the top item on the unfixed list, and made the on-page UI usable on a phone.
- root cause of the drop was one line: `IMG` sat in `SKIP_TAGS`, so a prompt that was nothing but a screenshot produced no text, and a turn with no text is discarded. `emptySkipped` counted it, built a reason string, and then the string was never rendered, because reasons only print when `!complete` and `emptySkipped` was not part of `complete`. The message vanished and the file said `capture: complete`.
- decided: rescue the turn rather than only report it. An image now leaves `> [image not exported: name]` in place, the same treatment artifacts already get. That gives the turn text, so it survives extraction and gets a real content-based dedup key instead of nothing.
- decided: name images from `alt`, then `title`, then the file name in `src`. Blob and data URLs get no name at all rather than a base64 wall. Anything 48px or smaller, `aria-hidden`, or `role=presentation` is treated as an avatar or icon and skipped, or every turn would carry placeholder noise.
- decided: do NOT emit a placeholder for turns that are still empty after that. A placeholder needs a dedup key, and the only key available on a site with no message ids is the text — which is what an empty turn does not have. That is the exact shape of the v5.2 bug, where an unstable key turned 14 messages into 29. Counting them is honest; inventing keys for them is how the duplicate bug comes back.
- did: `complete` now requires `!emptySkipped`, and the count is written to both formats (`turns_dropped_empty`, plus a banner). A file that dropped a turn can no longer claim it is complete. This is the invariant the project is built on and it was being violated by an accounting gap, not by a missing feature.
- did: mobile placement. Both sites fill the bottom of a narrow viewport with the composer, attach and mic, and the button sat on top of them. Below 820px it docks to the middle of the right edge, which is the one strip neither site anchors a control to: header owns the top, composer owns the bottom, middle is scrolling transcript.
- decided: compute the placement in JS off `innerWidth` rather than write a media query. The style is an inline attribute, and a `<style>` element would depend on the page's CSP allowing inline stylesheets — not a bet worth making on these two hosts. Rotation and the on-screen keyboard are handled by listening for resize and orientationchange.
- did: dialog and progress box sized with `min(px, calc(100vw - 32px))` and `box-sizing:border-box`, so neither is clipped on a 360px screen.
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. `node --check` passes. `@name` and `@namespace` untouched, per the session-10 rule.
- open: Claude artifact selectors still unverified; only the iframe fallback has ever matched
- open: artifacts leave no trace when the connector is mid-render
- open: whether chatgpt.com renders a session timestamp the patterns can see
- open: test/ still predates v5.0, and would not have caught this — no fixture has an image-only turn
- next: user tests v5.4 on a phone and on an image-heavy thread. If an image-only prompt now appears in the export, the oldest bug in the tool is closed.

## 2026-08-10 | session 12 | web
- did: v5.5 — fixed the timestamp patterns, which have never matched anything on a live page.
- root cause was one token. `AT`, the join between a date word and a clock, was `(?:\s*(?:at|,)\s*)?`: the whole group optional, but `at` or `,` mandatory inside it. Against `Today 7:58 AM` the group matches empty, `CLOCK` then faces a leading space, `\d{1,2}` cannot consume it, and the match dies. Only the bare halves and the literal-`at` form ever passed. Date-space-clock, which is the form both sites actually render, was the one shape excluded.
- the code comment in that very section cited "Yesterday 8:30 PM" as the motivating example, and that string fails the patterns it sits above. The example was written from the page and the regex was written separately; nobody checked one against the other.
- fix: `(?:\s*(?:at|,)?\s*)?` — optional INSIDE the separator rather than an alternative to it. Verified 11 accept cases and 7 reject cases, the rejects being prose that opens with a date word ("Today I finished the migration", "May 10 people join the call", "Sat down and wrote 500 words"). Anchors, `MAX_LABEL_LEN` and the whole-text-must-match rule in `readTimeLabel()` are untouched, so the widening admits exactly date + whitespace + clock and nothing longer.
- diagnosed from the user's own export: 4 messages, no `started_label`, no *Thread starts* line, no per-turn times, while the page visibly showed `Today 7:58 AM`. The export was the evidence; no DOM sample was needed.
- note: a second blocker may sit behind this one and cannot be proven without markup. `findTimeFor()` only inspects previous siblings across 8 ancestor levels and stops at the previous turn, so a label rendered INSIDE a turn container is invisible to it. The next export distinguishes the two: `started_label` present but per-turn times absent means the walk is the remaining problem.
- context: user ran a third-party audit of the repo. It is accurate on architecture but quotes v5.3 (`complete` without `!emptySkipped`, `IMG` in `SKIP_TAGS`), both changed in v5.4 hours earlier. Its P0 "separate scroll completeness from message completeness" is now partly done. Its remaining P0 items — canonical message identity, ordering reconciliation, Claude fixtures — are real and unaddressed.
- note: no network calls, no `innerHTML`, no eval, no auto-update, no credentials. `node --check` passes. `@name` and `@namespace` untouched.
- open: whether per-turn timestamps are reachable by the sibling walk
- open: Claude artifact selectors still unverified; only the iframe fallback has ever matched
- open: artifacts leave no trace when the connector is mid-render
- open: test/ predates v5.0, and has no timestamp fixture — this bug was a pure-function failure a single unit test would have caught
- next: user exports a thread showing `Today <clock>` and reports whether the header label, the per-turn times, or neither appears

## 2026-08-10 | session 13 | web
- did: added a `## Releases` section to the README with a one-click download link, and pointed the Install section at it. README only; the script is untouched and stays at v5.5.
- context: there was no releases section and nothing to link to. `git tag -l`, `list_tags` and `list_releases` were all empty — the repo has never been tagged or released, so every reference to "the current version" was a moving pointer at `main`.
- decided: pin the link to a commit id, not to `main`. A raw URL on `main` changes every time `main` changes, which contradicts the promise the README already makes: the file you reviewed is the file that runs, and it cannot change under you.
- decided: no release asset either. An uploaded copy of the userscript is a second source of truth that can drift from the file in the repo. One file, one copy.
- tried and failed: `git tag -a v5.5 && git push origin v5.5` returns HTTP 403. The session's git proxy allows pushes to the designated branch only, so tags cannot be created from here. Fell back to the full commit sha, which is equally immutable and needs no push. A `v5.5` tag would only make the URL prettier; the user can create one from the GitHub UI and the link can be shortened later.
- note: this adds no auto-update. `@downloadURL` and `@updateURL` stay out of the script. The link is a thing a human clicks once; the installed copy still never phones home, and the Releases section says so in as many words so the link is not mistaken for an update channel.
- verified: the encoded URL returns HTTP 200 and line 4 of what it serves is `// @version      5.5`. The filename has spaces and parentheses, so `%20`, `%28` and `%29` are required or the markdown link breaks at the first `)`.
- open: no GitHub Release entry exists; creating one is a web-UI action, and no `create_release` tool is available in this session
- open: every version bump now needs the README link updated to the new commit. That is the cost of pinning, and it is the intended cost.
- open: everything from session 12 stands — per-turn timestamp reachability, Claude artifact selectors, artifacts mid-render, stale test/

## 2026-08-11 | session 14 | web
- did: v5.6 — taught the date recogniser the `Wed, Jul 29 at 8:24 AM` form, which is what chatgpt.com actually renders at the top of a thread.
- root cause: a gap in the pattern list, not the DOM. Pattern 2 accepted a weekday alone (`Monday 9:15 AM`), pattern 3 accepted a month-day alone (`Jul 29 at 8:24 AM`), and nothing accepted a weekday followed by a month-day. The one form the site shows was the one form with no pattern.
- second time the same block has shipped a comment whose own example the code beneath it rejects. v5.5 was `Yesterday 8:30 PM` above the `AT` token; this one is `Wednesday, September 10, 2026 at 11:45 PM` above `MAX_LABEL_LEN`. Both now pass. The lesson is not "write better comments", it is that this block has no test and every check of it has been manual.
- fix: `DOW = '(?:' + WEEKDAYS + '\s*,?\s*)?'`, an optional weekday prefix, and patterns 3 and 4 merged into one so the prefix applies to month-first and day-first without two copies drifting apart. Patterns 1, 2, 5, 6, 7 untouched. `AT`, `MAX_LABEL_LEN`, the anchors, `readTimeLabel()` and `findTimeFor()` all untouched.
- verified: 28 cases, 18 accept and 10 reject, all passing. Rejects include `Wed, Jul 29 at 8:24 AM and then everything broke`, which is the widening risk in its most direct form and is caught by the closing anchor. `node --check` passes.
- v5.5 neither caused this nor helped it. Two independent gaps in one list, found in consecutive sessions from two different user exports.
- decided against: the user first asked for an active-date model where every message after a separator inherits its label. Declined and the user agreed. `Wed, Jul 29 at 8:24 AM` carries a clock, so stamping it on the fourth turn asserts a time the page never showed. That is the "never synthesize" invariant, and it also contradicted the user's own "missing metadata should remain missing" line in the same brief.
- deferred: emitting date separators as their own ordered entries between messages. That is the honest way to show grouping, and it needs `collect()` to walk the container in document order rather than iterating message nodes. Separate work.
- note: the recogniser is site-agnostic, so claude.ai gets the same widening at no cost. Whether claude.ai renders this form is untested.
- open: the DOM half is still unproven. Nothing has ever reached `findTimeFor()` with an accepted label, so the sibling walk has not been tested even once. The next export decides it: header label plus per-turn times means done, header only means the walk cannot reach mid-thread separators, neither means the walk is the primary blocker.
- open: README download link is pinned to a commit and now points at v5.5. Updated in a follow-up commit that references this one, since a commit cannot contain its own sha.
- open: Claude artifact selectors still unverified; artifacts leave no trace mid-render; test/ predates v5.0 and would have caught both timestamp bugs with one table-driven unit test

## 2026-08-10 | session 15 | web
- confirmed: user ran v5.6 on the live site and reported the timestamps working. That closes the session-14 open item on the first of its three outcomes: header label AND per-turn times. The sibling walk in `findTimeFor()` does reach the separator, so no `outerHTML` sample is needed and the DOM half is no longer unproven.
- resolved: the timestamp feature is done. It was written in v5.1 and did not work at all until v5.6, across two independent pattern bugs found in consecutive sessions. Nobody noticed for five versions because every field is suppressed when falsy, so a recogniser that matches nothing produces an export that looks exactly like a thread with no dates on it.
- did: generated status report SR-chatgpt-chat-thread-exporter-script-003, superseding 002. No code changed this session.
- note: the gap between 002 and 003 is the largest in the project. 002 was written at 11 commits and v4.2, ChatGPT-only, and its §2.8 was entirely about why timestamps could not be built. 003 covers 23 commits, v4.2 to v5.6, claude.ai support and four bug fixes found from live exports. Section 2 was rewritten rather than amended, and the memory block names the 002 facts it retires so the chat side does not keep the old ones alongside the new.
- recorded as a dead end, because it is a reasoning pattern and not just a fact: five sessions were blocked waiting for a live DOM sample that was never required. The feature needed structural detection, which cares about no markup at all. The general form is that when a feature is blocked on someone else's markup, the first question is whether it can be written to not care about markup.
- note: report 002's delivery to chat was never recorded either way, so 003 declares it unknown and is written to stand alone.
- note: the test suite was not run, at the user's standing instruction that they run tests themselves. Static checks only: `node --check` passes, size 1771 lines / 83696 bytes, forbidden-API grep returns one hit and it is the design-constraint comment on line 27, `innerHTML` two hits both comments, `localStorage` four hits all in loadPrefs/savePrefs. Metadata clean: `@namespace` unchanged, `@grant none`, no `@downloadURL`/`@updateURL`.
- open: `test/` is now the largest piece of debt in the project. It predates v5.0, `e2e.test.js:118` still asserts the pre-v5.0 `chatgpt-export-` filename prefix, and it has missed four consecutive real bugs. Asked five times whether it stays; still unanswered. Report 003 recommends repairing it, starting with a table-driven unit test on `looksLikeTimeLabel()`.
- open: Claude artifact selectors still unverified; artifacts leave no trace mid-render; no git tag or GitHub Release for any version; no CLAUDE.md
- next: user's call. Nothing in flight, and the user has paused.

## 2026-08-12 | session 16 | web
- did: orientation-only pass. Read the repo, the full log and the state of the tree; no code, README or test change. Written down because a session that produces no diff still burns the context it built, and the next pickup would otherwise re-read all of it.
- verified against the tree, not from the log: `node --check` passes; 1771 lines / 83696 bytes; the forbidden-API grep (`fetch(|XMLHttpRequest|sendBeacon|WebSocket|eval(|new Function`) returns only the design-constraint comment on line 27; `innerHTML` two hits, both comments (lines 33, 1466); `localStorage` four hits, all in the pref block (464, 482, 489, 499). Metadata: `@version 5.6`, `@grant none`, `@namespace` unchanged, no `@downloadURL`/`@updateURL`. Working tree clean at 7236d71.
- confirmed: the session-14 open item on the README download link is closed. e62b706 repointed it at 6be8b12, which is the v5.6 commit and the current head of the script file, so the pinned link and `main` agree today.
- confirmed: there is no build. No `.github/`, no CI, no package manifest at the repo root, no tags and no releases. `test/package.json` is the only manifest and it is test-only tooling. "Build logs" for this project means this file and `.claude/context/reports/`, and that is by design — the userscript is the artifact, and it is served as source.
- note: the four fixes since v5.3 (v5.4 empty-turn drop, v5.5 `AT` token, v5.6 weekday prefix, plus v5.2's dedup key) were all found from a user's live export, none from `test/`. That is the same finding as sessions 11, 12 and 14 and it has now been recorded four times without action, which is itself the signal: the test debt is not going to be closed by noting it again.
- open: unchanged from session 15 — `test/` predates v5.0 (`e2e.test.js:118` still asserts the `chatgpt-export-` prefix); Claude artifact selectors unverified; artifacts leave no trace mid-render; no tag or Release for any version; no CLAUDE.md.
- next: user's call, still. If it is mine to pick: the table-driven unit test on `looksLikeTimeLabel()` that report 003 recommends, since it is the one piece of debt with two proven bugs behind it and it needs no live DOM.

## 2026-08-12 | session 17 | web
- did: repaired `test/`, which was not stale as five sessions of this log recorded, but dead. It has run zero assertions against v5.x.
- root cause, unit half: v5.0 added site adapters and the IIFE body now runs `const SITE = pickSite()` at top level, reading `location.hostname`. `harness.js` evaluates that body in Node, so `require('./harness.js')` threw `ReferenceError: location is not defined` and the suite died on import. Fixed with a minimal `location`/`document`/`window` stub installed before evaluation, plus a `load(hostname)` factory so a test can hold both adapters at once.
- root cause, e2e half: the fixture loads over `file://`, where `location.hostname` is `''`, so `pickSite()` returns null, the button is never added, and `page.click('.export-chat-btn')` times out before the first assertion. Fixed by serving the fixture from the existing `serveTestDir()` helper and launching Chromium with `--host-resolver-rules=MAP chatgpt.com 127.0.0.1:<port>,MAP claude.ai 127.0.0.1:<port>`, so the page origin really is `http://chatgpt.com`. That also removes the reason the prefs section needed its own `127.0.0.1` server.
- correction to sessions 11, 12, 14, 15 and 16: every one of them recorded the test suite as stale — passing but asserting pre-v5.0 strings — and named `e2e.test.js:118` as evidence. That was wrong twice over. The suite was not passing, and line 118 is not stale: `chatgpt-export-` is still `SITES[0].slug`. Nothing in `test/` asserts `generator: ChatGPT Thread Exporter` either. The README carried both false claims and has been corrected.
- the misdiagnosis is the finding, not the bug. Five sessions logged "stale tests, repair someday" and deferred it, when the true state was "no automated coverage exists". Four consecutive bugs — v5.2 dedup, v5.4 empty-turn drop, v5.5 `AT`, v5.6 weekday — were all found by the user from live exports, and the log read that as tests being weak rather than absent. A suite nobody runs degrades from unknown to broken in silence, exactly as an unexecuted timestamp recogniser did.
- did: table-driven tests for `looksLikeTimeLabel()`, 27 rows, each v5.5 and v5.6 regression case named as the version it broke in, plus `flatten()` whitespace handling, a pin on `MAX_LABEL_LEN` and a cross-site check. Both shipped timestamp bugs were pure-function failures reachable with no DOM, no browser and no live page.
- noted, no change: a bare `Monday` or `Today` is accepted as a label, because `CLOCK` is optional in patterns 1 and 2. Correct for a separator that renders no clock, and bounded by `findTimeFor()` stopping at the previous turn, so a one-word sibling reading "Monday" is the only way it misfires. Recorded rather than fixed; narrowing it would reject the real no-clock separators.
- verified before the standing rule below took effect: `unit.test.js` runs 79 assertions, 0 failures, with the harness fix alone. The e2e origin change and the 27-row table are `node --check` clean but have not been executed.
- standing rule, new this session: Claude does not run the test suite. The user runs it, being faster and cheaper and letting them review the output. Consequence to plan around: any test Claude writes ships unverified, so new coverage is deferred rather than guessed at. The Claude fixture is the case in point — see below.
- deferred: a `claude.ai` e2e fixture. It is the largest real coverage gap — Claude selectors, artifact markers and image-only turns have never been exercised — and it needs a write-run-fix loop that the rule above puts on the user's side. Better deferred than shipped broken.
- open: unchanged otherwise — Claude artifact selectors unverified, artifacts leave no trace mid-render, no tag or Release for any version, no CLAUDE.md.
- next: user runs `cd test && npm install && npm test` and reports. Fix whatever it names, then the Claude fixture.
- did: added `CLAUDE.md`, closing a long-standing open item. It carries the no-tests rule first, because a rule that lives only in a log entry is a rule the next session may not read. Also carries the userscript's invariants and the do-not-rename-`@name` rule from session 10.

## 2026-08-12 | session 18 | web
- did: v5.7 — the last two or three turns of a thread were missing from exports that called themselves `capture: complete`. User confirmed the symptom on a live thread; a third-party review (GLM) found the code path independently.
- root cause: nothing is collected before phase A. The capture records the user's scroll position, then immediately scrolls to the top to force the lazy history to load, which unmounts whatever was at the bottom. The descent is expected to pick those turns back up, and it gives them three 220ms passes at the bottom before giving up. When the site takes longer than that to remount them, they are absent from `messages` AND from `emptySkipped` — never in the DOM, so never counted as dropped — and `complete` is still true. Fourth instance of the same shape as v5.2, v5.4 and v5.5/v5.6: a turn leaves without leaving a trace.
- fix: phase C, a tail settle. Re-assert the bottom and keep collecting until 4 consecutive passes come back empty, 450ms apart, up to 24 attempts. Runs out of attempts with turns still arriving and `complete` is now false with a named reason.
- decided AGAINST the fix as proposed, which was a one-line `collect()` before phase A. `messages` is append-ordered and there is no sort anywhere in the file, so collecting at the user's starting position — normally the bottom — would have written the last turns of the conversation at the TOP of the export, numbered [1] and [2]. It would also have re-seen those turns on the descent as remounted nodes and counted 2-5 phantom `merged_duplicates` on every export. The same idea belongs at the END of the capture, where an append lands in the right place.
- also rejected from that review: the proposed invariant "record every key `collect()` sees and assert it is still in `messages` at the end". It is vacuous. Nothing is ever removed from `messages`, so every key seen is already there. The bug is turns never seen at all, and no audit of what you saw can find what you never saw. Detecting it properly needs an external count — the site's own, or an ordinal — which neither site gives us.
- corrected in that review: it stated the e2e suite asserts 120 messages and passes. The suite was not running at all, which session 17 fixed hours earlier. Its point about the fixture stands and is sharper than it knew: `test/fixture.html` only prepends, never unmounts, so no test can currently reproduce this class of bug at all.
- did: `tail_recovered` in the frontmatter and a line in the HTML header, written only when the pass actually saved something. A non-zero value is direct evidence the export would have been short before v5.7.
- note: the cost is up to ~1.8s added to every capture (4 quiet passes at 450ms), and more when the tail is slow. Accepted. The alternative is a file that lies about being complete.
- note: no network calls, no `innerHTML`, no eval, no auto-update. `node --check` passes. `@name` and `@namespace` untouched.
- open: the virtualising fixture — one that unmounts turns as they leave the viewport — is now the single highest-value piece of test work. It would fail against v5.6 and pass against v5.7, which is the first time this project would have a test that proves a fix rather than a test that agrees with it.
- open: README download link still points at the v5.6 commit; updated in a follow-up commit, since a commit cannot contain its own sha.
- next: user installs v5.7 and re-exports the thread that lost its tail. If the last turns are present, and `tail_recovered` shows a number, the fix is confirmed from the same evidence the bug came from.

## 2026-08-13 | session 19 | web
- did: v5.8 — found and fixed the root cause the whole v5.x series had been circling: turns dropped from the bottom, and mid-thread on longer threads. User reported it still failing after v5.7, on threads as short as 6 messages, and still failing when they manually pre-scrolled the entire thread before running the capture.
- root cause, and it is one line, not a timing constant: `collect()` did `seenNodes.add(msg)` BEFORE calling `extractContent(msg)`. A virtualised turn's container mounts a beat before its text paints, so the first pass over a turn scrolling into view reads empty, marks the node permanently seen, counts it into `emptySkipped`, and never looks again — even though the text appears milliseconds later on the same node. Every version from v3.0 to v5.7 had this ordering. It is deterministic, which is why it hit 6-message threads that have no lazy-loading to blame, and why pre-scrolling did nothing: pre-scrolling loads history into the SPA's state but the DOM still only holds a window, so the capture's own descent still re-mounts turns and still caught them mid-render.
- reframed the diagnosis mid-session on the user's two facts. Fresh read had led with the scroll-race (the log's whole framing since v5.2); "fails on 6 messages" and "fails pre-scrolled" ruled the race out as the primary cause and pointed straight at a deterministic read defect. The race is real but secondary — it only changes how often the deterministic defect fires.
- fix 1 (the core): do not mark a node seen until `extractContent` actually returns text. An empty read parks the node in a `pendingEmpty` set and leaves it collectable; a later pass captures it once it paints. This alone stops the drops.
- fix 2 (honesty): `emptySkipped` is now reconciled once at the very end — a parked node still on the page AND still yielding no text is a real blank and counts; one that unmounted without ever yielding text makes no claim (it was recaptured under its content key, or it left the run). The end-of-capture check reads live text, so a turn that filled in is never miscounted. This kills the false `emptySkipped` inflation the old code produced and keeps the `complete` flag trustworthy.
- fix 3 (belt and suspenders, the "middle recovery" mirror of v5.7's tail settle): phase C runs up to 3 extra top-to-bottom sweeps, breaking the instant a whole sweep adds nothing new. Recovers a turn that scrolled out of view in the window before its text rendered, which fix 1 cannot reach once the node has unmounted. Descent was factored into a `descend()` closure so B and C share it. Phase D is the old tail settle, unchanged.
- decided: always run at least one recovery sweep rather than gate it on a drop signal, because we have no external count to detect a drop against (same wall the session-18 review hit). On a short thread the first sweep adds 0 and stops at once. Cost: one extra full scroll on healthy threads, more only when it is actually saving turns. Accepted — a silent short export is the failure this tool exists to prevent.
- rejected: reading ChatGPT's in-page conversation JSON to bypass scrolling entirely. Higher ceiling but it risks a network fetch (breaks the tool's core no-network promise) and Claude has no equivalent. Held as the escalation if v5.8 is not enough; not needed unless proven so.
- note: no network calls, no `innerHTML`, no eval, no auto-update. `node --check` passes. Forbidden-API grep clean (only the design-constraint comments). `@name` and `@namespace` untouched.
- note: not test-verified. Per the standing rule Claude does not run the suite; and the existing fixture cannot reproduce this class at all — `test/fixture.html` only prepends, never unmounts, so nothing here is covered by a test that runs green. The diagnostic evidence to confirm from a real run: a broken v5.7 export's header — a non-zero `turns_dropped_empty` is the fingerprint of this bug, and v5.8 should show it drop to 0 with the missing turns present.
- open: the virtualising fixture (unmounts turns as they leave the viewport) is still the single highest-value test. It is now the ONLY way to prove fix 1 in CI rather than from a user export. Deferred to the user's write-run-fix loop per the no-tests rule.
- open: README download link points at the v5.7 commit; updated in a follow-up commit, since a commit cannot contain its own sha.
- next: user installs v5.8 and re-exports the short thread that was losing its tail. If every turn is present and `turns_dropped_empty` is absent, the oldest bug in the tool is closed.

## 2026-08-13 | session 20 | web
- did: v5.8 merged to main as 31b9b96 via PR #19. No code changed this session.
- did: added a "How to report to the user" section to `CLAUDE.md`, at the user's instruction. They are a product executive with limited time: reports carry state, blocker, next step, and explicit asks only. No file names, function names, line numbers, version history or fix reasoning in chat. Detail goes to `LOG.md` and the PR body, which is what they are for.
- did: hardened the no-tests rule in the same file. It was already there; the user restated it unprompted, which means the existing wording was not doing its job. Now says all testing is the user's without exception, and that Claude never reports a change as verified or working — only as built and ready to test.
- decided: put both in `CLAUDE.md` rather than answer in chat, because a preference stated in one session is invisible to the next. The no-tests rule needed session 17 to write it down and still had to be restated; a communication rule would have decayed the same way.
- note: the user restating a rule already in `CLAUDE.md` is the signal worth keeping from this session. Check whether a rule is already written before assuming it is new, and if it is, the fix is stronger wording, not a second copy.
- open: v5.8 is unconfirmed. It is merged and installable but no live export has been run against it, so the capture bug is fixed in intent only. Everything else from session 19 stands — no virtualising fixture, Claude artifact selectors unverified, no tag or Release.
- next: user installs v5.8 and re-exports the 6-message thread that was failing. Nothing else is in flight.

## 2026-08-16 | session 21 | web
- result: v5.8 FAILED on a live export. User tested and reports no change from v5.7 — messages still missing. Recorded at the user's request; no code changed this session.
- the session-19 diagnosis is therefore wrong, or incomplete in a way that matters. The `seenNodes.add` ordering defect was real and the fix for it is sound on its own terms, but it was not the cause of what the user is seeing, because correcting it changed nothing. Do not build on that diagnosis again without new evidence.
- what this rules out, and it is worth stating plainly so the next session does not re-walk it: the drop is not the empty-container read (v5.8), not the tail settle (v5.7), not the dedup key (v5.2), not `IMG` in SKIP_TAGS (v5.4), and not the timestamp patterns (v5.5/v5.6). Five fixes, five theories, none of them it. Every one was reasoned from the code and from an export; none was reasoned from the live DOM at the moment a message goes missing.
- the pattern across sessions 18, 19 and 21 is the finding. Each session read the code, formed a plausible mechanism, shipped it, and the bug survived. That is the signature of diagnosing without instrumentation: the code offers many plausible mechanisms and no way to choose between them. The next attempt should produce evidence first — what the page actually contains at capture time versus what lands in the file — rather than another mechanism.
- correction to session 19: it claimed "fails on 6 messages" and "fails pre-scrolled" ruled the scroll-race out and pointed at a deterministic read defect. The first half stands, the second does not follow. Those two facts rule out lazy-loading as the cause but they do not identify the read ordering as it, and v5.8 is the proof.
- note: `capture: complete` is now known to be unreliable in the field. The user's exports are short while the file reports itself complete, which means the completeness accounting is missing the same turns the capture is. Whatever the real cause is, it makes a turn invisible to `messages`, to `emptySkipped` and to `pendingEmpty` alike.
- open: the capture bug is unresolved and is the only thing that matters in this project right now.
- next: user has a different strategy and is bringing it. Waiting on it before any further code.
