/**
 * Plugin Layout — scan the Harness Web UI Slot registry and let the user hide,
 * show, or reorder the entries other plugins register.
 *
 * Takeover point: the renderer reads entries through the slot registry's read
 * faces (`entries` / `entriesOfSlot`), not through `register`. So this plugin
 * filters those reads instead of owning registrations: it can therefore manage
 * entries registered long before it activated, with no restart and no
 * dependence on bundle order. Reordering writes `options.order`, which is
 * exactly what list slots sort by. Nothing here touches another plugin's
 * source, its disposer, or the DOM.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-layout',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const STORE_KEY = 'dsh-plugin-layout:v1';
    const OWN_ID = 'plugin-layout';
    /** Reserved id of the throwaway entry that only exists to bump slot versions. */
    const POKE_ID = '__dsh-plugin-layout-poke__';
    const isPoke = (entry) => entryId(entry) === POKE_ID;

    /** Slots this manager lists. Each one is a third-party-friendly seat. */
    const MANAGED_SLOTS = [
      'sidebar.panellist',
      'sidebar.footer.action',
      'conversation.session.header.actions',
      'conversation.session.header.utilities',
      'settings.general.item',
      'settings.section',
      'conversation.composer.dock',
    ];

    const SLOT_TITLES = {
      'sidebar.panellist': ['左栏 · 面板入口', 'Sidebar · panel rows'],
      'sidebar.footer.action': ['左栏 · 底部动作', 'Sidebar · footer actions'],
      'conversation.session.header.actions': ['标题栏 · 动作按钮', 'Header · actions'],
      'conversation.session.header.utilities': ['标题栏 · 工具区', 'Header · utilities'],
      'settings.general.item': ['设置 · 通用列表', 'Settings · general rows'],
      'settings.section': ['设置 · 分区', 'Settings · sections'],
      'conversation.composer.dock': ['输入框下方', 'Composer dock'],
    };

    const isZh = /^zh/i.test(navigator.language || '');
    const T = (zh, en) => (isZh ? zh : en);
    const slotTitle = (name) => {
      const pair = SLOT_TITLES[name];
      return pair === undefined ? name : T(pair[0], pair[1]);
    };

    /** Persisted policy: { hidden: { [key]: true }, order: { [key]: number } }. */
    const store = { hidden: {}, order: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        if (raw.hidden && typeof raw.hidden === 'object') store.hidden = raw.hidden;
        if (raw.order && typeof raw.order === 'object') store.order = raw.order;
      }
    } catch {
      /* a corrupt preference just falls back to defaults */
    }
    const save = () => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch {
        /* storage may be unavailable; keep the in-memory policy */
      }
    };

    /** Render revision: bumping it re-renders everyone reading slot versions. */
    const listeners = new Set();
    let revision = 0;
    const onRevision = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const getRevision = () => revision;
    const bump = () => {
      revision += 1;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* one broken subscriber must not stop the rest */
        }
      }
    };

    const entryId = (entry) => entry?.options?.id;
    const policyKey = (slot, entry) => {
      const id = entryId(entry);
      return slot + '::' + (id === undefined || id === null ? '(no-id)' : String(id));
    };
    const entryLabel = (entry) => {
      const label = entry?.options?.label;
      if (typeof label === 'function') {
        try {
          const text = label();
          if (typeof text === 'string' && text.length > 0) return text;
        } catch {
          /* locale-only labels fall through to the id */
        }
      }
      if (typeof label === 'string' && label.length > 0) return label;
      const id = entryId(entry);
      return id === undefined || id === null ? T('(未命名)', '(unnamed)') : String(id);
    };
    const ownEntry = (slot, entry) => slot === 'settings.section' && entryId(entry) === OWN_ID;

    /** Original `order` per entry, captured before this plugin ever writes one. */
    const originals = new Map();
    let registry;
    let host;
    let base;

    const remember = (slot, entry) => {
      const key = policyKey(slot, entry);
      if (!originals.has(key)) originals.set(key, entry?.options?.order);
      return key;
    };

    /**
     * Throwaway registration used only to make the registry announce a change.
     * Filtering a read does not touch the registry version, so long-lived
     * subscribers that registered before this plugin activated (the sidebar's
     * own panel list subscribes at its activation) would never be called; a
     * register+dispose pair bumps the version for them and is filtered out
     * everywhere before anyone can see it.
     */
    const poke = (slot) => {
      let spec;
      try {
        spec = registry.spec(slot);
      } catch {
        spec = undefined;
      }
      /* Only additive slots tolerate a throwaway neighbour; a single/keyed seat
         would be shadowed for one frame. */
      if (spec !== undefined && spec.kind !== 'list') return;
      let dispose;
      try {
        dispose = registry.register({ name: slot, id: POKE_ID, order: 1e6, label: () => '' }, () => null);
      } catch {
        return;
      }
      try {
        if (typeof dispose === 'function') dispose();
      } catch {
        /* the registry may already have dropped it */
      }
    };

    /** Hide-filter one read result. Unmanaged slots pass through untouched. */
    const filterList = (slot, list) => {
      if (!MANAGED_SLOTS.includes(slot) || list === undefined || list === null) return list;
      const kept = [];
      for (const entry of list) {
        if (isPoke(entry)) continue;
        const key = remember(slot, entry);
        if (ownEntry(slot, entry) || store.hidden[key] !== true) kept.push(entry);
      }
      return kept;
    };

    /** Apply an order to one entry, tolerating frozen option objects. */
    const writeOrder = (entry, order) => {
      try {
        entry.options.order = order;
        return true;
      } catch {
        return false;
      }
    };

    /** Every entry the registry holds for a slot, unfiltered (manager's own view). */
    const rawEntries = (slot) => {
      try {
        return Reflect.apply(base.protoEntriesOfSlot, registry, [slot]) ?? [];
      } catch {
        return [];
      }
    };

    const manageSlot = (slot) =>
      rawEntries(slot)
        .filter((entry) => !ownEntry(slot, entry) && !isPoke(entry))
        .map((entry) => ({ entry, key: remember(slot, entry) }));

    const registryVersion = () => {
      let sum = revision;
      for (const slot of MANAGED_SLOTS) {
        try {
          sum += Reflect.apply(base.protoGetVersion, registry, [slot]) ?? 0;
        } catch {
          /* slot has no version yet */
        }
      }
      return sum;
    };

    const subscribeRegistry = (listener) => {
      const offs = [];
      for (const slot of MANAGED_SLOTS) {
        try {
          const off = Reflect.apply(base.protoSubscribe, registry, [slot, listener]);
          if (typeof off === 'function') offs.push(off);
        } catch {
          /* slot has no subscribers yet */
        }
      }
      return () => {
        for (const off of offs) {
          try {
            off();
          } catch {
            /* already released */
          }
        }
      };
    };

    const toggleEntry = (slot, entry) => {
      const key = remember(slot, entry);
      if (store.hidden[key] === true) delete store.hidden[key];
      else store.hidden[key] = true;
      save();
      poke(slot);
      bump();
    };

    const moveEntry = (slot, entry, direction) => {
      const rows = manageSlot(slot);
      const index = rows.findIndex((row) => row.entry === entry);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rows.length) return;
      rows.splice(index, 1);
      rows.splice(target, 0, { entry, key: policyKey(slot, entry) });
      rows.forEach((row, position) => {
        const order = (position + 1) * 10;
        if (writeOrder(row.entry, order)) store.order[row.key] = order;
      });
      save();
      poke(slot);
      bump();
    };

    const resetSlot = (slot) => {
      for (const { entry, key } of manageSlot(slot)) {
        delete store.hidden[key];
        delete store.order[key];
        const original = originals.get(key);
        if (original !== undefined) writeOrder(entry, original);
      }
      save();
      poke(slot);
      bump();
    };

    /** Re-apply persisted orders (cheap, idempotent; runs when policy changes). */
    const applyOrders = () => {
      for (const slot of MANAGED_SLOTS) {
        for (const { entry, key } of manageSlot(slot)) {
          const saved = store.order[key];
          if (typeof saved === 'number' && Number.isFinite(saved)) writeOrder(entry, saved);
        }
      }
    };

    const install = (slots) => {
      registry = slots;
      host = typeof slots.hostFace === 'function' ? slots.hostFace() : undefined;
      if (host === undefined) return () => {};
      const proto = Object.getPrototypeOf(slots);
      base = {
        hostEntriesOfSlot: host.entriesOfSlot,
        hostEntries: host.entries,
        hostGetVersion: host.getVersion,
        hostSubscribe: host.subscribe,
        protoEntriesOfSlot: proto.entriesOfSlot,
        protoGetVersion: proto.getVersion,
        protoSubscribe: proto.subscribe,
      };
      const patchedHostEntriesOfSlot = function entriesOfSlot(key) {
        return filterList(key, Reflect.apply(base.hostEntriesOfSlot, this, [key]));
      };
      const patchedHostEntries = function entries(key) {
        return filterList(key, Reflect.apply(base.hostEntries, this, [key]));
      };
      const patchedHostVersion = function getVersion(key) {
        return (Reflect.apply(base.hostGetVersion, this, [key]) ?? 0) + revision;
      };
      const patchedProtoEntriesOfSlot = function entriesOfSlot(key) {
        return filterList(key, Reflect.apply(base.protoEntriesOfSlot, this, [key]));
      };
      const patchedProtoVersion = function getVersion(key) {
        return (Reflect.apply(base.protoGetVersion, this, [key]) ?? 0) + revision;
      };
      // Policy changes must reach React through the same channels the slots
      // already use, otherwise getVersion moves but nobody re-renders: the list
      // slot subscribes with host.subscribe(key, fn) and the sidebar with
      // ctx.slots.subscribe(key, fn), so both faces forward to our revision.
      const patchedHostSubscribe = function subscribe(key, listener) {
        const offCore = Reflect.apply(base.hostSubscribe, this, [key, listener]);
        const offPolicy = onRevision(listener);
        return () => {
          offPolicy();
          if (typeof offCore === 'function') offCore();
        };
      };
      const patchedProtoSubscribe = function subscribe(key, listener) {
        const offCore = Reflect.apply(base.protoSubscribe, this, [key, listener]);
        const offPolicy = onRevision(listener);
        return () => {
          offPolicy();
          if (typeof offCore === 'function') offCore();
        };
      };
      host.entriesOfSlot = patchedHostEntriesOfSlot;
      host.entries = patchedHostEntries;
      host.getVersion = patchedHostVersion;
      host.subscribe = patchedHostSubscribe;
      proto.entriesOfSlot = patchedProtoEntriesOfSlot;
      proto.getVersion = patchedProtoVersion;
      proto.subscribe = patchedProtoSubscribe;
      applyOrders();
      return () => {
        if (host.entriesOfSlot === patchedHostEntriesOfSlot) host.entriesOfSlot = base.hostEntriesOfSlot;
        if (host.entries === patchedHostEntries) host.entries = base.hostEntries;
        if (host.getVersion === patchedHostVersion) host.getVersion = base.hostGetVersion;
        if (host.subscribe === patchedHostSubscribe) host.subscribe = base.hostSubscribe;
        if (proto.entriesOfSlot === patchedProtoEntriesOfSlot) proto.entriesOfSlot = base.protoEntriesOfSlot;
        if (proto.getVersion === patchedProtoVersion) proto.getVersion = base.protoGetVersion;
        if (proto.subscribe === patchedProtoSubscribe) proto.subscribe = base.protoSubscribe;
        for (const slot of MANAGED_SLOTS) {
          for (const { entry, key } of manageSlot(slot)) {
            const original = originals.get(key);
            if (original !== undefined) writeOrder(entry, original);
          }
        }
      };
    };

    // ── settings page ────────────────────────────────────────────────────────
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid rgba(127,127,127,0.18)',
    };
    const buttonStyle = {
      font: 'inherit',
      fontSize: 12,
      lineHeight: '20px',
      padding: '0 8px',
      borderRadius: 6,
      border: '1px solid rgba(127,127,127,0.35)',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
    };
    const dim = { opacity: 0.6, fontSize: 12 };

    function LayoutPanel() {
      React.useSyncExternalStore(onRevision, getRevision, getRevision);
      React.useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);
      if (registry === undefined || base === undefined) {
        return h('div', { style: dim }, T('槽位服务还没就绪。', 'The slot service is not ready yet.'));
      }
      const groups = MANAGED_SLOTS.map((slot) => ({ slot, rows: manageSlot(slot) })).filter(
        (group) => group.rows.length > 0,
      );
      const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, T('插件布局', 'Plugin layout')),
        h(
          'div',
          { style: dim },
          T(
            '这份列表读运行时注册表，接管的是读取面：激活之前注册的条目同样可隐藏、可排序。',
            'This list reads the live registry through its read faces, so entries registered before this plugin activated are manageable too.',
          ),
        ),
        h('div', { style: { ...dim, marginTop: 4 } }, T(`当前共 ${total} 条受管条目。`, `${total} managed entries.`)),
        groups.length === 0
          ? h(
              'div',
              { style: { ...dim, padding: '10px 0' } },
              T('受管槽位里目前没有条目。', 'No entries in the managed slots yet.'),
            )
          : null,
        ...groups.map(({ slot, rows }) =>
          h(
            'div',
            { key: slot, style: { marginTop: 10 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              h(
                'div',
                { style: { fontSize: 13, fontWeight: 600 } },
                slotTitle(slot),
                h('span', { style: { ...dim, marginLeft: 6 } }, T(`${rows.length} 条`, `${rows.length} entries`)),
              ),
              h('button', { type: 'button', style: buttonStyle, onClick: () => resetSlot(slot) }, T('全部恢复', 'Reset all')),
            ),
            h('div', { style: dim }, slot),
            ...rows.map(({ entry, key }, index) => {
              const hidden = store.hidden[key] === true;
              return h(
                'div',
                { key, style: rowStyle },
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  entryLabel(entry),
                  h('span', { style: { ...dim, marginLeft: 6 } }, String(entryId(entry) ?? '')),
                  hidden ? h('span', { style: { ...dim, marginLeft: 6 } }, T('已隐藏', 'hidden')) : null,
                ),
                h(
                  'button',
                  { type: 'button', style: buttonStyle, onClick: () => toggleEntry(slot, entry) },
                  hidden ? T('显示', 'Show') : T('隐藏', 'Hide'),
                ),
                h(
                  'button',
                  { type: 'button', style: buttonStyle, disabled: index === 0, onClick: () => moveEntry(slot, entry, -1) },
                  '↑',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: buttonStyle,
                    disabled: index === rows.length - 1,
                    onClick: () => moveEntry(slot, entry, 1),
                  },
                  '↓',
                ),
              );
            }),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const uninstall = install(ctx.slots);
        ctx.effect(() => uninstall);
        ctx.slots.inject('settings.section', () => {
          return ctx.slots.register(
            { name: 'settings.section', id: OWN_ID, order: 95, label: () => T('插件布局', 'Plugin layout') },
            LayoutPanel,
          );
        });
      },
    };
  },
});
