// ==UserScript==
// @name        Outlook Junk Triage
// @namespace   outlook-junk-triage
// @version     0.6.1
// @description Flag clearly fake senders in the Outlook.com Junk folder, mark senders fake or real in one click, delete fakes received since the last run, and collect unsubscribe links.
// @homepageURL https://github.com/Filaipus/outlook-junk-triage
// @updateURL   https://raw.githubusercontent.com/Filaipus/outlook-junk-triage/main/junk-triage.user.js
// @downloadURL https://raw.githubusercontent.com/Filaipus/outlook-junk-triage/main/junk-triage.user.js
// @match       https://outlook.live.com/mail/*
// @grant       GM_getValue
// @grant       GM_setValue
// @run-at      document-idle
// ==/UserScript==

/* eslint-disable no-undef */
const DEFAULT_RULES = {
  // Scan automatically (since the last run) whenever the Junk folder opens.
  autoScan: true,
  // What the Fix layout button sets, using the option names in Outlook's View menus. Compact rows
  // with no preview line fit the most conversations on screen, so each Delete click removes more.
  layout: { density: 'Compact', preview: 'Off', readingPane: 'Show on the right' },
  // Throwaway TLDs that real senders rarely use.
  spamTlds: ['sbs', 'online', 'space', 'shop', 'website', 'surf', 'beer', 'top', 'xyz', 'icu', 'click', 'cfd',
    'lol', 'buzz', 'site', 'store', 'la', 'cl', 'np', 'mx'],
  // Scam or hacked domains found by hand.
  fakeDomains: [
    'uqtvivu.com', 'genaarf.com', 'aamzyuu.com', 'y9jg3g5.com', 'b1dhgou.com', 'ri4oxnv.com', 'rpvuush.com',
    'aevvxbh.com', 'qivaeeaxjwksjqpuialvhqhhj.com', 'uiyvatt.com', 'vttghau.com', 'akydoux.com', 'ubhixii.com',
    'sqiongq.com', 'fdgiuav.com', 'eikdmbw.com', 'recukgo.com', 'yousynchronize.com', '4profitsoftware.com',
    'turnermech.com', 'aiken-cpa.com', 'www.omax.com.hk', 'sharpshootertv.com', 'lilotto.com',
    'bgl.gogettazafrica.com', 'gologonow.uk', 'live.com', 'bigasswhore.com', 'chinookrvpark.com',
    'mail.visitorinsitesai.com', 'affet.centerfordigitalart.com', 'sac.extra.com.br', 'cal.com.ng',
    'martinheckmann.net', 'em.kens5.com', 'raksul.com', 'mail-service.wondershare.com',
  ],
  // Single scam addresses on shared providers (gmail, hotmail). Add your own address through the
  // Rules button if scammers spoof it; it is kept out of this file.
  fakeAddresses: [
    's.wimonp@gmail.com', 'dtgjergj816@gmail.com', 'puttipong0993691750@gmail.com', 'szcscnnry372396@gmail.com',
    'diqzbbp488@gmail.com', 'flrgvigvztjdncpqf9@gmail.com', 'iivzbylmooq@gmail.com',
    'sujitpal9661189248@gmail.com', 'hk3789130@gmail.com', 'muffingot93@gmail.com',
  ],
  // Real companies the heuristics would otherwise catch. Real lists win over every fake rule.
  realDomains: ['porkbun.com', 'spotify.com', 'everythingisnew.pt', 'thegrid.com'],
  realAddresses: [],
  scamSubjects: ['change phone number', 'primary contact number', 'phone number change', 'request to withdraw',
    'verification key to restore', 'payment issue for your mcafee', 'your files are deleted',
    'payment method declined'],
};

// Shared mail providers: mark single addresses there, never the whole domain.
const SHARED_PROVIDERS = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'outlook.com',
  'outlook.pt', 'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com',
  'sapo.pt'];

// Your Rules are added to the defaults (lists are combined), so updates to the defaults still reach you.
function mergeRules(defaults, stored) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(stored || {})) {
    // A single value typed without [ ] still adds to the list instead of replacing it.
    out[k] = Array.isArray(defaults[k]) ? [...new Set([...defaults[k], ...[].concat(v)])] : v;
  }
  return out;
}

