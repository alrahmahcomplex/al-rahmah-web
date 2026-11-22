---
bump: minor
---

### NEW

- "Umesahau nenosiri?" takes an email or a mobile number (#503). An email still gets a reset link. A mobile gets an SMS with a 6-digit confirmation number, typed into six boxes that check it by themselves, then a new password, then the students page. The reply is the same whether or not the number has an account.
- The Design system page has the confirmation-number boxes.
- Supabase's SMS goes through the school's own sender: only a Discount code holder's login is texted, with the school's words, inside the daily SMS budget.
