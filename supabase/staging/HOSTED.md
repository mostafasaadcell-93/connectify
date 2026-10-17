# Hosted Supabase staging for Connectify PR #5

This creates an empty free project and loads synthetic rows. It does not use the live store.

The production project id is `yxkzjwcmmtiljakttyfh`. If a screen shows that id, stop. Do not paste these files there.

Do not copy the production database password, service-role key, anon key, or Vault secrets. Do not deploy `market-check` anywhere except the staging project in section 6. Do not schedule a job. Do not put the staging URL or keys in `index.html`.

The free Supabase plan is enough. Do not add paid compute, point-in-time recovery, or a custom domain.

## 1. Create the project

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in with the account that owns Connectify.
2. Choose **New project**. Name it `connectify-staging`.
3. Generate a new database password and store it outside this repo. Do not reuse the production password.
4. Leave the plan on **Free**. Pick any region. It does not need to match production.
5. Wait until the project status is healthy.
6. Open **Project Settings → General** and copy the **Reference ID**.
7. Confirm that id is not `yxkzjwcmmtiljakttyfh`. If it is, you opened production. Stop.
8. Open **Project Settings → API**. Copy the project URL and the **anon public** key. Leave the service-role key unused. Do not send it in chat or commit it.

## 2. Create two staging logins

1. Open **Authentication → Sign In / Providers → Email** and turn off **Confirm email** for this staging project only.
2. Open **Authentication → Users → Add user**. Create two users with passwords you choose:
   - a staff address you control that contains the word `staging`
   - a second address you control that also contains `staging`
3. Do not invite or reuse the production owner login.
4. Turn **Auto Confirm User** on for both.

## 3. Run the schema in the staging SQL editor

Open **SQL Editor → New query** for the staging project. Paste and run one file at a time, in this order:

1. `supabase/connectify-setup.sql`
   Leave `PUT-OWNER-EMAIL-HERE` unchanged. That line then matches nobody. The seed file adds the staging staff user.
2. `supabase/02-private-costs.sql`
   The result line should say `private row hidden from customers`.
3. `supabase/03-reviews.sql`
4. `supabase/05-order-address.sql`
   The result line should say `address column ready`. No email is sent, because the Vault secrets are absent and the email trigger is not created.
5. `supabase/06-market-pricing.sql`

Do not run `supabase/04-order-email-alerts.sql`. That file installs `pg_net`, reads Resend secrets, and sends a test email.

Do not run the commented `cron.schedule` line. Do not deploy an Edge Function from this step. The staging deploy is section 6, and it targets only `akgilfixljswqljmedmg`.

## 4. Load synthetic inventory

In a new SQL Editor query on the same staging project, paste the three settings below, replace the placeholders, then paste the whole of `supabase/staging/07-synthetic-seed.sql` underneath and run it once.

```sql
select set_config('connectify.staging_project', 'connectify-staging', false);
select set_config('connectify.project_ref', 'PASTE-THE-STAGING-REFERENCE-ID', false);
select set_config('connectify.staging_staff_email', 'REPLACE-WITH-STAGING-STAFF-EMAIL', false);
select set_config('connectify.staging_viewer_email', 'REPLACE-WITH-STAGING-VIEWER-EMAIL', false);
```

The reference id must be the new project, never `yxkzjwcmmtiljakttyfh`. Both emails must contain `staging` and must already exist under Authentication.

A successful run ends with `staging seed ready`, silver price `900`, confirmed order `confirmed`, and both flags `false`.

The synthetic catalog is:

| Row | What it is | Price | Quantity |
| --- | --- | --- | --- |
| `u-stage-1` | iPhone 17 Pro Max, Silver, 256GB, new, nano-SIM + eSIM | $900 | 2 |
| `u-stage-2` | iPhone 17 Pro Max, Deep Blue, 256GB, new, nano-SIM + eSIM | $910 | 1 |
| `C-STAGE-CONF` | confirmed order, stock already applied | snapshot $900 | 1 |
| `C-STAGE-NEW` | new order, stock not applied | snapshot $910 | 1 |

Costs live only in the private row: $700 and $720. Warranty, region, SIM, and condition facts for `unit:u-stage-1` are stored unverified, so matching ignores them. The scheduler query list contains one iPhone 17 Pro Max search and `enabled` is false.

Re-running the seed restores these prices and both order statuses. It refuses to run if it sees a real order code, a unit that is not marked `staging-synthetic`, or a staff email without `staging`.

## 5. Run the hosted checks from your own machine

Do this on a computer you control. Do not paste the keys into chat.

```bash
export STAGING_SUPABASE_URL='https://YOUR-STAGING-REF.supabase.co'
export STAGING_ANON_KEY='the anon public key'
export STAGING_STAFF_EMAIL='the staging staff email'
export STAGING_STAFF_PASSWORD='the staging staff password'
export STAGING_VIEWER_EMAIL='the staging viewer email'
export STAGING_VIEWER_PASSWORD='the staging viewer password'
node test/hosted-staging-check.mjs
```

The script refuses `yxkzjwcmmtiljakttyfh`. It uses the anon key and the two staging passwords. It does not ask for a service-role key.

When it passes, send back only the printed summary. That summary has no keys.

## 6. Deploy market-check to this staging project only

Do this on a computer where you are signed in to the Supabase account that owns the staging project. Do not paste an access token into chat.

