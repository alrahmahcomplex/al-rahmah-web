---
bump: patch
---

### FIXED

- Checking in an Admission form family no longer fails when it sends again the "Sibling of" choice of a child that was linked earlier and waits on a Sibling request. The child keeps its request, nothing is asked twice, and the family is checked in.
- On the New Student form, two children who give the same answer for one sibling already on file, including the same "typing mistake" answer, now save together. Before, the second child's answer was refused every time. A name that matches neither spelling is still refused.
