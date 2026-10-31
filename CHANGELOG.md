# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-30

### Added

- Settings page **插件布局 / Plugin layout** that lists every entry registered
  into `sidebar.panellist`, `sidebar.footer.action`,
  `conversation.session.header.actions`, `conversation.session.header.utilities`,
  `settings.general.item`, `settings.section`, and `conversation.composer.dock`.
- Hide and show an entry, reorder it with the up and down buttons, and restore a
  single slot or everything; the policy is persisted in `localStorage` under
  `dsh-plugin-layout:v1`.
- Read-face takeover of the slot registry, so entries registered before this
  plugin activated are manageable without re-registering them.
- A real registry notification after every policy change, so subscribers that
  subscribed earlier (the sidebar's own panel list in particular) re-read the
  filtered entries instead of keeping a stale row.
- Read-only `未接管 / unmanaged` rows for entries that are not part of the
  managed slots, and a live entry count per slot.

### Known limits

- No moving of an entry between slots.
- Hiding works through the slot registry only; DOM drawn by a plugin inside its
  own container is out of scope.
- One app restart is required after installation to load the Client bundle.
