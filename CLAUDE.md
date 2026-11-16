# Outlook Junk Triage — notes for Claude

A single Violentmonkey userscript that cleans the Outlook.com (personal account) Junk folder.
The owner only changes this repo through Claude, so keep this file current when you learn
something new about Outlook's page.

## Files

| File | Role |
|---|---|
| `junk-triage.user.js` | The whole script. Pure logic at the top (`classify`, `applyMark`, `mergeRules`, `parseDate`, `parseRowText`, `isNewestFirst`), browser code in `init()`. |
| `test.js` | `node test.js` — asserts on the pure functions. No dependencies. |
| `my-rules.json` | Git-ignored. The owner's private rules (their own address in `fakeAddresses`). Never commit it or copy its contents anywhere tracked. |

The file ends with `module.exports` when loaded by Node and `init()` in the browser, so tests
`require` the script directly. Keep new logic in pure functions and test it there.

## Release

1. `node test.js` and `node --check junk-triage.user.js` pass.
2. Bump `@version` (Violentmonkey only updates when it increases).
3. Commit on a branch and open a PR; merging to `main` publishes, because installs auto-update
   from `raw.githubusercontent.com/Filaipus/outlook-junk-triage/main/junk-triage.user.js`.

Commit as the repo-local identity `Filaipus <6901771+Filaipus@users.noreply.github.com>`
(already set in `.git/config`). The global git email is a work address; never use it here.

## How it works

- **Classification** reads each list row's text: display name, `<address>`, subject, date.
  `classify` returns a reason string for clearly fake senders, `null` for real. Order: real
  lists win, then known fakes, then heuristics (no address, no real domain, garbage domain,
  throwaway TLD, random domain, hidden Unicode, scam subjects).
- **Rules** = `DEFAULT_RULES` in the script + the owner's stored rules (`GM_getValue('rules')`),
  combined list-by-list by `mergeRules`. Row buttons call `applyMark`: whole domains for
  companies, single addresses on `SHARED_PROVIDERS` (gmail, hotmail, live …).
- **Since last run**: `GM_getValue('lastRun')` holds the time of the last completed delete (or
  an empty one). The cutoff is the start of that day; no value means the whole folder. A run
  that is stopped or hits a safety stop does not advance it.
- **Delete** targets are decided by `isDeleteTarget` (fake and dated on/after the cutoff day),
  used by both Scan's count and Delete. Delete ticks the targets on screen, re-checks the
  selection, clicks the toolbar Delete, and waits for the rows to disappear. Up to 3 passes catch
  rows the virtualized list skipped; `lastRun` only advances when the last pass deleted nothing.
- **Auto-scan** runs only when a `lastRun` exists, and any real wheel, touch or key event stops
  it. A stopped scan stores no result and does not scroll back.

## Outlook page quirks (each one cost time to discover)

- **Selectors**: rows are `[role="listbox"] [role="option"]`; the scrolling element is
  `[role="listbox"] .customScrollBar`; each row's checkbox is `[role=checkbox]` with
  `aria-checked`; Delete is the `button` whose aria-label or text is exactly `Delete`; the open
  message body is `[aria-label="Message body"]`.
- **Row text**: the sender address line is `<addr>`. Rows with no address show the literal
  `<no sender address>`. Dates are `HH:MM` (today), `Tue 10/20` (this year) or `26/10/14`
  (yy/mm/dd).
- **Virtualized list**: only ~6–20 rows exist in the DOM at a time. Scan by scrolling 80% of a
  screen at a time and de-duplicating rows.
- **Trusted Types**: assigning `innerHTML` throws. Build every element with DOM calls.
- **Body re-render**: Outlook drops foreign nodes from `<body>`. The panel and `<style>` live
  on `<html>` and are re-attached every 700 ms.
- **Hidden tabs**: Outlook stops rendering the list when the tab is in the background
  (`visibilityState === 'hidden'`, 0 rows). Everything waits for the tab to be visible.
- **Selection**: ticking a row's checkbox replaces the selection of the open message (it is
  not added to it). Outlook shows no selection count anywhere readable (the only "selected"
  text is the folder pane), so the delete guard compares ticked rows on screen with the batch's
  targets and never scrolls while anything is ticked.
- **Re-renders after clicks**: clicking a checkbox can re-render the list, so row indices shift.
  Always re-query rows after a click; never reuse an index or element from before it.
- **View ribbon menus** (used by Fix layout): tabs are `[role="tab"]` named Home / View / Help.
  Ribbon buttons are found by `aria-label` (Density, Messages, Layout), because their text also
  contains a hover description. Options are `[role="menuitemcheckbox"]` inside `[role="menu"]`
  and fade in, so poll for them; closed menus stay in the page, so filter with
  `checkVisibility()` (menus are fixed-position, where `offsetParent` is always null). The
  selected option's text starts with a checkmark glyph, so compare letters only. There is no
  "Hide" reading pane anymore: the options are Show on the right / on the bottom / Fill screen /
  Popout only. Rows on screen depend on the window height, density and message preview, not on
  where the reading pane is. The Delete button only exists on the Home ribbon.
- **No zoom tricks**: setting `body.style.zoom` shows more rows but breaks scrolling.
- **Row buttons** label themselves with CSS `::after`, so their text never leaks into
  `innerText` (which the parser reads). Clicks on them are swallowed in the capture phase so
  Outlook doesn't open the message.
- **Junk-folder messages**: links stay disabled until "Show blocked content" is clicked, and
  Outlook hides its own Unsubscribe button for Junk, so unsubscribe links come from the body.
- **Unsubscribe pages** differ per sender (one-click, forms, preference centers, sign-in
  walls), which is why the script only collects links and the owner clicks through them.

## Live testing with Playwright

The owner's Edge is driven through the Playwright MCP extension and is their real browser:
open your own tab, never close or navigate theirs, and bring yours to the front only while a
run needs it. To try a change without installing it, have Python build a runner file that
`page.evaluate`s the script body with stand-ins for `GM_getValue` and `GM_setValue`, then run
it with `browser_run_code_unsafe` and its `filename` option (its `code` cannot `require('fs')`).
Prefer Scan for smoke tests. Delete only what the owner approved, and stand in a recent
`lastRun` value so a test never sweeps the whole folder.

## Privacy

The repo is public. The owner's email address must never appear in tracked files, commit
metadata, test fixtures or reports. Everything else (scam domains and addresses found in their
Junk) may be public.
