# UI component library

The application and the authenticated `#ui` gallery import `src/web/ui/index.tsx`. The gallery uses local sample data, not production records. Open it from Settings → Appearance and app → Component library.

## Sources of truth

- `ui/tokens.css`: existing three brand themes plus control dimensions, radii, spacing and motion. `ui/foundation.css` imports these tokens; do not duplicate their values.
- `ui/index.tsx`: supported components and layouts. Select/Modal/Check behaviors live in private `ui/primitives.tsx`; consumers use only the public entry.
- `ui/ui.css`: component appearance and content constraints. Pages must not target `.ui-*` internals or supply inline appearance overrides.
- `environments-page.tsx`: migrated collection and detail pages using real environment data and unchanged API/permission contracts.

## Usage and content contracts

Use Button variants `primary`, `secondary`, `ghost`, `danger`; default type is `button`, forms must specify `submit`. IconButton requires a label. Agent controls use shared SVG icons; full access includes a visible warning marker, not color alone. Send uses ArrowUp; thinking uses Brain.

Select's closed value truncates within the parent width; the open list wraps the complete labels. `searchable` retains the input and focus when the keyboard changes the visible viewport. Actions belong in ActionMenu, not a Select. FormField associates labels, help and validation errors; groups use fieldset/legend, never nested labels.

EntityCard has a two-line title, separately allocated status/actions and a full-detail entry. Metadata wraps long values; Disclosure exposes complete paths and text on touch devices. Errors and authorization scope must not be line-clamped. CollectionLayout owns page spacing, header and toolbar; CardGrid responds to its container, not only the screen.

Do not shrink touch targets below 44px on mobile. Active feedback follows the component radius and does not move the element. Focus remains visible for keyboard users. Labels, errors and accessible names use the shared Chinese/English message catalog.

## Checks

`npm run check:ui` rejects raw controls, legacy control classes, legacy primitive imports and inline styles in every business TSX file; it rejects shared component selectors outside the library and new literal colors outside the token source. `typecheck` and `build` run it. There are no legacy exemptions. All CSS belongs under `src/web/ui/`. The check is not a complete CSS semantic verifier: review component internals and finite variant APIs.

`test/ui-library-browser.spec.ts` exercises the real authenticated application, gallery, long content, filtering, keyboard input, dialogs, three themes and two languages. Screenshot baselines use Node 24.19.0, Playwright 1.65.0 and Chromium revision 1254 on Linux (Playwright v1.62.1-noble container libraries, explicit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). Keep the same browser, fonts and device scale when comparing. The 60 images cover actions, forms, Agent controls, environment collections and content contracts in three themes, two languages and desktop/mobile widths. Run `npm run test:ui` for regression comparison. Baseline creation/update is an explicit `--update-snapshots` operation, never a build step; review the diff before accepting. The initial baseline is the UAT candidate, pending human visual acceptance. Font rendering across operating systems is not promised to be byte-identical.

## Migration scope

Migrated: application navigation, workbench, sessions and project management, boards and task editors, agents, environments and file browsing, settings, authentication/setup, gallery, and connector local console. React consumers import controls and layouts through `ui/index.tsx`. Existing business/API/permission behavior is preserved.

`ui/controls.tsx` provides finite navigation/surface variants, file and range fields, attachment picker and link actions. `ui/layouts.tsx` owns form grids, toolbars, settings panels, conversations/composers, board and application layout. Domain layout styles remain separate modules inside the library; change common geometry and appearance here, never with page-local overrides. New variants require a library API and a gallery example.

The connector console keeps its standalone runtime. `scripts/sync-ui.mjs` generates `src/shared/ui-styles.ts` from shared tokens, console layout and component CSS. Run `npm run sync:ui` after changing these styles; `check:ui` rejects stale generated output. Rebuild portable connector packages for console changes.

For changes: adjust tokens or a finite component variant, demonstrate long Chinese/English values and mobile behavior in the gallery, run typecheck/tests/build and relevant business browser tests plus strict screenshot comparison, inspect every changed screenshot, then publish the candidate to UAT for human acceptance. Do not update snapshots merely to make a failing test green. Browser regression protects fixed-environment pixels; actual mobile keyboard behavior and production-shaped content still need UAT acceptance.

No GitLab Runner is assumed. Run and record checks before UAT deployment; pushing code alone is not CI evidence. The UI library contains no production data, credentials or private deployment addresses.


## Density and borderless selects

Session rows are 36px on desktop and 44px below 760px, with a 3px gap. Measure the entire row including its action menu, not only the title button. Container spacing must not leak into nested controls; bulk actions may wrap independently.

Use `Select variant="ghost"` for model and language choices. It removes the resting border and background while preserving the dropdown indicator, hover/open feedback, focus outline, disabled state, keyboard behavior and full labels in the popup. Other form choices default to `outlined`.


## Checkbox contrast and compact boards

Checkboxes use the theme primary fill and matching foreground SVG tick. Selected foreground/fill contrast must reach 4.5:1 across all three themes; keyboard focus remains explicit and unchecked boxes keep their outline.

`BoardHeader` keeps title/edit, board switch and the primary add-item icon on one row. `BoardToolbar` keeps search, archived toggle and an action menu on one row; copy and delete live in that menu. Board creation belongs to the collection page. On portrait mobile, the distance from the header top to the lanes must stay within 180px for normal status, in both languages; controls retain 44px touch targets. Flow configuration and business permission behavior are preserved.


## Mobile cards and user messages

Agent selector cards keep a non-shrinking basis on mobile; the list scrolls horizontally without widening the page. Text keeps its own shrinkable column beside the avatar. Generic surface rules must not collapse these cards into equal narrow columns.

Composer icon buttons use the same control token for width, height and both minimum dimensions (44px on phones). Narrow layouts may reduce gaps or collapse configuration, never squeeze the send/stop hit targets.

User messages share the same muted bubble fill, radius and padding for plain text (workbench) and Markdown (environment sessions), including optimistic and persisted messages. Markdown, attachments and file links retain their behavior; long code/tables scroll inside the content width.


## Unified conversation header

Both workbench and environment sessions use ConversationHeader: title and one-line subtitle on the left, status and available actions on the right, with the mobile sidebar trigger in the same row. The workbench subtitle shows model and permission; the environment subtitle shows environment and project directory. Runtime and permission remain in environment session details and composer configuration. Do not add a third metadata row.

Long titles/subtitles truncate within their text column and cannot push status/actions outside the viewport. Normal headers stay within 72px. The environment menu exposes full title, environment, path, runtime and permissions, and keeps archive/delete disabled during execution. Workbench compression remains a workbench capability, not a decorative button on environment sessions. The gallery uses the same layout; changes to its geometry must apply to both applications.

## Board flow configuration

Use `FlowLayout` with the overview, stage title and detail, and whole-flow actions. Desktop keeps the overview and detail independently scrollable. At 760px and below, the same detail and actions fill the viewport. Use the `flowStage` surface for selectable cards and `FlowDiagram` to place a desktop route overlay alongside those cards. The board owns its stage data, directional routes and draft. The gallery's Flow configuration section demonstrates the shared layout with the long-content toggle.
