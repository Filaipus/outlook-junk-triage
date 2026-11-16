// Run: node test.js — checks the classifier, date parsing and row parsing on sample Junk rows.
const assert = require('assert');
const { classify, parseDate, parseRowText, mergeRules, applyMark, isNewestFirst, isDeleteTarget, layoutSteps, DEFAULT_RULES } = require('./junk-triage.user.js');

// Fix layout: each setting maps to its path in Outlook's View ribbon; unknown or empty ones are skipped.
assert.deepStrictEqual(layoutSteps(DEFAULT_RULES.layout), [
  ['Density', 'Compact'], ['Messages', 'Message preview', 'Off'], ['Layout', 'Reading pane', 'Show on the right'],
]);
assert.deepStrictEqual(layoutSteps({ density: 'Cozy', preview: '', bogus: 'x' }), [['Density', 'Cozy']]);
assert.deepStrictEqual(layoutSteps(undefined), []);
// Your own layout replaces the default one as a whole (it is not a list).
assert.deepStrictEqual(mergeRules(DEFAULT_RULES, { layout: { density: 'Cozy' } }).layout, { density: 'Cozy' });

// Personal rules come from the Rules button and are added to the defaults.
const R = mergeRules(DEFAULT_RULES, { fakeDomains: ['hacked-shop.example'], fakeAddresses: ['me@hotmail.example'] });
assert.ok(R.fakeDomains.includes('uqtvivu.com') && R.fakeDomains.includes('hacked-shop.example'), 'lists are combined');
assert.ok(R.fakeAddresses.length === DEFAULT_RULES.fakeAddresses.length + 1);
assert.deepStrictEqual(mergeRules(DEFAULT_RULES, {}), DEFAULT_RULES);
// A value typed without [ ] adds to the list instead of replacing the defaults.
const typo = mergeRules(DEFAULT_RULES, { fakeDomains: 'gmx-spam.example' });
assert.ok(typo.fakeDomains.includes('uqtvivu.com') && typo.fakeDomains.includes('gmx-spam.example'));
assert.strictEqual(classify({ addr: 'x@mx.com', subj: 'Hi' }, typo), null, 'no partial-text matches');
assert.strictEqual(mergeRules(DEFAULT_RULES, { autoScan: false }).autoScan, false);

// Delete targets: fake AND dated on/after the cutoff day; no date means never.
const cutDay = new Date(2026, 10, 10);
assert.ok(isDeleteTarget({ why: 'random domain', date: new Date(2026, 10, 10) }, cutDay), 'cutoff day itself');
assert.ok(isDeleteTarget({ why: 'random domain', date: new Date(2026, 10, 12) }, cutDay));
assert.ok(!isDeleteTarget({ why: 'random domain', date: new Date(2026, 10, 9, 23, 59) }, cutDay), 'day before');
assert.ok(!isDeleteTarget({ why: 'random domain', date: null }, cutDay), 'no date');
assert.ok(!isDeleteTarget({ why: null, date: new Date(2026, 10, 12) }, cutDay), 'real sender');

