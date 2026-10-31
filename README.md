# dsh-plugin-layout

Hide, show, and reorder the entries that other plugins register into the
DeepSeek Harness interface. It is a manager for the sidebar panels, the session
header buttons, and the settings rows - not a plugin of its own.

[中文说明](#中文说明)

## What it does

DeepSeek Harness draws its sidebar, session header, and settings from a slot
registry. Every plugin that wants a button or a row registers an entry into one
of those slots, and until now the only way to get rid of an unwanted entry was
to uninstall the whole plugin.

This plugin reads that registry live and shows every entry it finds:

- **Hide / show** an entry per row. Hiding removes the whole row, not only its
  icon: the entry stops being registered for as long as it is hidden.
- **Reorder** with the up and down buttons. The order is stored as a number and
  written back into the entry options, so it survives re-renders and plugin
  reloads.
- **Restore** one slot or everything. Hiding and ordering are kept in
  `localStorage` under the key `dsh-plugin-layout:v1` and can be cleared from
  the same page.
- Entries registered by plugins that are not managed (or that appear after this
  plugin activated) are listed read-only as `未接管 / unmanaged`, so the page
  always reflects what is really mounted.

Open it from **设置 → 插件布局** (Settings → Plugin layout).

## Slots it manages

`sidebar.panellist`, `sidebar.footer.action`,
`conversation.session.header.actions`, `conversation.session.header.utilities`,
`settings.general.item`, `settings.section`, `conversation.composer.dock`.

## How it works

The plugin patches the read faces of the slot registry (`entriesOfSlot`,
`entries`, `getVersion`, `subscribe`) on both the public service and its host
face, then filters and re-sorts the entries those reads return. It does not
re-create components and does not call `unregister` on entries it does not own,
so plugins keep their own lifecycle.

Because filtering is read-side, a policy change would not normally notify
anybody. To make existing subscribers (the sidebar list, the renderer's list
outlets) re-read the filtered list, the plugin registers a throwaway entry and
disposes it again in the same tick. That is a real registry mutation, so the
notification reaches subscribers that subscribed before this plugin loaded -
including the sidebar's own panel list. The throwaway entry is never visible in
the UI.

## Limits, on purpose

- **No moving between slots.** An entry is owned by the plugin that registered
  it, and different slots pass different props (the sidebar panel row passes a
  glyph size, the header action passes a dense layout). Moving a registration
  into another slot would render the component with props it was not written
  for.
- **List slots only.** The throwaway notification is skipped for `single` and
  `keyed` slots, where a temporary entry could shadow the real occupant for a
  frame.
- **Entries, not DOM.** Anything a plugin draws inside its own container (for
  example a widget that renders its own chrome) is outside the slot registry and
  cannot be hidden from here.
- The plugin needs one app restart after installation to load its Client half.

## Install

The package is not on npm yet, so install it from GitHub:

```bash
dsh plugin --profile desktop add github:yukingm/dsh-plugin-layout
```

Pin a tagged release instead of following `main`:

```bash
dsh plugin --profile desktop add github:yukingm/dsh-plugin-layout#v0.1.0
```

`dsh plugin` forwards its arguments to `pnpm` inside the profile directory, so
any pnpm specifier works (`github:owner/repo#tag`, `file:path`, a published
package name). The command adds the dependency to the profile `package.json`
and appends the package to `dsh.profile.bundles`.

Then restart the desktop app once: the Client half (`client.js`) is a browser
bundle that is loaded at startup. Afterwards open **设置 → 插件布局**
(Settings → Plugin layout).

Uninstall:

```bash
dsh plugin --profile desktop remove dsh-plugin-layout
```

While developing, install the working tree itself. pnpm links the folder, so a
later edit to `client.js` is picked up by the client HMR watcher and only the
first install needs the app restart:

```bash
dsh plugin --profile desktop add E:\my\code\dsh_plugin\dsh-plugin-layout
```

## Development

```bash
node --check index.js && node --check client.js
node test/harness.mjs    # fake Client runtime: filtering, notification, reorder, restore
node test/manifest.mjs   # marketplace pre-flight: dsh.bundle, patch, locales, icons
python scripts/make-icons.py   # regenerate assets/icon-*.png (Pillow)
```

The harness fakes `window.__ModuleLoader__`, `localStorage`, `react`, and a slot
registry with a pre-existing subscriber, so the notification behaviour is tested
without the desktop app.

## 中文说明

这是一个管理其他插件界面的插件。DeepSeek Harness 的侧栏、会话标题栏和设置页都
由插槽注册表渲染, 其他插件往这些插槽里注册入口, 以前想去掉一个不顺眼的入口只能
把整个插件卸载。本插件直接读取注册表, 把找到的入口逐条列出来:

- **隐藏 / 显示**: 隐藏时整行都不注册, 不是只隐藏图标。
- **排序**: 上下箭头调整顺序, 顺序写回入口的 `order`, 重新渲染和插件重载后仍然有效。
- **恢复**: 单个插槽或全部恢复。策略保存在 `localStorage` 的
  `dsh-plugin-layout:v1` 里, 可以在同一页面清空。

入口在 **设置 → 插件布局**。不受管理的条目会以 `未接管` 只读列出, 所以页面显示的
始终是当前真正挂载的内容。

已知边界: 不支持把入口从一个插槽搬到另一个插槽(每个入口属于注册它的插件, 而且不同
插槽传入的 props 不同); 只处理注册表里的入口, 插件自己在容器里画的东西管不到; 安装后
需要重启一次应用才能加载 Client 部分。

## 安装

还没上 npm, 直接从 GitHub 装:

```bash
dsh plugin --profile desktop add github:yukingm/dsh-plugin-layout
```

要锁定版本就带上标签:

```bash
dsh plugin --profile desktop add github:yukingm/dsh-plugin-layout#v0.1.0
```

`dsh plugin` 把参数原样转给 profile 目录里的 `pnpm`, 所以 `github:`, `file:` 和
npm 包名都行; 它会把依赖写进 profile 的 `package.json`, 并把本包加进
`dsh.profile.bundles`。装完重启一次桌面应用(Client 部分是启动时加载的浏览器
bundle), 之后打开 **设置 → 插件布局**。

卸载:

```bash
dsh plugin --profile desktop remove dsh-plugin-layout
```

开发时直接装工作目录, pnpm 会做 link, 之后改 `client.js` 由 HMR 接管, 只有第一次
安装需要重启:

```bash
dsh plugin --profile desktop add E:\my\code\dsh_plugin\dsh-plugin-layout
```

## License

MIT
