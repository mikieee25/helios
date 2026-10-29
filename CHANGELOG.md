# Changelog

Notable Helios changes, newest first.

## [0.1.6] - 2026-10-29

### Added

- Added a hidden developer console with Helios, aria2, and browser hand-off logs, filters, copy, and export.

### Fixed

- Kept Firefox **Ask before adding downloads** requests queued until the Add dialog is ready.
- Matched excluded hosts against both download URLs and their initiating pages.
- Kept downloads with unknown file sizes in Firefox when a minimum size is configured.
- Added delete and reveal actions to completed download history.

## [0.1.5] - 2026-10-29

### Added

- Added a Stop seeding action that moves stopped torrents to Completed.

### Fixed

- Persisted removed downloads and active seeding torrents across restarts.
- Corrected selected torrent file handling and displayed torrent sizes.
- Added useful aria2 RPC failure details to browser bridge diagnostics.
- Hid scrollbars in the torrent file selection dialog.

## [0.1.4] - 2026-10-29

### Added

- Migrated the bundled transfer engine to aria2-next.
- Added configurable keyboard shortcuts, download search and sorting, a details panel, and undo notifications.

### Changed

- Refined the dashboard, settings layout, chart scaling, and title bar controls.
- Improved download selection and keyboard navigation; animated transfer statistics and row movement.
- Removed the Clear history action and the “New downloads” badges from Files, Network, and Seeding settings.

### Fixed

- Kept transfer rows from shifting during progress refreshes.

## [0.1.3] - 2026-10-27

### Added

- In-app update checks and installation.
- Start with Windows and start minimized to the system tray options.
- Settings for download limits, app behavior, diagnostics, and preferences.

### Changed

- Improved download table actions and transfer chart scaling.
- Reduced latency when the Firefox extension hands downloads to Helios.

## [0.1.2] - 2026-10-26

### Added

- A local browser bridge with pairing and Firefox download handoff.

### Changed

- Refined the Settings layout.

## [0.1.1] - 2026-10-25

### Added

- Automated versioned release builds.

### Fixed

- Set the NSIS installer icon to the Helios app icon.

## [0.1.0] - 2026-10-25

### Added

- Initial Helios desktop release for managing direct downloads and BitTorrent transfers.
- Torrent file selection, download controls, system tray support, and Windows release packaging.

[0.1.6]: https://github.com/mikieee25/helios/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/mikieee25/helios/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/mikieee25/helios/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/mikieee25/helios/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/mikieee25/helios/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mikieee25/helios/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mikieee25/helios/releases/tag/v0.1.0
