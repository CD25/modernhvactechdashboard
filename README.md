# Modern HVAC Tech Dashboard

A live operations dashboard for an HVAC and plumbing shop. It runs on the
shop's own PC, and anyone the owner approves can open it from a phone,
tablet or laptop with a link.

| Page | Data from | What runs by itself |
|---|---|---|
| **Call & Booking Analytics** | Twilio calls (or Ooma call-log uploads), job board | Missed-call text back, after-hours callback texts |
| **Local SEO & Web Traffic** | Google Analytics 4, Search Console, Business Profile | Review request text when a job is marked done |
| **Local Campaigns & LSAs** | Google Ads (including Local Services Ads), Meta Ads (later) | Pause campaigns above the cost-per-lead target; raise a search budget when 3+ techs are free |
| **Dispatch, Field Techs & GPS** | Job board, techs' phones, optional Samsara GPS | Assign the nearest free tech and text them the job |
| **AI Operations Intelligence** | All of the above | On/off switch for every rule, log of everything they did |
| **Job Board** | Entered by the office | Techs tap On the way / Started / Done from their phones |
| **Team & Settings** | | Approve accounts, manage techs, import Ooma call logs, see connections |

When a service isn't connected, its page says so and shows "—" instead of
numbers.

## Accounts and sign-in

- Everyone signs in with **email and password**. Sessions last 30 days per device.
- The **first account becomes the owner**. Create it on the PC that runs the
  dashboard (open `http://localhost:8080` there), so nobody else with the
  link can claim it first. (Or set `OWNER_EMAIL` to allow that one email from anywhere.)
- Anyone else can tap **Create account**, but they see nothing until the
  owner approves them on **Team & Settings**.
- The owner can turn accounts off, remove them, make someone an owner, and
  **reset a password** (the dashboard shows a temporary one to pass on).
  Anyone can change their own password from the account menu.
- If the owner is locked out, run on the PC:
  `npm run reset-password -- owner@example.com "new password"`.
- Only owners can switch automations on or off and resume paused campaigns.
- Passwords are stored hashed (scrypt). Repeated wrong passwords are
  slowed down. Sessions use secure, HttpOnly cookies.

## Running it on the shop's PC

1. Install **Node.js LTS** from <https://nodejs.org>.
2. Download this repository (green **Code** button → Download ZIP) and unzip it,
   e.g. to `C:\Dashboard`.
3. Double-click **`start-dashboard.bat`**. The first time, it creates `.env`
   and opens it in Notepad: fill in the settings (below), save, and
   double-click it again.
4. The browser opens `http://localhost:8080`. Create the owner account.

To start it automatically when the PC turns on: press `Win + R`, type
`shell:startup`, and put a shortcut to `start-dashboard.bat` in that folder.
The PC must stay on (and not sleep) for the link to work.

On a Mac, use `start-dashboard.sh` and `share-link.sh` instead.

### Opening it from phones and laptops

- **Same Wi-Fi as the PC:** the server window prints an address like
  `http://192.168.1.20:8080`. Open it on any device on that network.