1. Confirm the dashboard project reference is `akgilfixljswqljmedmg`. If the reference is `yxkzjwcmmtiljakttyfh`, you opened production. Stop.
2. From this repo, sign in once. The browser login stores the token on that computer:

```bash
npx supabase login
bash supabase/staging/deploy-market-check.sh
```

The script deploys only the `market-check` function and only to `akgilfixljswqljmedmg`. It refuses extra arguments and refuses to run when `SUPABASE_URL` contains the production project id. It does not pass `--no-verify-jwt`, so the platform still requires a signed-in user. It does not set `MARKET_SCHEDULER_SECRET`.

The function reads the `SUPABASE_URL` Supabase injects for the project it was deployed to. If that host is not `akgilfixljswqljmedmg.supabase.co`, it returns 403 before it fetches a competitor or writes a row. It inserts `market_observations` and `market_runs` only. It reads selling prices, stock, and orders so it can prove they did not change, and it has no update, insert, or delete for `store_state` or `orders`.

## 7. Collect one staging quote batch

Use the same variables as section 5. Do not add a service-role key.

```bash
node test/staging-collector-check.mjs
```

The script signs in as the staging staff user, reads selling prices, quantities, and orders, then calls the deployed function with one query: `iPhone 17 Pro Max`. If the function is not deployed yet, it collects the same public quotes itself and inserts them through `market_begin_run`. It reads the prices, quantities, and orders again and exits with an error if any changed. It also exits if automation or the scheduler is on.

Send back only the printed JSON summary. It contains source names, errors, counts, and quote URLs. It contains no keys.

`node test/staging-collector-check.mjs --dry-run` fetches the same public quotes and prints the summary without signing in and without inserting. Use the command above when you want the rows in `market_observations`.

## 8. Replace the staging approval function

Do this only after reviewing `supabase/staging/08-single-use-approval.sql`. In the staging SQL editor, confirm the reference is `akgilfixljswqljmedmg`. If it is `yxkzjwcmmtiljakttyfh`, stop.

Paste and run that file once, as one query. It replaces `market_decide` only. It refuses live order codes and inventory that is not marked `staging-synthetic`. It does not delete decisions, rerun the seed, or change prices, stock, orders, or the scheduler.

After it succeeds, run `node test/hosted-staging-check.mjs` again with the same staging variables. Send back only the printed summary.

## 9. Open a read-only local preview

Do this on your own computer after the hosted checks have passed. Do not deploy the site, run SQL, or merge the pull request. The preview serves the existing Market Pricing screen from `127.0.0.1` and the browser may read the staging project `akgilfixljswqljmedmg` only. It refuses every other host, including `yxkzjwcmmtiljakttyfh`. Refresh, approval, apply, restore, imports, rule saves, and catalog saves are not sent.

PowerShell, from the Connectify repo:

```powershell
git checkout cursor/market-pricing-7fc1
git pull origin cursor/market-pricing-7fc1
if (-not (Test-Path market\staging-preview.env)) { Copy-Item market\staging-preview.env.example market\staging-preview.env }
notepad market\staging-preview.env
node market/staging-preview.mjs
```

In Notepad, leave the URL as `https://akgilfixljswqljmedmg.supabase.co`. Set `STAGING_SUPABASE_PUBLISHABLE_KEY` to that project's anon or publishable key. Do not put the service-role key or a password in the file. Save it, then run the `node` command. Open the printed `http://127.0.0.1:4173/#admin` address and sign in with the existing staging staff user. Market pricing opens after sign-in and shows the stored competitor observations, match explanations, justified proposals, and decision history.

The `node` process itself does not connect to Supabase. Stop it with Ctrl+C when you are done looking. Do not approve or apply a price from this screen.

## 10. One approval, one apply

Review `supabase/staging/09-approval-consumption-lock.sql` before running it. The file cannot see the hosted project id, and it does not set `connectify.project_ref` itself. That value is only your confirmation of what the SQL Editor shows. It is not an independent project check.

In the Supabase dashboard, read the project reference. If it is `yxkzjwcmmtiljakttyfh`, stop. If it is `akgilfixljswqljmedmg`, open the SQL Editor and run this by itself:

```sql
select set_config('connectify.project_ref', 'akgilfixljswqljmedmg', false);
```

Then paste and run `09-approval-consumption-lock.sql` in that same session. The script refuses to continue unless the fixtures are exactly the synthetic ones: units `u-stage-1` (Silver, 256, new, psim, qty 2, price 900, note `staging-synthetic`) and `u-stage-2` (Deep Blue, qty 1, price 910, same other fields); orders `C-STAGE-CONF` (confirmed, stock applied) and `C-STAGE-NEW` (new, stock not applied); phone key `stage-ph`; and private entries for those two units only. A missing fixture or any extra unit, order, or marker stops it. It also stops if automation, price writes, or the scheduler are enabled. It adds a per-SKU lock and replaces `market_decide` only. It does not delete decisions, rerun the seed, or change prices, stock, orders, or the scheduler.

Saving a price and recording the audit row are still separate. This migration does not make those two steps atomic. The admin page can still write a price before the audit insert.

Do not run the file until you have reviewed it. The hosted staging project has not had this version applied yet.

## What stays off

- `market_settings.automation_enabled` and `writes_enabled` stay false.
- `market_query_config.enabled` cannot be turned on. The database trigger raises `scheduler disabled`.
- No cron job is installed, and `MARKET_SCHEDULER_SECRET` stays unset.
- The live site and the production project `yxkzjwcmmtiljakttyfh` are not part of this deploy.
