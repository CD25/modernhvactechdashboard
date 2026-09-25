# Modern HVAC Tech Dashboard

A live operations dashboard for an HVAC and plumbing shop. It pulls real
data from the shop's tools, runs the routine follow-ups by itself, and shows
everything on five pages.

| Page | Real data from | What runs by itself |
|---|---|---|
| **Call & Booking Analytics** | Twilio calls, Housecall Pro jobs | Missed-call text back, after-hours callback texts |
| **Local SEO & Web Traffic** | Google Analytics 4, Search Console, Business Profile | Review request after every completed job |
| **Local Campaigns & LSAs** | Google Ads (including Local Services Ads), Meta Ads | Pause campaigns above your cost-per-lead target; raise a search budget when 3+ techs are free |
| **Dispatch, Field Techs & GPS** | Housecall Pro jobs and techs, optional Samsara GPS | Text the dispatcher the closest free tech for each unassigned job |
| **AI Operations Intelligence** | All of the above | On/off switch for every rule, and a log of everything they did |

When a service isn't connected, its page says "Not connected" and shows
"—" instead of numbers. A strip at the top of each page shows which sources
are synced and when.

## Two ways to run it

**Demo (no setup).** Open `index.html` in a browser. It runs on simulated
data so you can click through every page.

**Live (real data).** Run the server. It serves the same dashboard, switched
to live data.

```bash
cp .env.example .env      # then fill it in (steps below)
npm run check             # tests each connection, sends nothing
npm start                 # http://localhost:8080
```

It needs Node.js 18.17 or newer and has no other dependencies.

## Setup, one service at a time

Fill in `.env` as you go. You can start with only Housecall Pro and Twilio
and add the rest later. After each step, run `npm run check`.

### 1. Basics

- `TZ`: the shop's time zone, e.g. `America/Chicago`. Daily totals and "today" use it.
- `DASHBOARD_PASSWORD`: always set this before putting the server online.
  The browser will ask for `DASHBOARD_USER` and this password.
- `BUSINESS_NAME`, `MANAGER_NAME`, `OPEN_HOUR`/`CLOSE_HOUR`, `BOOKING_URL`.
- `REVIEW_URL`: the shop's Google review link (Business Profile → Ask for reviews).
- `MANAGER_PHONE`: the dispatcher's mobile, for nearest-tech suggestions.
- `SERVICE_ZONES`: named areas for the map, e.g.
  `Downtown:30.267,-97.743;North:30.40,-97.72`. The first one is the shop.

### 2. Housecall Pro: jobs, techs, estimates, revenue

1. The shop needs the MAX plan. In Housecall Pro go to **App Store → API** and generate a key.
2. Put it in `HOUSECALL_API_KEY`.

Techs appear once they have been assigned a job in the last 30 days, so
office staff stay off the board. Each job is sorted into a call reason by the
words in its description and line items. Adjust the patterns in
`server/classify.js` to match how the office writes jobs up.

### 3. Twilio: calls and text messages