const HIDDEN_CHARS = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}ְ-ׇ]/u;

// Returns why a sender is clearly fake, or null when it looks real. Row: {name, addr, subj}.
function classify(row, rules) {
  const addr = (row.addr || '').toLowerCase();
  if (!addr) return 'no sender address';
  const dom = addr.split('@')[1] || '';
  if ((rules.realAddresses || []).includes(addr) || rules.realDomains.includes(dom)) return null;
  if (rules.fakeDomains.includes(dom) || rules.fakeAddresses.includes(addr)) return 'known scam sender';
  if (!dom.includes('.')) return 'no real domain';
  if (/\.com[a-z0-9]{10,}$|\.us-[a-z0-9]+$/.test(dom)) return 'garbage domain';
  if (rules.spamTlds.includes(dom.split('.').pop())) return 'throwaway TLD';
  const parts = dom.split('.');
  const reg = parts[parts.length - 2] || '';
  // shortcut: catches 7-letter consonant soup like "jkmpmtj.com"; real 7-letter brands go in realDomains.
  if (parts.length === 2 && /^[a-z]{7}$/.test(reg) && !/[aeiou]{2}/.test(reg) && (reg.match(/[aeiou]/g) || []).length <= 2) return 'random domain';
  if (/^(?=.*\d)[a-z0-9]{20,}$/.test(reg) || /^[a-z]{15}$/.test(reg)) return 'random domain';
  if (HIDDEN_CHARS.test((row.name || '') + (row.subj || ''))) return 'hidden-character brand spoof';
  const subj = (row.subj || '').toLowerCase();
  if (rules.scamSubjects.some(s => subj.includes(s))) return 'account-scam template';
  return null;
}

// Updates your stored rules when you mark a sender fake or real. Returns the new stored rules, or
// null when the row has no address to mark.
// shortcut: marking a default realDomains entry fake has no effect (real lists win); edit the
// default list if that is ever needed.
function applyMark(stored, addr, verdict) {
  addr = (addr || '').toLowerCase();
  const dom = addr.split('@')[1];
  if (!dom) return null;
  const shared = SHARED_PROVIDERS.includes(dom);
  const out = { ...stored };
  const list = k => (out[k] = [...(out[k] || [])]);
  const add = (k, v) => { if (!list(k).includes(v)) out[k].push(v); };
  const drop = (k, v) => { out[k] = list(k).filter(x => x !== v); };
  if (verdict === 'fake') {
    if (shared) { add('fakeAddresses', addr); drop('realAddresses', addr); } else { add('fakeDomains', dom); drop('realDomains', dom); }
  } else if (shared) { add('realAddresses', addr); drop('fakeAddresses', addr); } else { add('realDomains', dom); drop('fakeDomains', dom); }
  return out;
}

// Outlook shows "10:16" (today), "Sun 16:49" (the past week), "Tue 10/20" (this year) or
// "26/10/14" (yy/mm/dd, older).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function parseDate(lines, now) {
  for (const s of lines) {
    let m;
    if (/^\d{1,2}:\d{2}$/.test(s)) return new Date(now);
    if ((m = s.match(/^(\w{3}) \d{1,2}:\d{2}$/)) && WEEKDAYS.includes(m[1])) {
      // Today shows only the time, so the same weekday means a week ago.
      const back = (now.getDay() - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    }
    if ((m = s.match(/^\w{3} (\d{1,2})\/(\d{1,2})$/))) {
      const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
      if (d > now) d.setFullYear(d.getFullYear() - 1);
      return d;
    }
    if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/))) return new Date(2000 + +m[1], +m[2] - 1, +m[3]);
  }
  return null;
}

function parseRowText(text) {
  const t = text.split('\n').map(s => s.trim()).filter(Boolean);
  const a = t.findIndex(s => /^<.*@.*>$/.test(s));
  return {
    name: a > 0 ? t[a - 1] : t[1],
    addr: a >= 0 ? t[a].slice(1, -1).toLowerCase() : '',
    subj: a >= 0 ? t[a + 1] : t[2],
    lines: t,
  };
}

