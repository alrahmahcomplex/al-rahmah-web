# What can a pre-filled WhatsApp link carry?

Research for issue #10 (blocks #11, slice 6: **Send through WhatsApp**). Researched 2026-09-25.

Source labels used below:

- **Documented**: stated on a primary source (WhatsApp Help Center, an RFC, WHATWG, a vendor's docs, the ITU). Each has a link.
- **Observed**: I ran it myself from a Windows machine against the live `wa.me` server on 2026-09-25. This shows what the redirect server does. It says nothing about how the WhatsApp app behaves.
- **Unverified**: not documented anywhere I could find. It has to be checked on a real phone (see the last section).

## 1. Link format

**Documented.** The WhatsApp Help Center page "How to use click to chat" gives two forms ([faq.whatsapp.com/5913398998672934](https://faq.whatsapp.com/5913398998672934/?locale=en_US)):

- `https://wa.me/<number>`, "where the `<number>` is a full phone number in international format."
- `https://wa.me/whatsappphonenumber?text=urlencodedtext`, where `urlencodedtext` "is the URL-encoded pre-filled message." The page's example encodes spaces as `%20`: `https://wa.me/1XXXXXXXXXX?text=I'm%20interested%20in%20your%20car%20for%20sale`.
- There is also `https://wa.me/?text=urlencodedtext` with no number. It lets the sender pick a contact.

The same page says "Click to chat works on both your phone and WhatsApp Web". That matters because staff may click the link on an office PC.

**Observed.** `wa.me` answers with an HTTP `302` to `https://api.whatsapp.com/send/?phone=<number>&text=<text>&type=phone_number&app_absent=0`. The redirect re-encodes the text in form style: `%20` comes back as `+` and `*` as `%2A`. The only documented contract is the `wa.me` form, so link to `wa.me` and not to `api.whatsapp.com/send`.

**Unverified.** The `whatsapp://send?phone=…&text=…` app scheme is widely used, but the Help Center page does not document it, so it is left out here.

## 2. Phone numbers (Tanzania, +255)

**Documented, WhatsApp.**

- Click to chat: "Omit any zeroes, brackets, or dashes when adding the phone number in international format." Use `https://wa.me/1XXXXXXXXXX`, not `https://wa.me/+001-(XXX)XXXXXXX` ([click to chat](https://faq.whatsapp.com/5913398998672934/?locale=en_US)).
- "How to add an international phone number" says to "remove any leading 0s or special calling codes" ([faq.whatsapp.com/640432094208718](https://faq.whatsapp.com/640432094208718/?locale=en_US)).

**Documented, numbering plan.**

- ITU Operational Bulletin No. 1248 carries a TCRA communication for +255. It gives national format `0NN XXXXXXX` and international format `+255 NN XXXXXXX`, a 9-digit national significant number (NSN), and `0` as the trunk prefix ([ituob.org/issues/1248-en](https://www.ituob.org/issues/1248-en/)).
- The ITU's copy of Tanzania's numbering plan communication of 1 November 2024 says the NSN is 9 digits and mobile NDCs start with 6 or 7 ([itu.int PDF](https://www.itu.int/dms_pub/itu-t/oth/02/02/T02020000CB0008PDFF.pdf)).
- **Partly verified**: I read this PDF only through a fetch tool that summarises pages, and could not render its tables myself. Before relying on the exact list of mobile NDCs, check it against TCRA's current numbering plan. The TCRA link found by search returns 404.

**Observed.** `wa.me` does not validate the number:

| Input | What `wa.me` did |
|---|---|
| `wa.me/255712345678` | redirected with `phone=255712345678` |
| `wa.me/0712345678` | redirected with `phone=0712345678`, no error. The app would treat this as a foreign number. |
| `wa.me/%2B255712345678` (a `+`) | passed through as `phone=+255…` |
| `wa.me/255-712-345678` | sent to a `resolve/?…&not_found=1` page |

The app therefore has to normalise the number before building the link. `wa.me` will not catch a bad one.

## 3. Length limit of a pre-filled message

**Nothing in WhatsApp's documentation gives a limit.** The click to chat and formatting pages don't mention one. I found no first-party figure for the maximum length of a pre-filled or ordinary message. Figures such as "65,536 characters" circulate in community answers. None of them is backed by WhatsApp, so they are not used here.

**Documented limits that sit around the link:**

- RFC 3986 sets no overall URI length limit. Its only length guidance is for host names, 255 characters (§3.2.2) ([rfc-editor.org/rfc/rfc3986](https://www.rfc-editor.org/rfc/rfc3986.html)).
- RFC 9110 §4.1: "It is RECOMMENDED that all senders and recipients support, at a minimum, URIs with lengths of 8000 octets." A server may answer `414 URI Too Long` (§15.5.15) ([rfc-editor.org/rfc/rfc9110](https://www.rfc-editor.org/rfc/rfc9110.html)).
- Chromium: "Chrome limits URLs to a maximum length of 2MB" ([Chromium URL display guidelines](https://chromium.googlesource.com/chromium/src/+/main/docs/security/url_display_guidelines/url_display_guidelines.md)).
- Android: "The Binder transaction buffer has a limited fixed size, currently 1MB", shared by all transactions in the process. This caps what an intent can carry when the browser hands the URL to the WhatsApp app ([TransactionTooLargeException](https://developer.android.com/reference/android/os/TransactionTooLargeException)).
- iOS: I found no Apple document that states a maximum URL length for universal links or `openURL`. **Unverified.**

**Observed.** I sent GET requests to `wa.me/255712345678?text=…` with Swahili text plus a `✓` in every 9 characters:

| Text length (chars) | Full URL length | Result |
|---|---|---|
| 1,000 | 2,364 | 302 |
| 4,000 | 9,360 | 302 |
| 6,000 | 14,024 | 302 |
| 7,000 | 16,358 | connection failed |
| 8,000 to 32,000 | 18,698 to 74,692 | connection failed |
| 64,000 | 149,364 | 400 |

So the `wa.me` server takes URLs of at least 14 KB and rejects them somewhere between about 14 KB and 16 KB. What limit the WhatsApp app's text box applies after that is not known.

**For comparison.** A realistic result message has a greeting, the child's name in bold, congratulations, three bullets (result, score, next action) and a sign-off. It comes to about 440 characters. That is about 630 characters as a full `wa.me` URL. It is more than 20 times under every limit above, including RFC 9110's 8,000-octet floor.

## 4. Do bold, italics and bullets survive encoding and render?

**Documented formatting syntax.** From "How to format your messages" ([faq.whatsapp.com/539178204879377](https://faq.whatsapp.com/539178204879377/?locale=en_US)), Android tab:

- Italic: underscore on both sides, `_text_`
- Bold: asterisk on both sides, `*text*`
- Strikethrough: `~text~`
- Monospace: three backticks on both sides
- Bulleted list: "place an asterisk or hyphen and a space before each word or sentence", i.e. `* text` or `- text`
- Numbered list: `1. text`
- Quote: `> text`
- Inline code: one backtick on each side

Caveat: the **Web** tab of that page adds "New text formatting is only available on Web and Mac desktop." The Android and Windows tabs do not carry that note. Whether older phone app versions render lists (as opposed to bold and italic) is **unverified**. If they don't, a `- ` bullet still shows as a readable hyphen.

**Encoding is lossless (documented).**

- RFC 3986 §2.3 lists `_`, `-`, `.` and `~` as unreserved. `*` is a sub-delim (§2.2) and is allowed in a query (§3.4) ([RFC 3986](https://www.rfc-editor.org/rfc/rfc3986.html)).
- `encodeURIComponent` leaves `A–Z a–z 0–9 - _ . ! ~ * ' ( )` untouched ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent)). The markers `*`, `_` and `~` therefore go into the URL literally.
- It encodes newline as `%0A`, `•` as `%E2%80%A2`, `%` as `%25`, `&` as `%26`, `#` as `%23` and `+` as `%2B`. Without that encoding, `&` would cut the message short, `#` would start a fragment and `%` would be read as an escape.
- WHATWG's `application/x-www-form-urlencoded` percent-encode set also leaves `*`, `-`, `.` and `_` alone ([url.spec.whatwg.org](https://url.spec.whatwg.org/)). `URLSearchParams` is also safe, apart from the `+` point below.

**Pitfall with `+` (observed).** `wa.me` treated `?text=a+b` the same as `?text=a%20b`: both came back as a space. Only `%2B` survived as a literal plus. WHATWG's form parser works the same way ([URL Standard](https://url.spec.whatwg.org/)). Never build the query by hand-concatenating raw text. `encodeURIComponent` gives `%2B`, which is safe.

**Whether markers render is unverified.** The Help Center shows the syntax but not the edge cases, and the app's parser is not documented. Examples: `*87%*`, bold next to punctuation (`*Amefaulu*!`), bold across a line break, and a `- ` line directly after a bold line. These need a real phone.

## 5. Emoji and Swahili characters

**Documented.** RFC 3986 §2.5: text is "first encoded as octets according to the UTF-8 character encoding" and then percent-encoded ([RFC 3986](https://www.rfc-editor.org/rfc/rfc3986.html)). The WHATWG URL Standard also uses UTF-8 ([URL Standard](https://url.spec.whatwg.org/)). `encodeURIComponent` produces UTF-8 escapes. For example `🎉` becomes `%F0%9F%8E%89` (observed). It throws `URIError` on a lone surrogate ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent)). A lone surrogate can appear if code truncates a string in the middle of an emoji with `.slice()`. Don't truncate the message. If truncation is ever needed, split on code points.

**Swahili.** Standard Swahili spelling uses the plain Latin alphabet with no diacritics, plus the apostrophe in `ng'`. `'` is not escaped by `encodeURIComponent` and is valid in a query. **Not from a primary source:** I did not find an authoritative orthography reference to cite. Names from other languages, such as `é`, and typographic quotes (`’`) are encoded as UTF-8 escapes like any other character.

**Observed.** The redirect from `wa.me` kept `%E2%80%A2` (bullet), `%E2%9C%93` (✓) and `%C3%B1` (ñ) byte for byte. **Unverified:** whether each emoji displays on the parent's phone. That depends on the emoji fonts of the recipient's OS version.

## 6. Does "short WhatsApp link" need a URL shortener?

**No.**

- **Nobody reads the link.** Staff click it inside the app. It opens WhatsApp on the staff device with the text typed in, and what the parent receives is the message text. The URL is never visible to the parent. Its length only has to fit the limits in §3, and at about 630 characters it does, by a wide margin.
- **A shortener adds a third party that holds the data.** A shortener works by storing the full destination URL. Here that URL contains the child's name, result and percentage score in plain text. That data would sit on the shortener's servers, in their logs and analytics, outside the school's control.
- **Tanzanian law.** Tanzania's Personal Data Protection Act, 2022 governs this kind of processing. I did not review the Act for this note. **Flag**: check with whoever handles compliance before any third-party processor handles children's results.
- **Even `wa.me` is a third party (observed).** Following the link sends the query string, with the name and score, over HTTPS to Meta's `wa.me` and `api.whatsapp.com` servers before the app opens. That request is not end-to-end encrypted in the way the message itself is. The URL also lands in the staff browser's history. This is inherent to documented click-to-chat and is the smaller exposure. A shortener would be a second, avoidable copy.

## Recommendation

1. **Link format.** Build `https://wa.me/<digits>?text=<encodeURIComponent(message)>`.
   - Open it with a normal `<a href target="_blank" rel="noopener noreferrer">` when staff click it.
   - Don't use `api.whatsapp.com/send` or `whatsapp://`.
   - Generate the link on demand, not ahead of time, and don't store or log it.

2. **Normalising the phone number.** Store and compare numbers in E.164, in the form `255` followed by 9 digits.
   - Strip spaces, dashes, dots and brackets.
   - Then match:
     - `+255XXXXXXXXX` → drop the `+`
     - `00255XXXXXXXXX` → drop the `00`
     - `255XXXXXXXXX` → keep as is
     - `0XXXXXXXXX` (10 digits) → replace the `0` with `255`
     - `XXXXXXXXX` (9 digits, starting 6 or 7) → prefix `255`
   - The result must match `^255[67]\d{8}$` to be offered as a WhatsApp target.
   - Anything else: show **Send SMS** (copyable text) and flag the number for staff. `wa.me` will not reject a bad number (§2).
   - The same normaliser serves the duplicate-matching rule in `CONTEXT.md`, which says phone formatting is normalised.
   - A number from outside Tanzania (a parent abroad) will fail the check. Handling it needs a decision: either accept an explicit `+<country>` input or fall back to SMS.

3. **Message-length budget.** Keep the message itself **under 1,000 characters**. That is more than twice the realistic draft, and its URL stays under about 2.5 KB, well below RFC 9110's 8,000 octets and the `wa.me` behaviour observed above. Add a unit test that fails if the longest template, filled with a long name, goes over the budget.

4. **Formatting characters.**
   - Use `*bold*` for the child's name, the result and the score, and `_italic_` for warm asides and the sign-off.
   - For bullets use `- ` at the start of a line. It is documented and readable even where lists don't render. Alternatively use a literal `•`, which is always displayed but never styled.
   - Avoid `* ` bullets, which can be confused with bold markers.
   - Put markers directly against the text: no space inside `* *`.
   - Separate lines with `\n`. Always encode with `encodeURIComponent`, never by hand, because of `+`, `%`, `&` and `#`.
   - Emoji are fine, but keep to widely supported ones.

5. **No URL shortener.** It isn't needed and it would expose a child's name and score to another third party (§6). Remove "short" from the glossary wording, or read it as "a single `wa.me` link".

## To check on a real phone before slice 6 ships

Do these with a test number the school owns and invented data only, never records from the admissions workbook.

1. From the office PC (Chrome on Windows), with WhatsApp Desktop installed and without it (web.whatsapp.com), click a generated link. Check that the chat opens to the right number and the text box holds the full message with its line breaks.
2. The same from a staff Android phone, and from an iPhone if any staff use one.
3. Send it. On the receiving phone, confirm that bold and italic render for:
   - `*87%*`
   - bold directly before punctuation
   - bold on the first word of a line
   - a `- ` bullet line directly after a bold line
4. Confirm how `- ` bullets look on an older Android WhatsApp version. Do they render as a list or as a plain hyphen, and is it acceptable either way?
5. Confirm that each emoji in the templates displays on a low-end Android phone of the kind parents use.
6. A number that is not on WhatsApp: record what the app shows, so the UI copy can tell staff what to do. Also a landline-shaped number (`022…`) to confirm the normaliser routes it to **Send SMS**.
7. Send a 1,000-character message, then about 3,000, and confirm nothing is cut off in the text box. This backs the budget with evidence from the app.
8. A name with an apostrophe and one with an accented letter (such as `Ng'ang'a`, `José`), and a message containing `&`, `#`, `+` and `%`. Each must arrive exactly as typed.
9. Confirm the result message never appears in the application's server logs or analytics as part of a URL.
