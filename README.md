# Outlook Junk Triage

A [Violentmonkey](https://violentmonkey.github.io/) userscript for the Outlook.com Junk folder.
It sorts conversations into "clearly fake" and "real sender", saves a report you can review,
and moves the clearly fake ones received since the last run to Deleted Items, so the real mail
left in Junk is easy to read through.

## Install

With Violentmonkey installed, open
<https://raw.githubusercontent.com/Filaipus/outlook-junk-triage/main/junk-triage.user.js>
and click **Confirm installation**. Violentmonkey checks that URL for new versions.

Then open <https://outlook.live.com/mail/junkemail>. A **Junk Triage** panel appears in the
bottom-right corner.

To have the script and your rules on every computer, turn on **Violentmonkey → Settings →
Sync** (OneDrive, Dropbox, Google Drive or WebDAV) with the same account on each one.

## Use

When you open Junk, the script scans the mail received since the last run and shows the result
in the panel title, for example "Junk Triage — 23 fake since Mon Nov 16".

In the message list:

- Clearly fake conversations are tinted red, with the reason next to them.
- Hover a row for **✗ fake** and **✓ real** buttons. One click adds that sender to your rules
  (the whole domain for companies, just the address on gmail, hotmail and other shared
  providers) and re-sorts the list.

| Button | What it does |
|---|---|
| **Scan** | Scrolls the whole Junk folder and shows counts: fake (and how many arrived since the last run), real senders, and why each fake was flagged. Changes nothing. |
| **Delete fakes** | Asks for confirmation, then moves the clearly fake conversations received since the last run to Deleted Items. It makes extra passes to catch rows it skipped or mail that arrived mid-run. |
| **Unsubscribe links** | Opens one message from each real sender, collects its unsubscribe link, and lists the senders as links you can click through. Opening a message marks it read. |
| **Save report** | Downloads the last scan as JSON: every fake with its reason, real senders grouped by domain, and any unsubscribe links collected. |
| **Rules** | Edit your rules as JSON (see below). Clear the box to remove your rules. |
| **Stop** | Stops a scan, deletion or link collection after the current step. |

Keep the Outlook tab in front while it runs: Outlook stops drawing the message list in
background tabs, so the script pauses until the tab is visible again. For faster deletes, set
Outlook's **View → Layout → Reading pane** to **Hide** and **Density** to **Compact**: more
rows on screen means more deleted per click.

If Outlook isn't sorting Junk newest first, **Delete fakes** refuses to run, because the "since
last run" cutoff depends on that order. If the script can't find the message list or the
Delete button, it says so instead of doing nothing.

To turn off the automatic scan, add `"autoScan": false` to your rules.

## What counts as clearly fake

- No sender address at all.
- A sender domain that is random characters, has junk glued on (`riviera.comq3dh6…`), or has no
  real domain.
- A throwaway domain ending (`.sbs`, `.online`, `.shop` and similar).
- Hidden Unicode characters used to disguise a brand name.
- The "your phone number change is pending" style account-takeover subjects.
- Anything in your own `fakeDomains` or `fakeAddresses` lists.

Everything else is treated as a real sender and left alone.

## Your rules

The script ships with lists of scam domains and addresses found so far. Open **Rules** to add
your own on top of them, for example:

```json
{
  "fakeDomains": ["hacked-shop.example"],
  "fakeAddresses": ["you@hotmail.com"],
  "realDomains": ["your-local-venue.com"]
}
```

- `fakeDomains`: scam or hacked domains the heuristics miss.
- `fakeAddresses`: single scam addresses on shared providers such as gmail.com. If scammers
  spoof your own address, add it here; it stays in your browser and out of this repo.
- `realDomains` and `realAddresses`: real companies or people the heuristics wrongly flag.
  These win over every other rule, so they also rescue a sender from the default fake lists.

The row buttons edit these same lists for you.

Your rules are added to the defaults and stored in Violentmonkey, not in the script, so script
updates never overwrite them. Keep a copy in a local `my-rules.json` (git-ignored) if you want
a backup.

## Safety

- Deleted conversations go to **Deleted Items** and can be restored from there.
- Before every Delete click the script re-checks every selected row. If a real sender is
  selected, it stops without deleting anything.
- Only conversations dated on or after the day of the last completed run are touched. The
  first run covers the whole folder (Outlook keeps Junk for 30 days). A run you stop, or one
  that halts on a safety check, does not move the date forward. To force a whole-folder sweep,
  delete the `lastRun` value in the script's **Values** tab in Violentmonkey.

## Development

`node test.js` checks the classifier, date parsing and row parsing. Run it after changing the
rules or the classifier, and bump `@version` so installed copies update.

The script reads Outlook's page structure: the list rows, the list's scroll area, the row
checkboxes and the Delete button. If Outlook redesigns its page and Scan finds 0 conversations,
those selectors need updating.
