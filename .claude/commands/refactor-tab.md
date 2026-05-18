---
description: Apply the analytics-tab extraction pattern to split a large component file
argument-hint: "<absolute path to mega-component> [+ optional notes about what to extract]"
---

Refactor a large frontend component using the same pattern proved on `Analytics.jsx` (3,684 → 241 lines, see 2026-05-18 README changelog entry).

User's target: $ARGUMENTS

Phased approach (each phase is one commit):

1. **Map the file first.** Use the Explore agent or `Grep` to inventory:
   - Top-level identifiers (imports, constants, hooks, the main component)
   - Each "logical section" that could become its own file (tabs, panels, sub-features)
   - State that's truly shared vs state that's local to one section
   - External component dependencies

2. **Get user approval on the plan.** Show:
   - Target directory layout (e.g., `pages/<name>/Section1.jsx`, `pages/<name>/Section2.jsx`)
   - Phase order (start with most isolated, save tangled ones for last)
   - Estimated final line count for the parent

3. **Extract shared helpers first** (Phase 1). Move pure functions (formatters, color helpers, period resolvers) into `utils/<name>Helpers.js`. Zero behavior change. Commit.

4. **Extract one section per phase**, in order of decreasing isolation:
   - Create the new component file under `pages/<name>/`
   - Move state, fetchers, handlers, and JSX
   - Replace the inline block in the parent with `<Section ... />`
   - Use `sed -i 'START,ENDc\REPLACEMENT'` for large JSX block replacements — much cleaner than fighting with Edit's exact-match requirements
   - Verify with `npx eslint <new-file>` (must be 0/0)
   - Commit

5. **Final cleanup phase**. Remove dead imports, unused state, orphaned useEffects. Lint the parent to 0/0. Update the README changelog.

6. **Verify the build**: `cd frontend && npm run build`. Should be 2,000+ modules transformed, no errors. Catches cross-file import problems eslint misses.

Conventions:
- New files: PascalCase ending in the section name (`<Section>Tab.jsx`).
- Each component owns its own state; the parent owns only what truly crosses sections.
- The parent shrinks to a tab router / shell pattern — no business logic.
- Import shared utils from `utils/analyticsHelpers.js` and `utils/authFetch.js` — don't duplicate.

Don't auto-commit unless I tell you to. Show me each phase's diff first.
