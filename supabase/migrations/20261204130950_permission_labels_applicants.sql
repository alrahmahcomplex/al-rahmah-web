-- Staff and roles shows each permission's label. On screen the system says
-- applicant for the person, application for the record and student for an
-- Enrolled applicant (owner decision of 2026-11-09); the code and the
-- permission names keep "lead". Only the labels change.

update public.permissions set label = 'View applicants and their history' where name = 'leads.view';
update public.permissions set label = 'Enter new applicants' where name = 'leads.create';
update public.permissions set label = 'Edit application details' where name = 'leads.edit';
update public.permissions set label = 'Decline applicants' where name = 'leads.decline';
update public.permissions set label = 'Mark applications inactive or archived' where name = 'leads.close';
update public.permissions set label = 'Intervene in an application''s lifecycle' where name = 'lifecycle.intervene';
