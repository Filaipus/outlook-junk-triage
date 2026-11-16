// ==UserScript==
// @name        Outlook Junk Triage
// @namespace   outlook-junk-triage
// @version     0.3.0
// @description Sort the Outlook.com Junk folder into fake vs real senders, save a report, and delete fakes received since the last run.
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
  // Real companies the random-domain heuristic would otherwise catch.
  realDomains: [
    'porkbun.com', 'spotify.com', 'everythingisnew.pt', 'thegrid.com',
  ],
  scamSubjects: ['change phone number', 'primary contact number', 'phone number change', 'request to withdraw',
    'verification key to restore', 'payment issue for your mcafee', 'your files are deleted',
    'payment method declined'],
};

// Your Rules are added to the defaults (lists are combined), so updates to the defaults still reach you.
function mergeRules(defaults, stored) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(stored || {})) {
    out[k] = Array.isArray(v) && Array.isArray(defaults[k]) ? [...new Set([...defaults[k], ...v])] : v;
  }
  return out;
}

const HIDDEN_CHARS = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\u05B0-\u05C7]/u;

// Returns why a sender is clearly fake, or null when it looks real. Row: {name, addr, subj}.
function classify(row, rules) {
  const addr = (row.addr || '').toLowerCase();
  if (!addr) return 'no sender address';
  const dom = addr.split('@')[1] || '';
  if (rules.realDomains.includes(dom)) return null;
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

// Outlook shows "10:16" (today), "Tue 10/20" (this year) or "26/10/14" (yy/mm/dd, older).
function parseDate(lines, now) {
  for (const s of lines) {
    let m;
    if (/^\d{1,2}:\d{2}$/.test(s)) return new Date(now);
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

function init() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const load = () => { try { return mergeRules(DEFAULT_RULES, JSON.parse(GM_getValue('rules', '{}'))); } catch { return DEFAULT_RULES; } };
  let rules = load();
  let stopRequested = false;
  let lastScan = null;

  const rowsNow = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const scroller = () => document.querySelector('[role="listbox"] .customScrollBar');
  const checkbox = o => o.querySelector('[role=checkbox]');
  const isChecked = o => checkbox(o)?.getAttribute('aria-checked') === 'true';
  const rowInfo = o => { const r = parseRowText(o.innerText); return { ...r, date: parseDate(r.lines, new Date()), why: classify(r, rules) }; };
  const deleteButton = () => [...document.querySelectorAll('button')]
    .find(b => /^Delete$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim().split('\n')[0]));
  // Only look at mail since the start of the day of the last completed run (Junk empties itself
  // after 30 days, so the first run, with no last run yet, covers the whole folder).
  const cutoff = () => { const v = GM_getValue('lastRun', ''); if (!v) return new Date(0); const d = new Date(v); d.setHours(0, 0, 0, 0); return d; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const since = () => (cutoff().getTime() ? `since ${cutoff().toDateString()}` : 'in the whole folder');
  // Outlook stops rendering the list in background tabs, so pause until the tab is visible again.
  const waitVisible = async () => { while (document.visibilityState !== 'visible') { status('Paused: bring this tab to the front'); await sleep(1000); } };

  // --- panel ---
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#fff;color:#222;border:1px solid #888;border-radius:8px;padding:10px;font:13px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.25);width:300px';
  // Outlook enforces Trusted Types, so build the panel with DOM calls instead of innerHTML.
  const title = document.createElement('b'); title.textContent = 'Junk Triage';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0';
  [['scan', 'Scan'], ['delete', 'Delete fakes'], ['report', 'Save report'], ['rules', 'Rules'], ['stop', 'Stop']].forEach(([a, label]) => {
    const b = document.createElement('button'); b.dataset.a = a; b.textContent = label; bar.appendChild(b);
  });
  const statusLine = document.createElement('div'); statusLine.style.whiteSpace = 'pre-wrap';
  panel.append(title, bar, statusLine);
  const status = msg => { statusLine.textContent = msg; };
  // Outlook re-renders <body> and drops foreign nodes, so live on <html> and re-attach if removed.
  setInterval(() => {
    if (!panel.isConnected) document.documentElement.appendChild(panel);
    panel.style.display = location.pathname.includes('/junkemail') ? '' : 'none';
  }, 1000);
  document.documentElement.appendChild(panel);

  async function scan() {
    const sc = scroller();
    if (!sc) return status('Open the Junk Email folder first.');
    sc.scrollTop = 0; await sleep(800);
    const seen = new Map(); let stale = 0; let last = -1;
    while (stale < 10 && !stopRequested) {
      await waitVisible();
      for (const o of rowsNow()) {
        const id = o.getAttribute('data-convid') || o.id || o.innerText.slice(0, 200);
        if (!seen.has(id)) { const r = rowInfo(o); seen.set(id, { name: r.name, addr: r.addr, subj: r.subj, date: r.date && ymd(r.date), why: r.why }); }
      }
      sc.scrollTop += sc.clientHeight * 0.8; await sleep(350);
      if (seen.size === last) stale++; else { stale = 0; last = seen.size; }
    }
    sc.scrollTop = 0;
    const all = [...seen.values()];
    const cut = ymd(cutoff());
    const fake = all.filter(r => r.why);
    lastScan = { at: new Date().toISOString(), cutoff: cut, total: all.length, fake, real: all.filter(r => !r.why) };
    const byReason = {}; fake.forEach(r => { byReason[r.why] = (byReason[r.why] || 0) + 1; });
    const deletable = fake.filter(r => r.date && r.date >= cut).length;
    status(`${all.length} conversations scanned\n${fake.length} clearly fake (${deletable} ${since()})\n${all.length - fake.length} from real senders\n\n`
      + Object.entries(byReason).map(([k, v]) => `${v}  ${k}`).join('\n'));
    return lastScan;
  }

  async function deleteFakes() {
    const scanResult = lastScan || await scan();
    const cut = cutoff();
    const planned = scanResult.fake.filter(r => r.date && r.date >= ymd(cut)).length;
    if (!planned) { GM_setValue('lastRun', scanResult.at); return status(`Nothing to delete ${since()}.`); }
    if (!confirm(`Move ${planned} clearly fake conversations ${since()} to Deleted Items?`)) return;
    const sc = scroller(); sc.scrollTop = 0; await sleep(800);
    const isTarget = o => { const r = rowInfo(o); return !!r.why && r.date && r.date >= cut; };
    let deleted = 0; let stuck = 0;
    while (!stopRequested) {
      await waitVisible();
      const rows = rowsNow();
      const dates = rows.map(o => rowInfo(o).date).filter(Boolean);
      if (dates.length && dates.every(d => d < cut)) break;
      const targets = rows.filter(isTarget);
      if (!targets.length) {
        const before = sc.scrollTop; sc.scrollTop += sc.clientHeight * 0.8; await sleep(700);
        if (sc.scrollTop === before && ++stuck > 4) break; else if (sc.scrollTop !== before) stuck = 0;
        continue;
      }
      for (const o of targets) { if (!isChecked(o)) { checkbox(o)?.click(); await sleep(80); } }
      await sleep(300);
      // Safety: never press Delete while a real sender's row is selected.
      const selected = rowsNow().filter(o => isChecked(o) || o.getAttribute('aria-selected') === 'true');
      const bad = selected.filter(o => !isTarget(o));
      if (bad.length) {
        bad.forEach(o => { if (isChecked(o)) checkbox(o).click(); });
        await sleep(300);
        if (rowsNow().some(o => (isChecked(o) || o.getAttribute('aria-selected') === 'true') && !isTarget(o))) {
          return status(`Stopped: a real sender was selected (${rowInfo(bad[0]).addr || rowInfo(bad[0]).name}). Nothing else deleted.`);
        }
      }
      const n = rowsNow().filter(isChecked).length;
      if (!n) continue;
      const btn = deleteButton();
      if (!btn) return status('Stopped: could not find the Delete button.');
      btn.click(); deleted += n;
      status(`Deleting… ${deleted} of ~${planned}`);
      await sleep(1800);
    }
    // Only a completed run moves the cutoff forward; a stopped run is redone next time.
    if (!stopRequested) GM_setValue('lastRun', scanResult.at);
    lastScan = null;
    status(`${stopRequested ? 'Stopped' : 'Done'}: moved ${deleted} conversations to Deleted Items.`);
  }

  function saveReport() {
    if (!lastScan) return status('Run Scan first.');
    const grouped = {};
    lastScan.real.forEach(r => { const d = r.addr.split('@')[1] || r.name; (grouped[d] ||= { count: 0, sample: r.subj }).count++; });
    const report = { ...lastScan, realByDomain: Object.entries(grouped).sort((a, b) => b[1].count - a[1].count) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    a.download = `junk-report-${lastScan.at.slice(0, 10)}.json`;
    a.click();
  }

  function editRules() {
    const text = prompt('Your rules (JSON), added on top of the defaults. Clear the box to remove them.', GM_getValue('rules', '{}'));
    if (text === null) return;
    try { GM_setValue('rules', text.trim() ? JSON.stringify(JSON.parse(text)) : '{}'); rules = load(); lastScan = null; status('Rules saved.'); }
    catch { status('Not valid JSON; rules unchanged.'); }
  }

  panel.addEventListener('click', async e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === 'stop') { stopRequested = true; return; }
    stopRequested = false;
    try {
      if (a === 'scan') await scan();
      if (a === 'delete') await deleteFakes();
      if (a === 'report') saveReport();
      if (a === 'rules') editRules();
    } catch (err) { status('Error: ' + err.message); }
  });
}

if (typeof module !== 'undefined') module.exports = { classify, parseDate, parseRowText, mergeRules, DEFAULT_RULES };
else init();
