# Dashboard and Explorer UX Overhaul Plan

## Summary

Rebuild the dashboard, filesystem, and FTP UI around one coherent product shell instead of three different interaction models.

The design direction is based on:

- `uncodixfy` constraints
- responsive shell patterns from web.dev
- dashboard hierarchy and progressive disclosure guidance from UXPin and Pencil & Paper
- consistency and system thinking from Ramotion
- practical UI rules from the referenced book list, especially visual hierarchy, interaction cost, emphasis by de-emphasizing, and restrained use of accent color
- structure and density cues from Codex-LB, NeetCode, LeetCode, Mobbin, Flowbase, and the provided Dribbble dashboards

Locked decisions:

- mobile nav becomes bottom tabs
- dashboard Filesystem tab becomes a drive console only
- full browsing stays on standalone `/files`
- `/files` and FTP remote listing share the same explorer primitives
- the app keeps the current dark olive/graphite theme family, not a blue SaaS palette

## Current Inconsistencies To Fix

### 1. Information architecture

- Navigation changes by wrapping buttons instead of changing layout architecture.
- The dashboard, `/files`, and FTP each use a different page grammar.
- Filesystem is still treated like a tool page, not part of the same product family.
- Page headers are too verbose and not operational enough.

### 2. Visual hierarchy

- Current pages overuse equal-weight cards and subtitles, so priority is weak.
- Title areas are not compact one-line operational headers.
- `Locations` and `Visible entries` are visually unrelated even though they represent the same structure.
- The dashboard mixes inline-style composition with CSS-token composition, which makes consistency fragile.

### 3. Interaction model

- Filesystem is single-select only.
- Row menus are not collision-aware near the viewport edge.
- Clipboard covers actions.
- FTP remote listing is still a table/form workflow while Filesystem is a list explorer workflow.
- Search, details, and path navigation are not separated into clear toolbars.

### 4. Responsive behavior

- The app uses one coarse `isCompact` mode instead of real desktop/tablet/phone shells.
- Filesystem sidebar stays visible on narrow widths where it should become an on-demand surface.
- Nav and action clusters collapse by wrapping, which looks unfinished and wastes space.
- Titles and metadata do not consistently truncate or reflow with intent.

### 5. Motion and polish

- There is no shared motion language.
- Interactive surfaces do not adapt by input type.
- Menus and sheets do not follow a unified overflow strategy.

## Implementation Changes

### 1. Create one shared product shell

Apply this in [DashboardClient.tsx](/data/data/com.termux/files/home/home-server/dashboard/app/DashboardClient.tsx), [page.tsx](/data/data/com.termux/files/home/home-server/dashboard/app/files/page.tsx), and [globals.css](/data/data/com.termux/files/home/home-server/dashboard/app/globals.css).

- Replace the current dashboard shell with 3 explicit modes:
  - desktop `>= 1200px`: fixed left sidebar, 248px
  - tablet `760px–1199px`: compact icon rail, 72px
  - mobile `< 760px`: bottom tab bar, no left rail
- Introduce one shared page header pattern:
  - one-line title
  - compact metadata strip
  - right-aligned primary actions
  - no explanatory subtitle paragraphs by default
- Introduce one shared title-card pattern:
  - dense, rectangular, no hero styling
  - title plus 1 line of context plus optional action cluster
  - stacks vertically on mobile
- Move repeated dashboard inline styles into shared class-based primitives and CSS variables so Filesystem and FTP can actually match.

### 2. Rework dashboard pages to match operational dashboards

- Home page:
  - remove hero-like framing
  - keep one dominant content column and one secondary support column on desktop
  - put the most actionable system state first
  - make graphs secondary, not decorative filler
- Connected users/devices:
  - keep it compact and list-based like LeetCode/NeetCode data surfaces
  - reduce card nesting
- Settings:
  - use simple tabs plus dense forms plus clear section separators
  - avoid oversized cards and headline copy

### 3. Make the dashboard Filesystem tab a drive console

- Remove the embedded full explorer from the dashboard Filesystem tab.
- Show only:
  - drive summary
  - manual drive check
  - drive log toggle
  - recent locations or shortcuts
  - clear CTA to open full `/files`
- Keep all actual file browsing on `/files`.

### 4. Rebuild `/files` as a true explorer

- Keep `/files` standalone, but make it visually part of the same app.
- Replace the current single-toolbar explorer with 2 stacked topbars:
  - Topbar 1:
    - clickable path bar, Windows-style
    - root button
    - `Up`
    - `Refresh`
    - mobile `Locations` trigger
  - Topbar 2:
    - title `Visible entries`
    - folder details or counts
    - search
    - selection and batch actions
- Add a proper visible section title for the entry area.
- Unify `Locations` and visible entries into the same row language:
  - checkbox slot
  - icon slot
  - title
  - metadata
  - trailing details
  - overflow trigger
