# Deploying the app (instructions only)

**Nothing is deployed by this repository, and this guide did not deploy anything.** It lists what is needed when you decide to put the app on a public address. Until then the app is tried on a computer and on a phone against your development Supabase project.

## Why an https address

The offline mode needs a **secure address** (see `offline-and-sync.md`). On a plain http address orders and payments still work with the signal on, but a reload without the internet does not. For real use, host the app on https.

## What you need

- A host that runs a Next.js 16 app with Node.js 24, for example Vercel. Any host that runs `npm run build` and `npm run start` works.
- A **separate production Supabase project** (do not reuse the test project; keep the development project for trials).
- The two public values of that project (URL and anon key).

## Steps

1. **Database.** Create the production Supabase project and apply the migrations in order, exactly as in `supabase-setup.md` (ten files; there is no 0009 and no 0010). Create the owner user and run `supabase/seed/provision-owner.sql`.
2. **Environment variables on the host.** Only two: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, from the production project. **Never** add the service-role key or any other secret to the host's settings for the app: the app does not use one.
3. **Build and start.** `npm install`, `npm run build`, `npm run start` (a host such as Vercel does this itself). The build also writes the offline file list (`scripts/make-sw-assets.mjs`).
4. **Addresses in Supabase.** Authentication → URL Configuration: set **Site URL** to the app's https address and add it to the **Redirect URLs**.
5. **Password reset email.** Edit the "Reset Password" email template as in `supabase-setup.md`, section 5, and consider a custom SMTP service so emails reach anyone.
6. **First sign-in.** Sign in as the owner. Complete the setup checklist (business details, optionally import a catalog).

## Checks after deploying

Do each of these once on the real address, on the phone:

1. Sign in and out; try **Forgot password?** with a real email.
2. Take an order **with the signal off**, then turn it on and check it arrives once.
3. Record a payment with the signal off, turn the signal on, and check the store's account shows it once.
4. Open Reports.
5. Print one invoice and one order sheet on the real printer (the A4 layout and the thermal layout).
6. In Settings, check the sync status says everything is sent, and that no "address is not https" notice appears.

## Rolling back

- **A bad deployment:** on the host, redeploy the previous build. The database does not change when you redeploy the app.
- **A bad migration:** the CLI applies each migration file as one unit, so a failed one leaves nothing half-applied. Migrations are not undone automatically; restore the database from a backup (below) rather than editing tables by hand. Most migration files carry a rollback note in their header; read it before you act, and prefer restoring a backup.

## Backups of the database

Turn on Supabase's backups for the production project (a paid plan keeps daily backups and point-in-time recovery; on the free plan, export the data yourself on a schedule). The phone's own backup file (`backup-and-restore.md`) covers only what is waiting on one phone, and orders; it is **not** a database backup.
