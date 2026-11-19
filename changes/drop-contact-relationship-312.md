---
bump: patch
---

### FIXED

- A child given their own relationship to the parent or guardian, such as Aunt while the same person is Mother to a sibling, now shows that relationship on the applicant page, in Export and when checking in an Admission form family. Before, it showed the one the parent was first registered with.
- Correcting the relationship under "Edit parent or guardian" now changes this child and the siblings who had the same relationship, and leaves a sibling with a different one alone.
- The student import keeps each row's relationship when several children share one parent, so Export and a later import give back the same relationship for each child.