const fake = [
  [{ name: '✅Healthcare.com', addr: '', subj: 'Medicare' }, 'no sender address'],
  [{ name: 'BankofAmerica Credit Card ✅', addr: 'x@jkmpmtjmlrybtti.com', subj: 'Pay No Interest' }, 'random domain'],
  [{ name: 'Arterial Flush Alert', addr: 'x@hiyvfgz.com', subj: 'Pharma is terrified' }, 'random domain'],
  [{ name: 'Casino', addr: 'x@riviera.comq3dh6sbmakhmjvmo0htqt5wk9q3greykdyesq12c', subj: 'FREE SPINS' }, 'garbage domain'],
  [{ name: 'Casino', addr: 'x@d5gf.cqdflario.sbs', subj: '425% bonus' }, 'throwaway TLD'],
  [{ name: 'Lending', addr: 'x@ajdmzftvsosifs', subj: 'Bad credit?' }, 'no real domain'],
  [{ name: '', addr: 'x@small-business.example', subj: 'Your request to change phone number is pending' }, 'account-scam template'],
  [{ name: 'N\u{E0039}etflix', addr: 'x@clinic.example', subj: 'Reminder' }, 'hidden-character brand spoof'],
  [{ name: 'Shop', addr: 'x@hacked-shop.example', subj: 'Deal' }, 'known scam sender'],
  [{ name: 'Hiring', addr: 'me@hotmail.example', subj: 'Now Hiring' }, 'known scam sender'],
];
const real = [
  { name: 'Copilot', addr: 'notifications@github.com', subj: 'Re: PR #12' },
  { name: 'Porkbun', addr: 'x@porkbun.com', subj: 'Black Friday' },
  { name: 'Spotify', addr: 'x@spotify.com', subj: 'Concerts' },
  { name: 'Tucanos', addr: 'club@tucanos.com', subj: 'Update your app' },
  { name: 'Neighbor', addr: 'someone@gmail.com', subj: 'Ward newsletter' },
  { name: 'Bank', addr: 'x@mail1.wellsfargo.com', subj: 'Make your debit card yours' },
];
fake.forEach(([r, why]) => assert.strictEqual(classify(r, R), why, `${r.addr || r.name}`));
real.forEach(r => assert.strictEqual(classify(r, R), null, `should be real: ${r.addr}`));
// Without personal lists, those senders fall through to "real" (reviewed by hand).
assert.strictEqual(classify({ addr: 'x@hacked-shop.example', subj: 'Deal' }, DEFAULT_RULES), null);

// Mark fake / mark real: whole domains for companies, single addresses on shared providers.
let s = applyMark({}, 'promo@deals.example', 'fake');
assert.deepStrictEqual(s.fakeDomains, ['deals.example']);
s = applyMark(s, 'promo@deals.example', 'real');
assert.deepStrictEqual([s.fakeDomains, s.realDomains], [[], ['deals.example']]);
s = applyMark({}, 'spammer@gmail.com', 'fake');
assert.deepStrictEqual([s.fakeAddresses, s.fakeDomains], [['spammer@gmail.com'], undefined]);
assert.strictEqual(applyMark({}, '', 'fake'), null);
// Free providers ban one address, never the whole provider.
for (const a of ['spam@gmx.com', 'spam@mail.com', 'spam@sapo.pt', 'spam@hotmail.co.uk']) {
  const m = applyMark({}, a, 'fake');
  assert.deepStrictEqual([m.fakeAddresses, m.fakeDomains], [[a], undefined], a);
}
// A friend on live.com stays real even though live.com is a default fake domain.
const friend = mergeRules(DEFAULT_RULES, applyMark({}, 'friend@live.com', 'real'));
assert.strictEqual(classify({ addr: 'friend@live.com', subj: 'Hi' }, friend), null);
assert.strictEqual(classify({ addr: 'no-reply@live.com', subj: 'Lung trick' }, friend), 'known scam sender');

// Sort check guarding the "since last run" cutoff.
assert.ok(isNewestFirst([new Date(2026, 10, 16), null, new Date(2026, 10, 14), new Date(2026, 10, 14)]));
assert.ok(!isNewestFirst([new Date(2026, 10, 14), new Date(2026, 10, 16)]));

const now = new Date(2026, 10, 16, 12);
assert.strictEqual(parseDate(['10:16'], now).getDate(), 16);
assert.strictEqual(parseDate(['Tue 10/20'], now).toDateString(), new Date(2026, 9, 20).toDateString());
assert.strictEqual(parseDate(['Mon 12/28'], now).getFullYear(), 2025); // a future date means last year
assert.strictEqual(parseDate(['26/10/14'], now).toDateString(), new Date(2026, 9, 14).toDateString());
assert.strictEqual(parseDate(['no date here'], now), null);

const row = parseRowText('C\nAlice\n<alice@example.com>\nRe: PR #12\n10:16\nbody');
assert.deepStrictEqual([row.name, row.addr, row.subj], ['Alice', 'alice@example.com', 'Re: PR #12']);
assert.strictEqual(parseRowText('X\nSpam Co\n<no sender address>\nBuy now').addr, '');

console.log('all checks passed');