- **From anywhere:** double-click **`share-link.bat`**. It installs Cloudflare's
  free tunnel tool the first time, then prints a secure link like
  `https://some-words.trycloudflare.com`. Send that to the team. Keep that
  window open. The link changes each time it restarts. For a permanent
  address such as `dashboard.yourcompany.com`, set up a
  [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
  on a domain you own and point it at `http://localhost:8080`.
- On a phone, open the link and choose **Add to Home Screen** to use it
  like an app.

## Setup, one service at a time

Fill in `.env`. You can start with only Twilio and the job board and add the
rest later. After each step, run `npm run check` in the folder (it tests the
connection and sends nothing).

### Basics

- `TZ`: the shop's time zone, e.g. `America/Chicago`.
- `BUSINESS_NAME`, `OPEN_HOUR`/`CLOSE_HOUR`, `BOOKING_URL`.
- `REVIEW_URL`: the shop's Google review link (Business Profile → Ask for reviews).
- `SERVICE_ZONES`: named areas for the map, e.g.
  `Downtown:30.267,-97.743;North:30.40,-97.72`. The first one is the shop.

### Job board and techs

Nothing to configure. On **Team & Settings**, add each tech with their trade
and mobile number. On **Job Board**, add jobs and estimates as they come in.

- Techs open the link on their phone and tap **On the way**, **Started** and
  **Done** (with the amount billed). If they allow location, their position
  shows on the dispatch map.
- With "Auto-assign nearest tech" on, a job with no tech gets the closest
  free tech of the right trade, and the tech gets a text with the job.
- To show job addresses on the map, enable the **Geocoding API** in the
  Google Cloud project, create an API key restricted to it, and set
  `GOOGLE_MAPS_API_KEY`.

### Calls: Twilio and Ooma

**Twilio** (inbound calls now, outbound later):

1. Copy the Account SID and Auth Token from the Twilio console into
   `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. Set `TWILIO_TRACKED_NUMBERS` to the business number(s) and
   `TWILIO_FROM_NUMBER` to the number texts go out from.
3. **Before turning automations on:** register the number for A2P 10DLC in
   Twilio (Messaging → Regulatory compliance) or carriers will block texts.

Until outbound calls go through Twilio, the Outbound tile reads
"Outbound calls aren't set up yet".

**Ooma.** Ooma doesn't offer a public API for call logs, so calls that only
go through Ooma are brought in by upload: in Ooma Office Manager open **Call
Logs**, export to CSV, and upload the file on **Team & Settings**.
Re-uploading overlapping files is safe. Set `CALL_SOURCE`:

- `auto` (default): count Twilio calls if Twilio is set up, otherwise Ooma uploads.
- `ooma`: count only Ooma uploads.
- `both`: count both. Use this only if the same call never passes through
  both (for example, if the Twilio number forwards to Ooma, `both` would count it twice).

Texts to customers are sent through Twilio. Replies land on the Twilio
number, not in the Ooma app.

### Google: Ads & LSA, Analytics, Business Profile, Search Console

1. In the Google Cloud project, make sure these are enabled: **Google Ads API**,
   **Google Analytics Data API**, **Business Profile Performance API**,
   **Google My Business API** (reviews), **Google Search Console API**, and
   **Geocoding API** (for the map).
2. **APIs & Services → Credentials → Create OAuth client → Desktop app**.
   Put the id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Run `npm run google-auth`, open the link, and sign in with the Google
   account that manages the shop's Ads, Analytics, Business Profile and
   Search Console. Paste the printed `GOOGLE_REFRESH_TOKEN` into `.env`.
4. Fill in the ids:
   - **Google Ads**: `GOOGLE_ADS_DEVELOPER_TOKEN` (Ads → Tools → API Center;
     Basic access is needed to change campaigns), `GOOGLE_ADS_CUSTOMER_ID`,
     and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if you use a manager account. If
     Google has retired the API version in `GOOGLE_ADS_API_VERSION`, update it
     from <https://developers.google.com/google-ads/api/docs/release-notes>.
   - **Analytics**: `GA4_PROPERTY_ID` and `GA4_QUOTE_EVENT` (the event your
     quote form fires). Tag Business Profile website links with
     `utm_source=gbp` so those visits show as "Maps".
   - **Business Profile**: `GBP_ACCOUNT_ID` and `GBP_LOCATION_ID`.
   - **Search Console**: `GSC_SITE_URL` exactly as the property is named, and
     the keywords to track in `GSC_KEYWORDS`.

### Meta Ads (later)

Create a system user in Meta Business Settings with access to the ad
account, generate a token with `ads_read` and `ads_management`, and set
`META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`. Restart the dashboard.

## Turning the automations on

The dashboard starts with `AUTOMATIONS_LIVE=false`. Every rule runs and
writes what it *would* do to the activity log ("Dry run: …") but nothing is
texted, assigned or changed. Watch the log for a day, then set
`AUTOMATIONS_LIVE=true` and restart.

- Each call, job and estimate is handled once, even across restarts.
- Rules that need a service you haven't connected say what they need.
- A campaign the budget guard paused can be resumed from the Campaigns page;
  the guard then leaves it alone for an hour.
- Budgets raised by the idle-capacity boost go back to normal the next day.

## What each number means

- **Inbound calls / missed**: calls to the tracked numbers (Twilio or Ooma).
- **Appointments booked**: jobs and estimates added to the board that day.
  Conversion = booked ÷ inbound calls.
- **Call → dispatch**: time from adding a job to the tech tapping On the way, same day.
- **Revenue / avg ticket**: amounts entered when jobs are marked Done.
- **Keyword rank**: average Google position from Search Console (lags about two days).
- **Cost per lead**: today's spend ÷ conversions (Google Ads) or lead actions (Meta).

## Backups

Everything the dashboard stores is in the `data` folder: accounts, jobs,
techs, Ooma imports and the automation log. Copy that folder somewhere safe
now and then. Don't share it: it holds the account and session records.

## Files

```
start-dashboard.bat / .sh      start on the PC
share-link.bat / .sh           secure link for phones and laptops
login.html                     sign-in and create-account page
index.html, css/, js/          the dashboard (opening index.html directly shows a demo)
js/board.js                    Job Board and Team & Settings pages
server/index.js                web server, sign-in, API
server/auth.js                 accounts, passwords, sessions
server/jobs.js                 job board and techs
server/collector.js            polls each service (every 1, 5 and 30 minutes)
server/aggregate.js            turns raw data into what the dashboard shows
server/automations.js          the automation rules
server/connectors/*.js         Twilio, Ooma, Google, Meta, Samsara, geocoding
.env.example                   every setting, with comments
```
