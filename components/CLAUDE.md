# Settings Navigation

`components/SettingsView.tsx` uses `NAV_GROUPS` — typed array of `{ key: string; ids: readonly string[] }` — for semantic sidebar sections (Writing, AI Models, Appearance & Accessibility, Privacy & Data, Connections, System). When adding a new settings tab: add its `id` to the correct group in `NAV_GROUPS`; do not create a flat ungrouped entry.

# Virtual scrolling

`NavigatorPanel.tsx` uses `useVirtualizer` (`@tanstack/react-virtual`): scrollable `<ul ref={scrollRef}>` + `position: relative`; sentinel `<li>` sets `height: totalSize`; items `position: absolute, transform: translateY(start)`. Items need `data-index` + `ref={measureElement}`. Use `estimateSize: () => 40, overscan: 3`. Never lift `overflow-y: auto` into a parent.
