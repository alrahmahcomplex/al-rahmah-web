---
bump: patch
---

### FIXED

- Home's **Interviews today** and **Applied this week** cards now count every record on its own day, imported or entered here, whatever admission year the child is applying for:
  - **Interviews:** every child given an S/N counts, with a result or not, on the day of the result, or the day the S/N was given before there is one. Until it has a result, an imported interview counts on the child's visit date from the file, never the day of the import.
  - **Applications:** every student counts on the day they were registered, or for an imported student, on the visit date from the file.
  - An imported record whose file gave no visit date has no day of its own, so it is not counted on any day, and an import never fills today's cards.
  - Picking a past day or week shows that day's or week's own numbers. The charts' admission year does not change the cards.