// The one rule for what Delete removes: clearly fake, and dated on or after the cutoff day.
// Rows with no readable date are never deleted.
function isDeleteTarget(info, cut) {
  return !!info.why && !!info.date && info.date >= cut;
}

// Menu paths in Outlook's View ribbon for each layout setting: ribbon button, submenus, option.
function layoutSteps(layout) {
  const paths = { density: ['Density'], preview: ['Messages', 'Message preview'], readingPane: ['Layout', 'Reading pane'] };
  return Object.entries(layout || {}).filter(([k, v]) => paths[k] && v).map(([k, v]) => [...paths[k], v]);
}

// Start of the day the next Scan/Delete looks back to. A chosen window (hours) wins; otherwise the
// day of the last completed run; with neither, the whole folder. Rounded to the day because Outlook
// shows only a date for mail older than today.
function cutoffFrom(lastRun, windowHours, now) {
  const d = windowHours > 0 ? new Date(now - windowHours * 3600e3) : lastRun ? new Date(lastRun) : null;
  if (!d || isNaN(d)) return new Date(0);
  d.setHours(0, 0, 0, 0);
  return d;
}

// True when dates (newest first, nulls skipped) never go up: the list is sorted newest first.
function isNewestFirst(dates) {
  const d = dates.filter(Boolean);
  return d.every((x, i) => i === 0 || x <= d[i - 1]);
}

