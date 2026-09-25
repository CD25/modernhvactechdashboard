# HVAC Service Operations Dashboard

An automated operations cockpit for a modern HVAC and plumbing shop. It is
plain HTML, CSS and JavaScript with no build step and no dependencies.

Open `index.html` in a browser, or serve the folder:

```bash
cd hvac-dashboard
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Sections

| Section | What it shows | What runs on its own |
|---|---|---|
| **Call & Booking Analytics** | Inbound and outbound calls, bookings, conversion, call-to-dispatch time, demand mix, top call reasons, desk service levels, opportunity queue | Missed-call text back, after-hours callback queue |
| **Local SEO & Web Traffic** | Organic visitors, quote requests, map-pack keywords, backlinks, keyword rank movement, Google reviews, traffic by source | Review requests after every completed job |
| **Local Campaigns & LSAs** | Spend, leads, cost per lead, ROAS, per-campaign budget pacing | Budget guard pauses campaigns above the CPL target; idle-capacity boost raises LSA budget when 3+ techs are free |
| **Dispatch, Field Techs & GPS** | Live fleet map, job board with ETAs, tech roster with revenue and on-time rate | Auto-dispatch assigns the nearest qualified tech |
| **AI Operations Intelligence** | Call forecast, staffing need, demand shifts, ranking drops, CPL alerts, top performer | On/off switch for every automation rule, plus a live activity log |

The whole dashboard refreshes every `refreshMs` (4s by default). The bell in
the top bar opens a drawer that lists every action the automations took.
Rule switches and the selected time range are saved in the browser.

## Configuration

Edit `js/config.js`:

- `company` sets the name, tagline, region and manager shown in the chrome.
- `dataSource` is `"simulated"` (the default, a built-in live engine for
  demos) or `"api"`.
- `refreshMs` sets the polling interval.
- `simulationSpeed` sets how busy the demo is: 1 is real-world call volume.
- `targets` sets the answer-rate, same-day booking, max cost-per-lead and
  dispatch-time goals. Meters, alerts and the budget guard all read these.

## Connecting real data

Set `dataSource: "api"` and point `api.baseUrl` at your back end. On every
refresh the dashboard calls:

- `GET {baseUrl}/api/dashboard/snapshot` and renders the JSON it returns.
- `PATCH {baseUrl}/api/automations/{ruleId}` with body `{ "enabled": true|false }`
  when someone flips a rule switch.

The snapshot uses the same shape as the simulated state in `js/engine.js`:

```jsonc
{
  "days": [ // oldest → today, at least 14 entries (30 for the 30-day view)
    { "date": "2026-09-25", "calls": 84, "answered30": 72, "missed": 3, "booked": 61,
      "outbound": 33, "callbacks": 6, "dispatched": 52, "dispatchSecs": 27040,
      "completed": 55, "revenue": 23800, "quotes": 16, "lsaLeads": 18, "lsaSpend": 820, "lsaBooked": 12,
      "reasons": { "cooling": 31, "waterHeater": 17, "sewer": 10, "furnace": 8, "iaq": 6, "maintenance": 12 },
      "demand":  { "emergency": 58, "maintenance": 12, "estimate": 14 },
      "web":     { "organic": 210, "maps": 98, "paid": 57, "direct": 41 } }
  ],
  "hourly": [ { "hour": 0, "calls": 0, "booked": 0 } /* … 24 entries */ ],
  "techs": [ { "id": "T1", "name": "Marcus Hill", "initials": "MH", "title": "Sr. HVAC", "trade": "HVAC",
               "truck": "Truck 12", "x": 40.2, "y": 22.5, "status": "available|enroute|onsite|break",
               "jobId": null, "jobsToday": 3, "revenueToday": 2100, "onTime": 0.95 } ],
  "jobs": [ { "id": "J10231", "customer": "Ava Patel", "address": "412 Maple Ave", "zone": "Oakview",
              "x": 30, "y": 18, "reasonLabel": "No cool / AC failure", "priority": "emergency|standard",
              "status": "unassigned|enroute|onsite|done", "techId": "T1", "eta": 14 } ],
  "keywords":  [ { "term": "HVAC repair near me", "pos": 2, "prev": 3, "volume": 4400 } ],
  "campaigns": [ { "id": "lsa-hvac", "name": "LSA · HVAC", "channel": "Local Services Ads", "status": "active|paused",
                   "dailyBudget": 450, "spendToday": 212, "leadsToday": 5, "bookedToday": 3, "cpl": 42.4 } ],
  "opportunities": { "estimates": 12, "afterHours": 8, "renewals": 22 },
  "reviews": { "rating": 4.8, "count": 612, "requestsToday": 9 },
  "backlinks": 417, "newBacklinks": 23,
  "rules": [ { "id": "textBack", "name": "Missed-call text back", "trigger": "…", "action": "…",
               "category": "Calls", "enabled": true, "runsToday": 12 } ],
  "log": [ { "t": 1758812345000, "rule": "autoDispatch", "text": "Assigned Marcus Hill to …" } ]
}
```

Map coordinates (`x`, `y`) are on a 100 × 60 grid over the service area.
Project GPS latitude and longitude onto that box on the server.

Typical sources for each block:

| Block | Source |
|---|---|
| `days[].calls/missed/answered30/outbound`, `hourly` | Call tracking (CallRail, RingCentral, Dialpad) webhooks |
| `booked`, `jobs`, `completed`, `revenue`, `opportunities` | Field-service software (ServiceTitan, Housecall Pro, Jobber) |
| `techs[].x/y/status` | Fleet GPS (Samsara, Verizon Connect, Motive) plus job status |
| `web`, `quotes` | GA4 and website form webhooks |
| `keywords`, `backlinks`, `reviews` | Search Console, a rank tracker (BrightLocal, Local Falcon), Google Business Profile API |
| `campaigns`, `lsa*` | Google Ads API (includes Local Services Ads), Meta Marketing API |

In API mode the automation rules run on your server, next to those
integrations. The dashboard only shows their results and flips the switches.

## Files

```
hvac-dashboard/
├── index.html        app shell: sidebar, top bar, activity drawer
├── css/styles.css    theme tokens (light and dark), layout, components
└── js/
    ├── config.js     company, data source, refresh rate, targets
    ├── engine.js     live state, simulation, automation rules, API polling
    ├── charts.js     SVG line and stacked-bar charts with hover tooltips
    └── app.js        views, insights, routing, refresh loop
```
