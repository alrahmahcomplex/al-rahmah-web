# 8. Seats are held in streams, placed automatically under one seat lock

Date: 2026-11-18

## Status

Accepted. The owner approved prototype v41 and answered the brief's questions on 2026-11-17 and 2026-11-18 (#449, brief section 14). The tables and functions came in `20270104100100_streams.sql` and `20270107100100_streams_block.sql`, switched off. `20270113100100_streams_activation.sql` moved the seats set until then into streams and switched them on. Replaces counting seats per class and Day or Boarding (`class_seats`, `20261026900600_seats.sql`).

## Context

Seats were one count per class, Enrollment year and Day or Boarding. A full class only warned: the Accountant could still record the payment, and the Seats screen ranked who was over. The school teaches in groups inside a class ("Form 1 A", "Form 1 B"), some for boys, some for girls, some for both. Families pay to hold a place, and the owner wants a payment refused when no group can take the child, rather than taken and sorted out later. Day or Boarding only sets the fee.

## Decision

**Streams.** A stream is a group of one class and Enrollment year: a label shown after its class ("FORM 1 A"), who it takes (Boys, Girls or Mixed), seats and an order. Seats are the places for new students that year, not the stream's size. A Boys and a Girls stream may share a label; Mixed shares with neither. A class with no streams in a year has no limit. The Admissions Manager (`academic_years.manage`) opens, edits and brings up streams. Seats never go below the children placed; who a stream takes and its order never change, and a stream is never closed.

**Placement is automatic and stored.** A child holding a Seat priority is placed in the first stream of their class and year, in order, that takes them and has a free seat. A child with no Boy or Girl answer fits Mixed streams only. Nobody picks the stream. The placement is stored (`seat_placements`), so a child keeps their stream when someone else is declined and is never moved to tidy up. A child who holds a priority but has no seat waits. Children already waiting are served before anyone else, in today's ranking order.

**A seat is booked by the Seat priority** (owner's answer to Q33, A, and its follow-up). Normally that is the minimum deposit; on a fee discounted below it, the first share; on a waived fee, the Fee waived payment. A school-fee payment by a child with no priority is refused with `no_class` while no stream can take them, whatever the amount. A payment that gives no priority is kept while a seat is free and books nothing. The interview fee and the Pre-Form One fee are never refused.

**One seat lock for the school, taken last.** Every seat decision runs under one transaction-level advisory lock. Before it, a transaction takes everything else it needs: Family locks, the lead row, the fee schedule row and the acting staff row for the audit key checks. After it, it never waits for a row another transaction holds. A child is written only after their row is taken with `for no key update skip locked`. A busy child keeps their seat in the count and is queued as a retry, run by the next sync or the daily job. `recompute_lead_fee`, the one funnel for payments, corrections, discounts and fee schedules, queues the lead, and a deferred trigger flushes the queue at commit. A first booking runs the sync inside the payment and checks again under the lock, so two families never both pay for the last seat.

## Consequences

- One lock means no ordering mistakes between classes. A whole-year fee sweep holds it for about 0.3 s per 300 children (measured in #449's 4b PR), and a payment beside it waits that long.
- Placement never changes a fee, a status, a Seat priority or Enrolled. A gender correction or a decline only queues the seat, and does not recompute the fee.
- The rare routes to a priority without a new payment (a correction, a discount, a fee schedule change, a reopening) are never refused. The child waits for a stream instead (Q21).
- `class_seats`, `seat_check` and `year_seats` stay as they are until the clean-up slice. Once streams are on, the Fee schedule refuses seat changes with `seats_moved`.