function init() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stored = () => { try { return JSON.parse(GM_getValue('rules', '{}')); } catch { return {}; } };
  const load = () => mergeRules(DEFAULT_RULES, stored());
  let rules = load();
  let stopRequested = false;
  let busy = false;
  let lastScan = null;
  let autoScanned = false;
  let autoRunning = false;
  let unsubLinks = [];

  const onJunk = () => location.pathname.includes('/junkemail');
  const rowsNow = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const scroller = () => document.querySelector('[role="listbox"] .customScrollBar');
  const rowId = o => o.getAttribute('data-convid') || o.id || o.innerText.slice(0, 200);
  const checkbox = o => o.querySelector('[role=checkbox]');
  const isChecked = o => checkbox(o)?.getAttribute('aria-checked') === 'true';
  const isSelected = o => isChecked(o) || o.getAttribute('aria-selected') === 'true';
  // Our row buttons draw their labels with CSS ::after, so they never show up in innerText.
  const rowInfo = o => { const r = parseRowText(o.innerText); return { ...r, date: parseDate(r.lines, new Date()), why: classify(r, rules) }; };
  const deleteButton = () => [...document.querySelectorAll('button')]
    .find(b => /^Delete$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim().split('\n')[0]));
  // Saved in the script's storage and mirrored to outlook.live.com's localStorage, so a reinstall
  // or a script-storage reset doesn't throw away the last run.
  const recall = k => GM_getValue(k, '') || (() => { try { return localStorage.getItem('junkTriage.' + k) || ''; } catch { return ''; } })();
  const remember = (k, v) => { GM_setValue(k, v); try { localStorage.setItem('junkTriage.' + k, v); } catch { /* storage blocked */ } };
  // Copy what either store already holds into both, so values saved before this version are kept too.
  ['lastRun', 'window'].forEach(k => { const v = recall(k); if (v) remember(k, v); });
  // Junk empties itself after 30 days, so with no last run and no window this is the whole folder.
  const cutoff = () => cutoffFrom(recall('lastRun'), +recall('window'), new Date());
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const since = () => (cutoff().getTime() ? `since ${cutoff().toDateString()}` : 'in the whole folder');
  // Outlook stops rendering the list in background tabs, so pause until the tab is visible again.
  const waitVisible = async () => { while (document.visibilityState !== 'visible') { status('Paused: bring this tab to the front'); await sleep(1000); } };
  const fewRowsTip = () => (rowsNow().length && rowsNow().length < 10
    ? (GM_getValue('layoutFixed', '')
      ? '\n\nTip: maximize the Outlook window to fit more rows per batch.'
      : '\n\nTip: press Fix layout to fit more rows per batch.')
    : '');
  const listMissing = 'Could not find the message list. Open the Junk Email folder; if it is open, Outlook changed its page (see CLAUDE.md).';

  // --- styles (row tint + row buttons) ---
  const css = document.createElement('style');
  css.textContent = `
    [role="option"][data-jt="fake"] { background: rgba(220, 50, 50, .12) !important; }
    [data-jt-ui] { position: absolute; right: 44px; top: 4px; z-index: 5; display: flex; gap: 4px; font: 11px system-ui; }
    [data-jt-ui] [data-why]::after { content: attr(data-why); color: #b33; padding: 1px 4px; }
    [data-jt-btn] { border: 1px solid #999; border-radius: 4px; background: #fff; cursor: pointer; padding: 0 5px; opacity: .25; }
    [role="option"]:hover [data-jt-btn] { opacity: 1; }
    [data-jt-btn="fake"]::after { content: "✗ fake"; color: #b33; }
    [data-jt-btn="real"]::after { content: "✓ real"; color: #286; }`;

  // --- panel ---
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#fff;color:#222;border:1px solid #888;border-radius:8px;padding:10px;font:13px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.25);width:320px';
  // Outlook enforces Trusted Types, so build the panel with DOM calls instead of innerHTML.
  const title = document.createElement('b'); title.textContent = 'Junk Triage';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0';
  [['scan', 'Scan'], ['delete', 'Delete fakes'], ['unsub', 'Unsubscribe links'], ['layout', 'Fix layout'], ['report', 'Save report'], ['rules', 'Rules'], ['stop', 'Stop']]
    .forEach(([a, label]) => { const b = document.createElement('button'); b.dataset.a = a; b.textContent = label; bar.appendChild(b); });
  // Look-back window for Scan and Delete; "since last run" is the default.
  const windowPick = document.createElement('select'); windowPick.title = 'How far back Scan and Delete look';
  [['', 'Since last run'], ['24', 'Last 24 hours'], ['72', 'Last 72 hours'], ['168', 'Last 7 days'], ['720', 'Last 30 days']]
    .forEach(([v, label]) => windowPick.append(new Option(label, v)));
  windowPick.value = recall('window');
  windowPick.addEventListener('change', () => {
    // A running scan or delete already chose its cutoff; changing it midway would mix two windows.
    if (busy) { windowPick.value = recall('window'); return status('Busy — press Stop first.'); }
    remember('window', windowPick.value); lastScan = null; badge(''); status(`Scan and Delete now look ${since()}.`); });
  bar.appendChild(windowPick);
  const statusLine = document.createElement('div'); statusLine.style.whiteSpace = 'pre-wrap';
  const list = document.createElement('div'); list.style.cssText = 'max-height:220px;overflow:auto;margin-top:6px';
  panel.append(title, bar, statusLine, list);
  const status = msg => { statusLine.textContent = msg; };
  const badge = text => { title.textContent = text ? `Junk Triage — ${text}` : 'Junk Triage'; };

  // --- row decoration: tint fakes, show the reason, and add fake/real buttons ---
  function decorate() {
    for (const o of rowsNow()) {
      const r = rowInfo(o);
      o.dataset.jt = r.why ? 'fake' : 'real';
      let ui = o.querySelector('[data-jt-ui]');
      if (!ui) {
        ui = document.createElement('span'); ui.dataset.jtUi = '';
        const why = document.createElement('span'); why.dataset.why = '';
        const f = document.createElement('button'); f.dataset.jtBtn = 'fake'; f.title = 'Mark this sender as fake';
        const g = document.createElement('button'); g.dataset.jtBtn = 'real'; g.title = 'Mark this sender as real';
        ui.append(why, f, g);
        if (getComputedStyle(o).position === 'static') o.style.position = 'relative';
        o.appendChild(ui);
      }
      ui.querySelector('[data-why]').dataset.why = r.why || '';
      ui.style.display = r.addr ? 'flex' : 'none';
    }
  }

  // Capture phase, so Outlook never sees the click and opens the message.
  for (const type of ['mousedown', 'mouseup', 'click']) {
    window.addEventListener(type, e => {
      const btn = e.target.closest && e.target.closest('[data-jt-btn]');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (type !== 'click') return;
      const row = btn.closest('[role="option"]');
      const r = row && rowInfo(row);
      const next = r && applyMark(stored(), r.addr, btn.dataset.jtBtn);
      if (!next) return;
      GM_setValue('rules', JSON.stringify(next)); rules = load(); lastScan = null; decorate();
      const dom = r.addr.split('@')[1];
      status(`Marked ${SHARED_PROVIDERS.includes(dom) ? r.addr : dom} as ${btn.dataset.jtBtn}.`);
    }, true);
  }

  // Outlook re-renders <body> and drops foreign nodes, so live on <html> and re-attach if removed.
  setInterval(() => {
    if (!css.isConnected) document.documentElement.appendChild(css);
    if (!panel.isConnected) document.documentElement.appendChild(panel);
    panel.style.display = onJunk() ? '' : 'none';
    if (!onJunk()) { autoScanned = false; return; }
    decorate();
    if (rules.autoScan && !autoScanned && !busy && document.visibilityState === 'visible' && rowsNow().length) {
      autoScanned = true;
      // A first run would scroll the whole folder (about a minute), so leave that to the Scan button.
      if (!cutoff().getTime()) return badge('first run: press Scan');
      autoRunning = true;
      run(() => scan({ untilCutoff: true })).finally(() => { autoRunning = false; });
    }
  }, 700);

  // The automatic scan scrolls the list; give it back the moment you scroll it yourself.
  for (const type of ['wheel', 'touchmove', 'keydown']) {
    window.addEventListener(type, e => { if (autoRunning && e.isTrusted) stopRequested = true; }, true);
  }

  async function run(task) {
    if (busy) return status('Busy — press Stop first.');
    busy = true; stopRequested = false;
    try { await task(); } catch (err) { status('Error: ' + err.message); } finally { busy = false; }
  }

  // Scrolls the list (or only the part since the last run) and counts fake vs real senders.
  async function scan({ untilCutoff = false } = {}) {
    const sc = scroller();
    if (!sc) return status(listMissing);
    const cutDate = cutoff();
    const cut = ymd(cutDate);
    sc.scrollTop = 0; await sleep(800);
    const seen = new Map(); let stale = 0; let last = -1;
    while (stale < 10 && !stopRequested) {
      await waitVisible();
      const rows = rowsNow();
      for (const o of rows) {
        const id = rowId(o);
        if (!seen.has(id)) {
          const r = rowInfo(o);
          seen.set(id, { name: r.name, addr: r.addr, subj: r.subj, date: r.date && ymd(r.date), why: r.why, target: isDeleteTarget(r, cutDate) });
        }
      }
      if (untilCutoff) { const ds = rows.map(o => rowInfo(o).date).filter(Boolean); if (ds.length && ds.every(d => d < cutDate)) break; }
      sc.scrollTop += sc.clientHeight * 0.8; await sleep(350);
      if (seen.size === last) stale++; else { stale = 0; last = seen.size; }
    }
    // A stopped scan is incomplete: keep no result and leave the list where you scrolled it.
    if (stopRequested) { badge(''); return status('Scan stopped.'); }
    sc.scrollTop = 0;
    const all = [...seen.values()].filter(r => !untilCutoff || (r.date && r.date >= cut));
    if (!all.length && !untilCutoff) return status('Scan found no conversations. ' + listMissing);
    const fake = all.filter(r => r.why);
    lastScan = { at: new Date().toISOString(), cutoff: cut, partial: untilCutoff, total: all.length, fake, real: all.filter(r => !r.why) };
    const byReason = {}; fake.forEach(r => { byReason[r.why] = (byReason[r.why] || 0) + 1; });
    const deletable = fake.filter(r => r.target).length;
    badge(deletable ? `${deletable} fake ${since()}` : `clean ${since()}`);
    status(`${all.length} conversations ${untilCutoff ? since() : 'scanned'}\n${fake.length} clearly fake (${deletable} ${since()})\n${all.length - fake.length} from real senders\n\n`
      + Object.entries(byReason).map(([k, v]) => `${v}  ${k}`).join('\n') + fewRowsTip());
    return lastScan;
  }

  // One top-to-cutoff pass. Returns how many were deleted, or a stop reason.
  async function deletePass(cut) {
    const sc = scroller(); sc.scrollTop = 0; await sleep(800);
    const isTarget = o => isDeleteTarget(rowInfo(o), cut);
    let deleted = 0; let stuck = 0; let mismatches = 0;
    // Untick one row at a time, re-querying after each click (rows re-render).
    const untickAll = async () => {
      for (let i = 0; i < 40; i++) { const o = rowsNow().find(isChecked); if (!o) break; checkbox(o).click(); await sleep(80); }
      await sleep(200);
    };
    while (!stopRequested) {
      await waitVisible();
      const rows = rowsNow();
      const dates = rows.map(o => rowInfo(o).date).filter(Boolean);
      if (dates.length && dates.every(d => d < cut)) break;
      const targets = rows.filter(isTarget);
      if (!targets.length) {
        // Never scroll with rows still ticked: off screen they could no longer be checked.
        await untickAll();
        const before = sc.scrollTop; sc.scrollTop += sc.clientHeight * 0.8; await sleep(500);
        if (sc.scrollTop === before && ++stuck > 4) break; else if (sc.scrollTop !== before) stuck = 0;
        continue;
      }
      // Each checkbox click re-renders the list, so re-query before every click instead of
      // reusing row elements (they go stale and clicking them does nothing).
      for (let i = 0; i < 40; i++) {
        const next = rowsNow().find(o => isTarget(o) && !isChecked(o));
        if (!next) break;
        checkbox(next)?.click(); await sleep(80);
      }
      await sleep(250);
      // Safety: never press Delete while a real sender's row is selected.
      const bad = rowsNow().filter(o => isSelected(o) && !isTarget(o));
      if (bad.length) {
        await untickAll(); mismatches++;
        if (rowsNow().some(o => isSelected(o) && !isTarget(o))) {
          return { deleted, stop: `Stopped: a real sender was selected (${rowInfo(bad[0]).addr || rowInfo(bad[0]).name}). Nothing else deleted.` };
        }
        continue;
      }
      const picked = rowsNow().filter(isChecked);
      if (!picked.length) continue;
      // Outlook can't report its selection count, and rows off screen can't be checked. So the
      // ticked rows on screen must be exactly the targets on screen now, or nothing is deleted.
      const want = rowsNow().filter(isTarget).length;
      if (picked.length !== want) {
        await untickAll();
        // A re-render mid-batch can still cause this; retry the batch before giving up.
        if (++mismatches <= 3) continue;
        return { deleted, stop: `Stopped: ${picked.length} rows were selected but ${want} were expected, ${mismatches} times in a row. Nothing else deleted.` };
      }
      mismatches = 0;
      const btn = deleteButton();
      if (!btn) return { deleted, stop: 'Stopped: could not find the Delete button. Outlook may have changed its page (see CLAUDE.md).' };
      btn.click(); deleted += picked.length;
      status(`Deleting… ${deleted}`);
      // Wait for Outlook to remove the rows instead of a fixed pause (max 6 s).
      for (let i = 0; i < 60 && picked.some(o => o.isConnected && isChecked(o)); i++) await sleep(100);
      await sleep(150);
    }
    return { deleted };
  }

  async function deleteFakes() {
    const sc = scroller();
    if (!sc) return status(listMissing);
    const top = rowsNow().slice(0, 15).map(o => rowInfo(o).date);
    if (!isNewestFirst(top)) return status('The list is not sorted by date, newest first. Change the sort and try again; the "since last run" cutoff depends on it.');
    const scanResult = lastScan || await scan({ untilCutoff: true });
    if (!scanResult) return;
    const cut = cutoff();
    const planned = scanResult.fake.filter(r => r.target).length;
    if (!planned) { status(`Nothing to delete ${since()}.`); remember('lastRun', scanResult.at); return badge(`clean ${since()}`); }
    if (!confirm(`Move ${planned} clearly fake conversations ${since()} to Deleted Items?`)) return;
    let total = 0; let clean = false;
    // Extra passes catch rows the list skipped while re-rendering, and mail that arrived mid-run.
    for (let pass = 0; pass < 3 && !stopRequested; pass++) {
      const r = await deletePass(cut);
      total += r.deleted;
      if (r.stop) return status(`${r.stop}\nMoved ${total} conversations to Deleted Items before stopping.`);
      if (!r.deleted) { clean = true; break; }
    }
    lastScan = null;
    // Only a run whose last pass found nothing moves the cutoff forward, so leftovers are redone next time.
    if (clean && !stopRequested) { remember('lastRun', scanResult.at); badge(`clean ${since()}`); }
    const leftover = !clean && !stopRequested ? '\nSome fakes may remain; run Delete fakes again.' : '';
    status(`${stopRequested ? 'Stopped' : 'Done'}: moved ${total} conversations to Deleted Items.${leftover}${fewRowsTip()}`);
  }

  // Opens one message per real sender and collects its unsubscribe link (this marks it read).
  async function collectUnsubscribe() {
    // Needs every real sender, so a partial (since-last-run) scan is not enough.
    const scanResult = lastScan && !lastScan.partial ? lastScan : await scan();
    if (!scanResult) return;
    const key = addr => { const d = addr.split('@')[1]; return SHARED_PROVIDERS.includes(d) ? addr : d; };
    const counts = {};
    scanResult.real.filter(r => r.addr).forEach(r => { counts[key(r.addr)] = (counts[key(r.addr)] || 0) + 1; });
    const want = new Set(Object.keys(counts));
    const found = new Map(unsubLinks.map(l => [l.sender, l]));
    const re = /unsubscribe|opt[- ]?out|email.?preferences|manage.?(your )?(email|subscription|preferences|notifications)|stop receiving|desinscrever|cancelar.?subscri|darse de baja/i;
    const sc = scroller(); sc.scrollTop = 0; await sleep(800);
    let stale = 0;
    while (!stopRequested && found.size < want.size && stale < 6) {
      await waitVisible();
      const row = rowsNow().find(o => { const r = rowInfo(o); return r.addr && want.has(key(r.addr)) && !found.has(key(r.addr)); });
      if (!row) { const before = sc.scrollTop; sc.scrollTop += sc.clientHeight * 0.8; await sleep(400); stale = sc.scrollTop === before ? stale + 1 : 0; continue; }
      const sender = key(rowInfo(row).addr);
      row.click(); await sleep(2000);
      // Links in Junk stay disabled until "Show blocked content" is clicked.
      const show = [...document.querySelectorAll('button,[role="button"],a')].find(e => /Show blocked content/i.test(e.innerText || ''));
      if (show) { show.click(); await sleep(1500); }
      const body = document.querySelector('[aria-label="Message body"]');
      const a = body && [...body.querySelectorAll('a')].find(x => re.test(`${x.innerText} ${x.href}`));
      found.set(sender, { sender, count: counts[sender], href: a ? a.href : null });
      status(`Collecting unsubscribe links… ${found.size} of ${want.size} senders`);
    }
    unsubLinks = [...found.values()].sort((x, y) => y.count - x.count);
    renderUnsub();
    status(`${unsubLinks.filter(l => l.href).length} senders with an unsubscribe link (${unsubLinks.length} checked). Click one to open it in a new tab.`);
  }

  function renderUnsub() {
    list.replaceChildren(...unsubLinks.filter(l => l.href).map(l => {
      const a = document.createElement('a');
      a.href = l.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = `${l.sender} (${l.count})`;
      a.style.display = 'block';
      return a;
    }));
  }

  function saveReport() {
    if (!lastScan) return status('Run Scan first.');
    const grouped = {};
    lastScan.real.forEach(r => { const d = r.addr.split('@')[1] || r.name; (grouped[d] ||= { count: 0, sample: r.subj }).count++; });
    const report = { ...lastScan, realByDomain: Object.entries(grouped).sort((a, b) => b[1].count - a[1].count), unsubscribe: unsubLinks };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    a.download = `junk-report-${lastScan.at.slice(0, 10)}.json`;
    a.click();
  }

  function editRules() {
    const text = prompt('Your rules (JSON), added on top of the defaults. Clear the box to remove them.', GM_getValue('rules', '{}'));
    if (text === null) return;
    try { GM_setValue('rules', text.trim() ? JSON.stringify(JSON.parse(text)) : '{}'); rules = load(); lastScan = null; decorate(); status('Rules saved.'); }
    catch { status('Not valid JSON; rules unchanged.'); }
  }

  // Sets the layout from rules.layout by clicking through Outlook's View menus, then returns to
  // the Home ribbon (the Delete button only exists there).
  async function fixLayout() {
    const steps = layoutSteps(rules.layout);
    const describe = s => `${s.slice(0, -1).join(' → ')}: ${s[s.length - 1]}`;
    if (!confirm(`Change Outlook's layout?\n\n${steps.map(describe).join('\n')}\n\nYou can change these back under View.`)) return;
    const norm = e => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    const tab = label => [...document.querySelectorAll('[role="tab"]')].find(t => norm(t) === label);
    // Ribbon buttons' text includes their hover description, so match the aria-label.
    const ribbonButton = label => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
    // Closed menus can stay in the page, so only look at visible ones. Menus float (fixed
    // position), where offsetParent is always null, so ask the browser instead.
    const shown = e => (e.checkVisibility ? e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : e.getClientRects().length > 0);
    // The selected option starts with a checkmark glyph from Outlook's icon font, so compare
    // letters, digits and spaces only.
    const plain = s => s.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase();
    const findItem = label => [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')]
      .filter(shown).find(e => plain(norm(e)) === plain(label));
    // Menus fade in, so wait (up to 3 s) until the option is actually visible.
    const menuItem = async label => { for (let i = 0; i < 30; i++) { const m = findItem(label); if (m) return m; await sleep(100); } return null; };
    tab('View')?.click(); await sleep(800);
    const changed = []; const failed = [];
    for (const s of steps) {
      const btn = ribbonButton(s[0]);
      if (!btn) { failed.push(describe(s)); continue; }
      btn.click();
      let ok = true;
      for (const sub of s.slice(1, -1)) { const m = await menuItem(sub); if (!m) { ok = false; break; } m.click(); }
      const item = ok && await menuItem(s[s.length - 1]);
      if (!item) failed.push(describe(s));
      else if (item.getAttribute('aria-checked') !== 'true') { item.click(); changed.push(describe(s)); }
      await sleep(700);
      // Close any menu still open (already-selected options leave it open).
      if ([...document.querySelectorAll('[role="menu"]')].some(shown)) { btn.click(); await sleep(400); }
    }
    tab('Home')?.click(); await sleep(500);
    if (!failed.length) GM_setValue('layoutFixed', new Date().toISOString());
    status((changed.length ? `Changed: ${changed.join(', ')}.` : 'Layout already set.')
      + (failed.length ? `\nCould not find: ${failed.join(', ')}. Outlook's menus may have changed (see CLAUDE.md).` : '')
      + `\n${rowsNow().length} rows fit on screen now.`);
  }

  panel.addEventListener('click', e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === 'stop') { stopRequested = true; return; }
    if (a === 'report') return saveReport();
    if (a === 'rules') return editRules();
    run(() => (a === 'scan' ? scan() : a === 'delete' ? deleteFakes() : a === 'layout' ? fixLayout() : collectUnsubscribe()));
  });
}

if (typeof module !== 'undefined') module.exports = { cutoffFrom, classify, parseDate, parseRowText, mergeRules, applyMark, isNewestFirst, isDeleteTarget, layoutSteps, DEFAULT_RULES };
else init();
