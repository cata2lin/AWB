---
description: Append a new lesson to CLAUDE.md's Lessons Learned section (self-learning loop)
argument-hint: "<one-line lesson — what to do differently next time, and why>"
---

Append a lesson to the project's CLAUDE.md so future sessions inherit it.

User's lesson: $ARGUMENTS

Steps:

1. Read `CLAUDE.md` and locate the `### Active lessons` subsection under `## Tier 5 — Lessons learned`.

2. Compose a new bullet using today's date (format `YYYY-MM-DD`) and the user's lesson. Pattern:
   ```
   - **YYYY-MM-DD** — <lesson, terse, imperative if possible>. <Optional: why / how to apply.>
   ```

3. Insert the new bullet at the **top** of the list (most recent first), preserving the existing entries below.

4. If today's lesson directly contradicts or replaces an older one, leave the old one and add the new — don't silently delete history. Cross-link in the new bullet if useful.

5. Show me the diff (just the new bullet) so I can confirm it landed correctly.

Do NOT update memory files or any other location — CLAUDE.md is the single source of truth for project lessons.
