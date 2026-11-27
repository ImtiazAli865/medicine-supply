# Supabase setup

How to set up the database and sign-in for this app. Nothing here needs a service-role key in the app: the app only ever uses the public URL and the anonymous key.

## 1. Create the project

1. In the Supabase dashboard create a new project (pick the region closest to you). Write down the project's **URL** and **anon (public) key** from Project Settings → API.
2. Never copy the **service_role** key into `.env.local` or into any file under `src/`. `npm run lint` fails if one appears. It is only used by the automated tests, in `.env.test.local`, against a **separate test project** (section 6).

## 2. Apply the migrations, in this order

Apply every file of `supabase/migrations/` to the project, one after the other, either with the CLI (`supabase db push`) or by pasting each file into the SQL editor. Eight of the ten files wrap themselves in `begin` and `commit`, and the CLI applies each file as one unit, so a failure leaves nothing half-applied; if you use the SQL editor for `0001` or `0005` (the two without it), run the file once and read the result before the next. The editor may warn about `drop ... if exists`; it only touches the objects the file itself creates.

| Order | File | What it adds |
|-------|------|--------------|
| 1 | `0001_init.sql` | businesses, profiles, stores, products, row level security, the `rls_audit()` check function |
| 2 | `0002_settings_and_import.sql` | business settings, the setup checklist, catalog import |
| 3 | `0003_orders.sql` | orders, order lines, change history, order numbers |
| 4 | `0004_pending_products.sql` | Quick Register, linking typed lines, Pending Prices |
| 5 | `0005_pending_perf.sql` | faster pending reads at scale |
| 6 | `0006_market_list_purchases.sql` | the market list and purchases |
| 7 | `0007_invoices.sql` | invoices, invoice numbers, order sheets |
| 8 | `0008_store_accounts.sql` | the store account (khata): payments, reversals, the Account Summary, the statement |
| 9 | `0011_reports.sql` | read-only reports and profit (functions and one index; no table) |
| 10 | `0012_store_rates.sql` | each store's own selling prices (two tables, two columns on order lines); safe to run again |

### Why there is no 0009 and no 0010

Migrations `0009` and `0010` belonged to the voice-ordering work, which was dropped (pull request 7 was closed without merging). They are **not in this repository**. They were applied earlier to the maintainer's test and development projects only, so those two projects hold two extra tables (`voice_parse_attempts` and `voice_diagnostics`). A new project does **not** need them: apply the ten files above and nothing else. The next new migration, if there is one, is numbered `0013` or higher.

## 3. Create the owner and the business

There is no self-registration. In the dashboard open Authentication → Users → Add user (an email and a password you choose; type the password only in the Supabase dashboard). Then open `supabase/seed/provision-owner.sql`, replace the two placeholders (the business name and the user's email), and run it in the SQL editor. If the email does not exist the whole statement fails and nothing is created. Without this step the account sees "not set up".

## 4. The environment file

```
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and nothing else. Never commit `.env.local` (it is ignored by git).

Optional but recommended: in Authentication → Policies set the **minimum password length to 8**. The app's own forms already ask for at least 8 characters.

## 5. Password reset by email

The sign-in page has **Forgot password?**. It asks Supabase to email a link; the link opens the app, which checks it and lets the owner choose a new password. The app accepts two kinds of link:

- **The default email** (nothing to edit; this is what a new project sends). The link only works in the **same browser** that asked for the email, so ask for it and open it on the same computer.
- **Your own template** (needs a custom SMTP service, because Supabase does not let a project without one edit its templates). Authentication → Emails → Templates → **Reset password**: replace the link with

  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
  ```

  This form also works when the email is asked for on a computer and opened on the phone.

Either way, set the address once: Authentication → URL Configuration: **Site URL** is the address where the app runs (`http://localhost:3000` for a trial on one computer; the app's own `https` address later) and add the same address with `/**` to the **Redirect URLs** list.

Good to know:

- The built-in email service of a Supabase project only sends to members of the project's team and allows only a few emails per hour. To send to anyone, or more often, set up a custom SMTP service (Project Settings → Authentication → SMTP).
- A link works once and expires. The page then says "This link has expired or was already used. Ask for a new one."
- The page never asks for the old password and always shows the same message after you ask for the email, whether or not the address has an account.

## 6. The test project (only for running the automated tests)

Create a **second, separate** Supabase project, apply the same ten migrations to it, and put its URL, anon key and service-role key in `.env.test.local` as `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and `SUPABASE_TEST_SERVICE_ROLE_KEY`. The tests create and delete their own throwaway businesses there. Never point the tests at the project that holds real data. Without these values the tests that need a project are skipped with a visible message.

## 7. Which key goes where

| Key | Where it may be | Where it must never be |
|-----|-----------------|------------------------|
| Project URL, anon key | `.env.local`, the browser | nowhere secret: they are public by design |
| service_role key | `.env.test.local` of the **test** project only | `.env.local`, `src/`, any browser file, any committed file |
| Passwords | typed by you into the Supabase dashboard or the app's pages | any file, any chat, any commit |