- On small widths, hide `Locations` by default and show it through a drawer or sheet.
- Add multi-select:
  - row checkbox
  - select-all for visible filtered entries
  - selection count
  - batch `Copy`, `Cut`, `Delete`, `Clear`
- Move clipboard card:
  - desktop and tablet: top-right in the explorer pane
  - mobile: under topbar 2
- Replace bottom-right floating placement entirely.
- Keep share policy editing, but collapse it behind admin-only secondary panels on smaller screens.

### 5. Make FTP remote listing use the same explorer grammar

- Replace the current FTP table with the same explorer structure used by `/files`.
- Keep FTP connection and mount controls, but compress them into denser sections.
- FTP listing gets:
  - Topbar 1: clickable remote path plus `Up`
  - Topbar 2: `Remote entries` plus details plus search plus actions
  - same row density, spacing, menus, and metadata layout as `/files`
- Keep FTP forms and favourites visually subordinate to the listing area.
- Keep primary row action visible and put secondary actions in overflow.

### 6. Standardize menus, sheets, and responsive behavior

- Desktop and tablet menus:
  - anchored popover
  - prefer bottom-end
  - flip upward near viewport bottom
  - shift inside viewport horizontally
- Mobile menus:
  - use action sheet or bottom sheet instead of tiny popovers
- Use `pointer` and `any-pointer` responsive rules:
  - larger targets for coarse input
  - never shrink interactive hit areas just because screen width is larger
- Use reduced motion support and keep animations short:
  - opacity and subtle position only
  - no decorative motion

## Public Interfaces / Contract Changes

- Extend filesystem APIs for batch actions:
  - `POST /api/fs/delete` accepts `path` or `paths`
  - `POST /api/fs/paste` accepts `sourcePath` or `sourcePaths`
- Response shape for batch actions:
  - `successCount`
  - `failureCount`
  - `failures[]`
- No required backend contract change for the dashboard shell refactor.
- No required FTP backend contract change for the first explorer unification pass.

## Execution Order

1. Build the shared shell and token system.
2. Replace dashboard navigation with desktop, tablet, and mobile variants.
3. Convert dashboard page headers and title cards.
4. Turn dashboard Filesystem into drive console only.
5. Rebuild `/files` with the two-topbar explorer and hidden-on-mobile Locations.
6. Add filesystem multi-select and batch actions.
7. Replace menu positioning with one collision-aware system.
8. Move clipboard card and finalize mobile placement rules.
9. Rebuild FTP listing with the same explorer primitives.
10. Tune motion, truncation, spacing, and responsive edge cases.

## Test Plan

- Breakpoints:
  - `360x800`
  - `390x844`
  - `768x1024`
  - `1024x1366`
  - `1280x800`
  - `1440x900`
- Navigation:
  - desktop sidebar
  - tablet rail
  - mobile bottom tabs
  - no wrapped nav rows
- Filesystem:
  - deep path breadcrumb behavior
  - hidden-on-mobile Locations
  - select-all and filtered multi-select
  - batch copy, cut, delete
  - clipboard never covering actions
- Menus:
  - bottom-edge flip
  - horizontal shift
  - mobile sheet fallback
- FTP:
  - remote path navigation
  - consistent row layout with `/files`
  - overflow actions on small screens
- Accessibility:
  - keyboard navigation
  - visible focus
  - coarse-pointer target sizes
  - reduced motion behavior

## Assumptions

- Keep the current dark olive palette family and muted graphite surfaces.
- Keep the current app font unless a repo-local branded font is later introduced.
- Use the provided Dribbble, Mobbin, and Flowbase examples as structural inspiration, not as direct visual cloning.
- The referenced YouTube links were not transcript-accessible through the tool, so the plan relies on accessible written sources plus the observable structure of the linked examples.

## Sources Used

- https://github.com/hendurhance/ui-ux
- https://www.uxpin.com/studio/blog/dashboard-design-principles/
- https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards
- https://www.ramotion.com/blog/frontend-design-patterns/
- https://uxplanet.org/my-favorite-ui-design-books-why-i-love-them-afabaec218f5
- https://web.dev/learn/design/
- https://web.dev/learn/design/interaction
- https://web.dev/learn/design/media-queries
- https://web.dev/articles/building/a-sidenav-component
- https://floating-ui.com/docs/autoplacement
- https://soju06-codex-lb-43.mintlify.app/introduction
- https://neetcode.io/practice/practice/coreSkills
- https://leetcode.com/problemset/
- https://mobbin.com/
- https://www.flowbase.co/blog/top-20-ui-inspiration-sites-2023
- https://dribbble.com/shots/23178378-Video-Sharing-Platform
- https://dribbble.com/shots/21235669-Merchant-dashboard-Overview-page-UI
- https://dribbble.com/shots/14413386-Business-analysis-dashboard
- https://dribbble.com/shots/22903820-Smart-Home-Dashboard
