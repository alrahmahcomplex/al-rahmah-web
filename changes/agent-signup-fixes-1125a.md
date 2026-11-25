---
bump: minor
---

### IMPROVED

- Discount code sign-up: each answer now sits under its question, with the Change link small on the question's line. One "Discount code" row shows the code, or "None", and its Change Code link opens the Yes/No question.
- Choose how to sign in, Check your SMS and Set password now look as the approved design draws them: an icon on top, the office's number at the foot, a full-width Send again button, and "You'll sign in with" and the mobile on Set password. The SMS screen has a new icon: a message with three stars.
- The security check on Send and Set password stays out of sight. Tapped before it has finished, the button says "Sending…" or "Saving…" and the form goes on by itself once it passes. Only a slow check (after 20 seconds) or one that didn't load says anything, and then it tells the person to press Run the check again and that their progress is saved.
- A reload on Choose how to sign in, Check your SMS or Set password comes back to that step instead of the first question.
- The sign-in card is wider (400px instead of 325px), with the fields and buttons only a little wider and more white space around them.

### FIXED

- Someone who typed a Discount code the office hasn't approved yet was asked for an email before choosing how to sign in. They now go straight to the choice, as a new agent does; the email is asked only on the email path.
- The six boxes for the SMS confirmation number ran past the card's edge on a phone, on the agent sign-up and the reset-password screens. They now share the card's width and stay centred.
