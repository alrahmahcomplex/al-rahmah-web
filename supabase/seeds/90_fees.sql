-- Slice 9 (Fee schedule, payments and Enrolled) fixtures. Seeds load in file-name order, after 00_base.sql.

-- The 2027 Fee schedule: the school's published band structure and amounts
-- from #20's resolution. #20 gives the instalments' months (November 2026,
-- April 2027, June 2027) but not their days, nor the minimum Initial deposit,
-- so the first of each month and TZS 300,000 stand in for them here. The
-- Academic-year start, 11 January 2027, is invented too.
begin;

select public.set_audit_actor('system');

insert into public.fee_schedules (
    enrollment_year, first_share, second_share, third_share, first_due, second_due, third_due,
    minimum_deposit, pre_form_one_day_fee, pre_form_one_boarding_fee, academic_year_start
) values (2027, 40, 40, 20, '2026-11-01', '2027-04-01', '2027-06-01', 300000, 450000, 580000, '2027-01-11');

insert into public.fee_band_amounts (enrollment_year, band, day_fee, boarding_fee) values
    (2027, 'nursery', 1100000, 3000000),
    (2027, 'primary_lower', 2000000, 3000000),
    (2027, 'primary_upper', 2100000, 3300000),
    (2027, 'secondary', 2800000, 4300000);

-- The Admissions Manager's 2027 seats, for a few classes only, so the rest
-- show Seats not set. KG 2 Boarding has 2 seats: the small class seat
-- counting tests fill with two leads (#111). Keep it at 2.
insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values
    (2027, 'KG 1', 'Day', 25),
    (2027, 'KG 2', 'Boarding', 2),
    (2027, 'STD 1', 'Day', 30),
    (2027, 'STD 1', 'Boarding', 15),
    (2027, 'FORM 1', 'Day', 40),
    (2027, 'FORM 1', 'Boarding', 30);

commit;
