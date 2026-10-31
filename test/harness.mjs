// Harness for the read-face takeover design: fakes the Client module loader,
// localStorage, react, and the slot registry surface the plugin touches.
// Run with `npm test` (node test/harness.mjs).
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

let loaded;
const windowStub = { __ModuleLoader__: { load: (entry) => { loaded = entry; } } };
const storage = new Map();
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const navigatorStub = { language: 'zh-CN' };

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};
const requireStub = (name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
};

let version = 0;
const regs = [];
class Slots {
  constructor() {
    this.hostSubs = [];
    this.protoSubs = [];
    this.host = {
      entriesOfSlot: (key) => regs.filter((r) => r.options.name === key),
      entries: (key) => regs.filter((r) => r.options.name === key),
      getVersion: () => version,
      subscribe: (_key, fn) => {
        this.hostSubs.push(fn);
        return () => {
          const i = this.hostSubs.indexOf(fn);
          if (i >= 0) this.hostSubs.splice(i, 1);
        };
      },
    };
  }
  register(options, component) {
    const row = { options, component };
    regs.push(row);
    version += 1;
    for (const fn of this.protoSubs) fn();
    return () => {
      const i = regs.indexOf(row);
      if (i >= 0) regs.splice(i, 1);
      version += 1;
      for (const fn of this.protoSubs) fn();
    };
  }
  entriesOfSlot(key) { return regs.filter((r) => r.options.name === key); }
  entries(key) { return regs.filter((r) => r.options.name === key); }
  getVersion() { return version; }
  subscribe(_key, fn) {
    this.protoSubs.push(fn);
    return () => {
      const i = this.protoSubs.indexOf(fn);
      if (i >= 0) this.protoSubs.splice(i, 1);
    };
  }
  inject(_key, callback) { return callback(); }
  hostFace() { return this.host; }
}

const noop = () => null;
// Entries registered before the manager activates (the hard case).
regs.push({ options: { name: 'sidebar.panellist', id: 'early-a', order: 1, label: 'early-a' }, component: noop });
regs.push({ options: { name: 'sidebar.panellist', id: 'early-b', order: 2, label: () => 'early-b' }, component: noop });
regs.push({ options: { name: 'conversation.session.header.actions', id: 'header', order: 3, label: 'header' }, component: noop });

const slots = new Slots();
const cleanups = [];
const ctx = {
  slots,
  effect(fn) { const d = fn(); cleanups.push(d); return () => { if (typeof d === 'function') d(); }; },
};

// A subscriber registered BEFORE the manager activates, exactly like the
// sidebar's own panel list (ctx.slots.subscribe at its activation time). It
// only sees the registry's own notifications, never the manager's revision.
const earlySubscribe = slots.subscribe.bind(slots);
let sidebarRows = [];
const syncPanels = () => {
  sidebarRows = slots.entriesOfSlot('sidebar.panellist').map((r) => r.options.id).sort();
};
earlySubscribe('sidebar.panellist', syncPanels);
syncPanels();

new Function('window', 'localStorage', 'navigator', 'require', code)(windowStub, localStorageStub, navigatorStub, requireStub);
if (loaded === undefined || loaded.id !== 'dsh-plugin-layout') throw new Error('module did not register');
loaded.factory(requireStub).apply(ctx);

const ids = (list) => list.map((r) => r.options.id).join(',');
const assert = (cond, message) => { if (!cond) throw new Error(message); };

assert(ids(slots.host.entriesOfSlot('sidebar.panellist')) === 'early-a,early-b', 'pre-existing entries must stay visible: ' + ids(slots.host.entriesOfSlot('sidebar.panellist')));
console.log('pre-existing visible:', ids(slots.host.entriesOfSlot('sidebar.panellist')));

const textOf = (node) => {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.type === 'function') return textOf(node.type({ ...node.props, children: node.children }));
  return (node.children ?? []).map(textOf).join(' ');
};
const walk = (node, acc) => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, acc)); return acc; }
  acc.push(node);
  (node.children ?? []).forEach((child) => walk(child, acc));
  return acc;
};

