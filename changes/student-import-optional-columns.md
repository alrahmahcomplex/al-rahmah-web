---
bump: patch
---

### IMPROVED

- The student import needs fewer columns. A file must have Student name, Class, Enrollment year, Parent phone, Visit date and Discount code. Every row needs a value in each of these except Discount code, which may be blank.
- Parent/guardian name, Relationship, Day or boarding, WhatsApp and Status may be left out of the file or left blank. A blank parent name takes the name another row with the same phone gives, or "Parent/guardian" when no row gives one.
- A row with no Visit date is now refused with "Missing visit date", and goes in the skipped-rows file to fix.
