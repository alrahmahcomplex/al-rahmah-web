---
bump: minor
---

### IMPROVED

- Home's charts now count every applicant for the current admission year, by the year they enrol in. From 1 June that is next year's admissions. Imported records count too:
  - **Sources:** an imported record with a code counts under its agent's Discount code or Promo code. One with no code goes in a new slice, **Earlier records**, which appears only when there are some.
  - **Months:** the columns run from June to this month. An imported record counts in the month of its own visit date from the file, so an import never piles up in the month it ran. Applicants dated before June share one first column, **Before Jun**, so the columns add up to the total.
  - **Classes:** every applicant for the year, imported records included.