1. From the Twilio console, copy the Account SID and Auth Token into
   `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. Set `TWILIO_FROM_NUMBER` to the number texts should come from.
3. Set `TWILIO_TRACKED_NUMBERS` to the shop's business line(s), so personal
   or test numbers don't count.
4. **Before turning automations on:** US numbers must be registered for
   A2P 10DLC in the Twilio console (Messaging → Regulatory compliance), or
   carriers will block the texts.

A call counts as answered when the forwarded leg connects (or, with no
forwarding, when it lasts `TWILIO_MIN_ANSWERED_SECONDS`).

### 4. Google: Ads & LSA, Analytics, Business Profile, Search Console

All four use one Google sign-in.

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable: **Google Ads API**, **Google Analytics Data API**,
   **Business Profile Performance API**, **Google My Business API** (for
   reviews) and **Google Search Console API**. The Business Profile APIs need
   an access request first:
   <https://developers.google.com/my-business/content/prereqs>.
2. Under **APIs & Services → Credentials**, create an OAuth client of type
   **Desktop app**. Put its id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Run `npm run google-auth`, open the link, and sign in with an account that
   can see the shop's Ads, Analytics, Business Profile and Search Console.
   Paste the printed `GOOGLE_REFRESH_TOKEN` into `.env`.
4. Fill in the ids:
   - **Google Ads**: `GOOGLE_ADS_DEVELOPER_TOKEN` (Ads → Tools → API Center;
     Basic access is needed to change campaigns), `GOOGLE_ADS_CUSTOMER_ID`,
     and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if you sign in through a manager account.
     Check the current API version at
     <https://developers.google.com/google-ads/api/docs/release-notes> and
     set `GOOGLE_ADS_API_VERSION` if it has moved past the default.
   - **Analytics**: `GA4_PROPERTY_ID` (Admin → Property details), and
     `GA4_QUOTE_EVENT` = the event your quote form fires (`generate_lead` by default).
     Tag Business Profile website links with `utm_source=gbp` so those visits show as "Maps".
   - **Business Profile**: `GBP_ACCOUNT_ID` and `GBP_LOCATION_ID`.
   - **Search Console**: `GSC_SITE_URL` exactly as the property is named, and
     the keywords to track in `GSC_KEYWORDS`.

### 5. Meta Ads

In Meta Business Settings create a **system user** with access to the ad
account, generate a token with `ads_read` and `ads_management`, and set
`META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`.

### 6. Samsara GPS (optional)

Without GPS, each tech is shown at the address of the job they're on and ETAs
aren't estimated. With Samsara, set `SAMSARA_API_TOKEN`; vehicles are matched
to techs by name, or by `SAMSARA_VEHICLE_TECHS`.

## Turning the automations on

The server starts with `AUTOMATIONS_LIVE=false`. In that mode every rule
runs and writes what it *would* do to the activity log ("Dry run: …") but
sends no texts and changes no campaigns. Watch the log for a day, then set
`AUTOMATIONS_LIVE=true` and restart.

- Each call, job and estimate is handled once, even across restarts
  (remembered in `data/state.json`).
- Any rule can be switched off from the AI Operations page.
- A campaign the budget guard paused can be resumed from the Campaigns page;
  the guard then leaves it alone for an hour.
- Budgets raised by the idle-capacity boost go back to normal the next day.
- Rules that need a service you haven't connected show what they need and
  can't be switched on.

## What each number means (live mode)

- **Inbound calls / missed**: Twilio inbound calls on the tracked numbers.
- **Outbound follow-up / callbacks**: outbound calls; a callback is one to
  a number that missed a call in the previous 48 hours.
- **Appointments booked**: Housecall Pro jobs created that day. Conversion = booked ÷ inbound calls.
- **Call → dispatch**: time from a job being created to "On my way", for jobs dispatched the same day.
- **Same-day dispatched**: share of jobs booked that got a tech on the way the same day.
- **Revenue / avg ticket**: totals of jobs completed that day.
- **Keyword rank**: average Google position from Search Console (lags about two days).
- **Cost per lead**: today's spend ÷ conversions (Google Ads) or lead actions (Meta).

## Hosting

Any host that runs Node works: a small VPS, Render, Railway, Fly.io, or a
PC in the office. Keep one instance running. Set the variables from `.env` in
the host's settings, and keep `data/` on persistent storage so the server
remembers who has already been texted.

## Files

```
index.html, css/, js/           the dashboard (works alone as the demo)
server/index.js                 web server, polling schedule, API for the dashboard
server/collector.js             polls each service (every 1, 5 and 30 minutes)
server/aggregate.js             turns raw data into what the dashboard shows
server/automations.js           the automation rules
server/connectors/*.js          one file per service
server/scripts/check.js         npm run check
server/scripts/google-auth.js   npm run google-auth
.env.example                    every setting, with comments
```
