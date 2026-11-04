-- One-time, manual provisioning of the owner's business (Module 001 has no self-registration).
--
-- 1. In the Supabase dashboard: Authentication -> Users -> Add user (email + password).
-- 2. Replace the two placeholders below, then run this script in the SQL editor.
--
-- It creates one business and links the existing auth user to it. If the email does not exist,
-- the statement fails as a whole and nothing is created.

with new_business as (
  insert into public.businesses (name)
  values ('YOUR BUSINESS NAME')
  returning id
)
insert into public.profiles (user_id, business_id)
select (select u.id from auth.users u where u.email = 'owner@example.com'), nb.id
from new_business nb;