const panelEntry = regs.find((r) => r.options.id === 'plugin-layout');
assert(panelEntry !== undefined, 'settings page was not registered');
const render = () => panelEntry.component({});
const text = textOf(render());
assert(text.includes('插件布局') || text.includes('Plugin layout'), 'panel title missing');
assert(text.includes('early-a') && text.includes('early-b'), 'pre-existing rows missing from panel');
console.log('panel text starts:', text.slice(0, 96));

const hideButtons = walk(render(), []).filter((n) => n.type === 'button' && textOf(n) === '隐藏');
assert(hideButtons.length === 3, 'expected 3 hide buttons, got ' + hideButtons.length);

// Both subscription faces must fire on a policy change, otherwise getVersion
// moves while React never re-renders (the "click Hide, nothing happens" bug).
let hostNotified = 0;
let protoNotified = 0;
const stopHost = slots.host.subscribe('sidebar.panellist', () => { hostNotified += 1; });
const stopProto = slots.subscribe('sidebar.panellist', () => { protoNotified += 1; });
assert(typeof stopHost === 'function' && typeof stopProto === 'function', 'subscribe must return a disposer');

hideButtons[0].props.onClick();
assert(hostNotified > 0, 'host.subscribe listeners must fire when the policy changes');
assert(protoNotified > 0, 'ctx.slots.subscribe listeners must fire when the policy changes');
console.log('notifications after hide: host=' + hostNotified + ' proto=' + protoNotified);
assert(slots.host.getVersion('sidebar.panellist') > 0, 'host.getVersion must move with the policy');

const afterHide = ids(slots.host.entriesOfSlot('sidebar.panellist'));
assert(!afterHide.includes('early-a'), 'hidden entry still rendered');
assert(afterHide.includes('early-b'), 'visible entry was filtered away');
console.log('after hide:', afterHide);
// The pre-existing subscriber must have been woken up by the poke, otherwise the
// sidebar keeps a row whose glyph is gone (the reported ghost row).
assert(sidebarRows.join(',') === 'early-b', 'pre-existing subscriber was not notified: ' + sidebarRows.join(','));
console.log('sidebar rows after hide:', sidebarRows.join(','));
stopHost();
stopProto();

const beforeOrder = regs.filter((r) => r.options.name === 'sidebar.panellist').map((r) => [r.options.id, r.options.order]);
const upButton = walk(render(), []).filter((n) => n.type === 'button' && textOf(n) === '↑').find((n) => n.props.disabled !== true);
assert(upButton !== undefined, 'no enabled up button');
upButton.props.onClick();
const afterOrder = regs.filter((r) => r.options.name === 'sidebar.panellist').map((r) => [r.options.id, r.options.order]);
console.log('orders before:', JSON.stringify(beforeOrder), 'after:', JSON.stringify(afterOrder));
assert(JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder), 'reorder did not mutate options.order');

const saved = JSON.parse(storage.get('dsh-plugin-layout:v1') || '{}');
assert(saved.order !== undefined && Object.keys(saved.order).length > 0, 'order policy was not persisted');
assert(saved.hidden !== undefined && Object.keys(saved.hidden).length === 1, 'hidden policy was not persisted');
console.log('persisted:', JSON.stringify(saved));

const shownAgain = walk(render(), []).filter((n) => n.type === 'button' && textOf(n) === '显示');
assert(shownAgain.length === 1, 'hidden row should offer a show button');
shownAgain[0].props.onClick();
assert(ids(slots.host.entriesOfSlot('sidebar.panellist')).includes('early-a'), 'show did not restore the entry');
console.log('after show:', ids(slots.host.entriesOfSlot('sidebar.panellist')));

for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
const restored = ids(slots.host.entriesOfSlot('sidebar.panellist'));
assert(restored.split(',').sort().join(',') === 'early-a,early-b', 'uninstall did not restore filtering: ' + restored);
const restoredOrder = regs.filter((r) => r.options.name === 'sidebar.panellist').map((r) => r.options.order);
console.log('after uninstall:', restored, 'orders:', JSON.stringify(restoredOrder));
assert(restoredOrder[0] === 1 && restoredOrder[1] === 2, 'uninstall did not restore original orders: ' + JSON.stringify(restoredOrder));

console.log('harness OK');
