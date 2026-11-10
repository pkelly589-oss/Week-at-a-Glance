# Week at a Glance

The household's next week on one screen (yesterday, today and the five days
after): both Google Calendars
merged into a plain list per day, with the weather for each day. It is shown
on a TRMNL X e-ink display by the front door, refreshed every hour from 7am to
midnight, and on a web page for phones and computers.

Sibling to [Fridge Board](https://github.com/pkelly589-oss/fridge-board), and
built the same way: plain HTML/CSS/JS on Firebase, a household allowlist in
Firestore, no secrets and no email addresses in the repository.

## Features

- **Your calendars, plus shared ones:** both of yours, Home Tasks, the house
  calendar and US holidays (set in step 6).
- **Seven days: yesterday, today and the next five**, so today is always the
  second column and the view never runs out at the weekend. The header shows
  the weekdays and dates on view ("Mon – Sun" / "Nov 9 – 15").
- **One list per day.** No hour grid. In each day:
  holidays first (outlined, with a star), then birthdays (dashed outline, with
  a cake), then reminders, then all-day events,
  then timed events by start time. Multi-day events repeat on each day with
  "Day 2 of 3"; a late night that runs past midnight stays on its first day.
- **Each event once.** Invites you're both on, copies made by hand (same title
  and start), and the same occasion entered by each of you in different words
  ("My Anniversary!!" and "💍Anniversary": same start, one title's words all in
  the other, ignoring "my", "our", emoji and punctuation) become one row.
- **Birthdays** are all-day, one-day events whose title ends in "birthday" or
  "bday" ("Lisa’s Birthday"), or that Google marks as birthdays. Parties and
  trips for a birthday stay normal events.
- **P / D badges show who's going**, from RSVPs: accepted, maybe, organizer,
  or your own event. Not answered yet = no badge. Holidays and reminders have none.
- **Hidden:** events everyone of you on the invite has declined (one decline
  is not enough), events you marked private or confidential, cancelled
  instances, busy-only blocks, and any title on the `hide_events` list.
  Events Gmail adds from confirmation emails (reservations, flights) are always
  marked private by Gmail; that doesn't count, so they show.
- **Locations** under each event, as the place's name only ("Nido"), never the
  street address. A location that is only an address, a meeting link or the
  home address isn't shown.
- **Weather** for each day: icon, high/low in °F, and rain chance from 20%.
  Every day's weather block is the same height, so the event lists line up.
- **Now, at the top:** beside the date, the conditions at the last update:
  temperature, sky (a moon after dark) and the US AQI measured by AirNow's
  nearest monitors (Open-Meteo's forecast AQI if AirNow has no recent reading),
  with a face for its band
  (smile for Good … mask for Hazardous, a black chip from 101); and to the
  right, the sunset time. The late-night update says "at 11:55 PM" instead of
  "now", since it stays up until 7am. Today's forecast high/low and rain chance
  are in today's column. If the current conditions can't be had, the header
  shows today's forecast instead.
- **Home energy** (Enphase, optional): a strip along the bottom of the door
  display and under the header on the web with yesterday's solar production,
  home use, grid import and export, the share of the home's use that didn't
  come from the grid ("self-powered"), and the current battery charge at the last
  update. If Enphase can't be reached, the last figures stay, marked "earlier".
- **Household reminders** as black bars at the top of the day: fixed routines
  such as "Bins out tonight" or "Street sweeping today" (their calendar copies
  are hidden), and everything on a calendar marked `as_reminders` (Home Tasks).
- **E-ink:** today's column is inverted, yesterday is greyed, a crowded day
  ends with "+3 more", and emoji are dropped (the display has no emoji font).
- **Web page:** stacked days on a phone (opens at today, yesterday folded),
  seven columns on a computer, coloured badges, light/dark, add to home screen.
- **Banners** on the web page for a failed update, a Google connection that
  needs renewing, a display battery under 20%, a display that hasn't checked
  in for two days, or a new display waiting to be approved.
- **Refresh now** on the web page rebuilds the week (at most once a minute).

## How it works

```
Pete's calendar ──┐
David's calendar ─┼─► nightlyBuild (hourly at :55, 6:55–23:55 PT) ──► weeks/{first day} ──► web page
Open-Meteo / NWS ─┘    merge, dedup, render PNG     status/latest
                                   │
                                         └─► Storage PNG ──► /api/display ──► TRMNL X (wakes 00:00, 12:00)
```

- **nightlyBuild** runs hourly at :55 from 6:55am to 11:55pm Pacific (despite
  its name, kept so the deployed function isn't replaced); the 23:55 run builds for
  the day about to begin, so the window moves on by a day at midnight. It retries 3 times,
  2 minutes apart. If it can't read any calendar, the display keeps its last picture.
- **The e-ink image** is the same markup as the web page (`public/lib/view.js`),
  drawn by headless Chrome at 1872 × 1404 and reduced to 16 greys (about 55 KB).
- **The TRMNL X** talks to this project as its own server ("BYOS"). Each time
  it wakes it's told to sleep until just after the next hour, or from midnight
  until 7am. If that refresh's picture isn't ready, it checks back every 15
  minutes (never past the next refresh) for up to 6 hours.
- **Air quality:** the header's AQI is AirNow's (EPA) current reading from
  nearby monitors (its current-observations service, which replaced the one
  AirNow retired on October 1, 2026): for each of ozone, PM2.5 and PM10 the
  median of the nearby sites, and the highest of those, as AirNow reports
  the overall AQI. If AirNow fails, its key is off, or its reading is over 3 hours
  old, Open-Meteo's air-quality forecast (CAMS) stands in, with no warning.
- **Weather:** Open-Meteo (mainly NOAA's models for the US) for each day's
  forecast and the current temperature and sky; the National Weather Service
  if Open-Meteo is down.
- **Sunset** is calculated from the home's coordinates (within a couple of
  minutes of published times), so it shows even when the weather services
  are down.
- **Weather:** Open-Meteo for the whole week. If it's down or rate-limited,
  the National Weather Service covers the days ahead, and any day still missing
  keeps the previous night's forecast.

### Files

| Path | What it is |
| --- | --- |
| `public/lib/week.js` | Week rules: Pacific dates, the 7-day window, merge/dedup, RSVP badges, hiding rules, multi-day layout, weather parsing. No Firebase code, so it's unit-tested and shared |
| `public/lib/view.js` | The week's markup for both the web page and the e-ink image, plus the e-ink styles |
| `public/index.html`, `app.js`, `style.css` | The web page: sign-in, live data, banners, Refresh now |
| `public/firebase-config.js` | The project's public Firebase web settings, and the emulator stand-ins |
| `public/eink/waiting.png` | What the display shows before the first build |
| `functions/index.js` | Wires the functions to Firebase: schedule, callable, HTTP, secrets |
| `functions/src/build.js` | One build: read, merge, store, render, clean up |
| `functions/src/sources.js` | Google Calendar, Open-Meteo and NWS requests |
| `functions/src/render.js` | Headless Chrome screenshot → 16-grey PNG |
| `functions/src/device.js` | The TRMNL BYOS API: `/api/setup`, `/api/display`, `/api/log`, `/api/image` |
| `scripts/connect-google.mjs` | One-time Google sign-in that stores the token in Secret Manager |
| `scripts/connect-enphase.mjs` | One-time Enphase approval that stores the app keys and token in Secret Manager |
| `scripts/setup-firestore.mjs` | Loads `household.local.json` into `config/household` and the allowlist |
| `household.local.json` | Your household settings and allowlist. Holds email addresses, so it is git-ignored |
| `scripts/copy-shared.mjs` | Copies `public/lib` into `functions/shared` before deploys and tests |
| `firestore.rules`, `storage.rules` | Security rules: the household can read the week; nothing else is readable or writable from a browser |
| `tests/` | Unit tests, functions tests, rules tests and a browser test, all on invented data |

### Data model

All written by the functions; browsers only read `weeks` and `status`.

| Document | Contents |
| --- | --- |
| `allowlist/{email}` | `role`: `owner` or `member` (as in Fridge Board) |
| `config/household` | Who's who, which calendars, and the home's coordinates (step 6) |
| `weeks/{first day}` | The snapshot for a 7-day window: `title` ("Nov 9 – 15"), `subtitle` ("Mon – Sun"), `as_of` (today), `built_at`, `warnings`, `energy` (yesterday's kWh totals and battery %), and `days[]` with weather and events |
| `status/latest` | Last build: `ok`, `week_id`, `image`, `last_error`, `consecutive_failures` |
| `status/device` | The display's last check-in, battery, and any device waiting for approval |
| `devices/{MAC}` | An approved display and its API key |
| `renders/{name}` | Where each PNG is stored and the token in its URL |
| `private/enphase` | Enphase's current access and refresh tokens (they rotate, so they're kept here, not in Secret Manager) |
| `private/enphase_cache` | Yesterday's raw Enphase totals (refetched only at 23:55 and 11:55) and the battery level (reused for 30 minutes), so builds stay within the free API allowance |

Snapshots and images older than 14 days are deleted automatically.

## Setup

You need Node.js 22 or later and a Google account (Java 11 or later only for the
local emulators). About an hour, once. Run the commands in Terminal from the
project folder. Once deployed, everything runs in Google Cloud: your computer
is only needed to set up and to deploy changes.

The steps are in the order that works: several later steps fail if an earlier
one is skipped, and the error each one gives is noted where it happens.

### 1. Create the Firebase project

1. In the [Firebase console](https://console.firebase.google.com/), **Create a
   project** (for example `week-at-a-glance`), with Google Analytics off.
2. **Upgrade to the Blaze plan** (bottom left). Scheduled functions and
   Storage need it. One build a day should stay inside the free usage. In
   Google Cloud **Billing > Budgets & alerts**, set a $1 budget with email alerts.
3. **Authentication > Sign-in method > Google**: enable.
4. **Firestore Database > Create database**: location `us-west1`, production mode.
5. **Storage > Get started**: location `us-west1`, production mode. Skipping
   this makes the deploy fail with *"Firebase Storage has not been set up"*.
6. **Project settings > Your apps > Web**: register "Week at a Glance" and copy
   the `firebaseConfig`.

### 2. Configure

1. `npm install`, then `(cd functions && npm install)`.
2. Paste the config values into `FIREBASE_CONFIG` in `public/firebase-config.js`
   and set `authDomain` to `<project-id>.web.app` rather than the
   `.firebaseapp.com` address Firebase shows (sign-in is more reliable on
   iPhones). These values are public by design.
3. In the [Google Cloud credentials page](https://console.cloud.google.com/apis/credentials),
   open **Web client (auto created by Google Service)** and add
   `https://<project-id>.web.app/__/auth/handler` under **Authorized redirect URIs**.
4. `npx firebase login`. `.firebaserc` already names this household's project
   (`week-at-a-glance-95425`); for a different project, run `npx firebase use --add`.

### 3. Connect Google Calendar

Do this before the first deploy: the functions won't deploy until their
secrets exist.

1. **Calendars:** every calendar to show must be visible to the Google account
   you connect with. David shares his with Pete: Google Calendar > Settings >
   his calendar > Share with specific people > Pete's address > **See all event
   details**. The house calendar and Home Tasks need the same.
2. **Enable two APIs** in Google Cloud for the project:
   [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
   and [Secret Manager API](https://console.cloud.google.com/apis/library/secretmanager.googleapis.com).
   Without Secret Manager, the next steps fail with *"Secret Manager API has
   not been used in project … or it is disabled"*. Allow a minute or two after enabling.
3. **Google Auth Platform** (formerly "OAuth consent screen"). Turning on
   Google sign-in in Firebase usually set it up already, so you may never be
   asked to pick "External". Use the pages in its left menu:
   - **Audience:** user type External. Under Publishing status, if it says
     Testing, **Publish app**. In testing mode Google expires the token after 7
     days and the display stops updating. (If this page shows **Get started**
     instead, run through it and choose External.)
   - **Branding:** app name "Week at a Glance".
   - **Data Access > Add or remove scopes:** tick `.../auth/calendar.readonly`,
     then Update and Save.
   - **Clients > Create client > Desktop app**, named for example "Week at a
     Glance connect". Keep its client ID (ends `.apps.googleusercontent.com`)
     and secret (starts `GOCSPX-`). Use this one, not the "Web client (auto
     created by Google Service)": that one is for Firebase sign-in and fails here.
4. Run `npm run connect-google` and paste the Desktop client's ID and secret
   when asked. In the browser window it opens, sign in as Pete. Google warns
   that the app is unverified, which is expected for a personal app: choose
   **Advanced > Go to Week at a Glance** and allow calendar access. The script
   stores the ID, secret and refresh token in Secret Manager.

If the web page ever says Google needs reconnecting, run step 3.4 again, then
`npm run deploy`.

### 4. Connect Enphase (solar and battery)

The functions expect a secret called `ENPHASE`. To skip energy figures, store
an empty one and go on to step 5:

```sh
echo '{}' | npx firebase functions:secrets:set ENPHASE --data-file -
```

Otherwise (Enphase systems, as installed by Blue Raven and monitored in Enlighten):

1. Create a free developer account at
   [developer-v4.enphase.com](https://developer-v4.enphase.com/signup) and
   activate it from the email.
2. **Applications > Create Application.** Plan: **Watt** (free: 10 calls a
   minute, 1,000 a month; this uses about 28 a day, roughly 870 a month). Name it "Week at a
   Glance". Under Access Control tick **System Details**, **Site Level
   Production Monitoring** and **Site Level Consumption Monitoring**.
3. Note the app's **API key**, **Client ID** and **Client Secret**.
4. Run:

   ```sh
   npm run connect-enphase
   ```

   It opens Enphase's approval page. Sign in with your **Enlighten** (homeowner)
   account and approve. The page then shows a code: paste it into the terminal.
   The script finds your system, checks each figure can be read (an error next
   to one means that Access Control box wasn't ticked), and stores everything
   in Secret Manager.

Enphase's refresh token lasts a month and is renewed at every daily build, so
it stays connected as long as the builds run. If it lapses (the web page warns
"Enphase access expired"), run `npm run connect-enphase` again, then deploy.

The figures are for the last full day ("yesterday"). At the 23:55 build that
day is just ending, so its home use can be a few minutes short; the 11:55
build corrects it. The other hourly builds fetch only the battery level, one
call each, and Refresh now reuses a battery level under 30 minutes old.

#### AirNow (measured air quality)

The functions also expect a secret called `AIRNOW`.

1. Request a free key at
   [docs.airnowapi.org/account/request](https://docs.airnowapi.org/account/request/).
   It arrives by email; it's also shown under **Web Services** once you log in.
2. Store it (paste the key when asked):

   ```sh
   npx firebase functions:secrets:set AIRNOW
   ```

To go without, store `off` instead: the header then uses Open-Meteo's
forecast AQI. AirNow allows 500 calls an hour; this makes one per build.

### 5. Deploy

```sh
npm run deploy
```

On a brand-new project the first deploy is bumpy:

- It may ask to enable more Google APIs (Cloud Functions, Cloud Build,
  Artifact Registry, Cloud Run, Cloud Scheduler, Eventarc). Answer yes.
- It may fail with *"Could not create Cloud Run service device"* (or another
  function). Google is still setting up permissions for the newly enabled
  services. Wait about 5 minutes and run `npm run deploy` again.
- It asks *"How many days do you want to keep container images before they're
  deleted?"*: answer `1`. They're only kept for rollbacks, and redeploying does
  the same job.
- Afterwards, open [Cloud Run](https://console.cloud.google.com/run), click
  **refreshnow** > **Security**, and check **Allow public access** is selected
  (select it and Save if not). The first deploy can fail to set this, and then
  Refresh now says "internal" (see Troubleshooting). Do the same check for
  **device**, which the TRMNL calls. The code itself still checks who's calling.

The site is now at `https://<project-id>.web.app`.

### 6. Household settings and allowlist

Put the settings in `household.local.json` in the project folder (git-ignored,
since it holds your email addresses):

```json
{
  "household": { "people": [...], "calendars": [...], "location": {...}, ... },
  "allowlist": { "pete@…": "owner", "david@…": "member" }
}
```

Then in **Project settings > Service accounts** click **Generate new private
key**, and run:

```sh
node scripts/setup-firestore.mjs ~/Downloads/<the key file>.json
```

It checks the file and prints "Saved config/household (… calendars, …
reminders) and … allowlist entries". A warning that *"The `credentials` option
is deprecated"* comes from inside Google's library and is harmless. **Delete
the key file afterwards**: it grants full access to the project.

For a small change later (adding to `hide_events`, say), editing the
[`config/household` document](https://console.firebase.google.com/project/_/firestore)
in the Firebase console is quicker than generating a new key: expand the
field, **Add item**, Save. Keep `household.local.json` in step so a later
script run doesn't undo it. Changes apply at the next build (tonight, or Refresh now).

`config/household` holds:

| Field | Type | Value |
| --- | --- | --- |
| `people` | array of maps | `{ key: "pete", name: "Pete", letter: "P", email: "<Pete's address>" }`, `{ key: "david", name: "David", letter: "D", email: "<David's address>" }` |
| `calendars` | array of maps | One map per calendar to read. For each person: `{ person: "pete", id: "<Pete's address>" }`. For shared calendars, leave out `person` and give a `label` (used in warnings): see below |
| `location` | map | `{ lat: <number>, lon: <number> }` for home |
| `hide_locations` | array of strings | Optional. Locations containing any of these are not shown, e.g. the home address |
| `hide_events` | array of strings | Optional. Events whose titles contain any of these (whole words, any case, apostrophes ignored) are never shown |
| `reminders` | array of maps | Optional. Fixed routines shown as warnings: see below |

The calendars currently in use:

| `id` | `person` | `label` |
| --- | --- | --- |
| Pete's address | `pete` | |
| David's address | `david` | |
| Home Tasks' calendar ID (Google Calendar > Settings > Home Tasks > Integrate calendar) | | `Home Tasks`, plus `as_reminders: true` |
| The house account's address | | `House` (or the calendar's own name) |
| `en.usa#holiday@group.v.calendar.google.com` | | `US holidays` |

Each reminder is a map:

| Field | Meaning |
| --- | --- |
| `label` | A name for you, e.g. `Bins` |
| `weekday` | `0` Sunday … `6` Saturday |
| `nth` | Optional. `2` = the 2nd of that weekday each month, `-1` = the last; leave out for every week |
| `day_before` | Optional. Shown the day before, e.g. `Bins out tonight` |
| `day_of` | Optional. Shown on the day, e.g. `Street sweeping today` |
| `hide_events` | Optional. Phrases; calendar events whose titles contain one (whole words, any case) are hidden, since the reminder replaces them |

Keep the texts short: a column fits about 18 characters a line.

- A calendar with `as_reminders: true` is drawn as reminder bars, with its
  time if it has one, instead of as events.
- Google's holiday calendars (IDs ending `#holiday@group.v.calendar.google.com`)
  are recognised automatically and always come first in their day.
- Events on a shared calendar get P or D badges only if you're on their invite list.
- Each person's `email` must be the address they RSVP with; that's how badges
  are worked out. Invites to other addresses (a work account) show without
  that person's badge.

### 7. First week

Open the site and sign in with Google. "No week has been built yet" is
expected at first: tap **Refresh now**. The first build takes up to a minute
while the server starts Chrome; after that the week appears, and the display
image is ready.

### 8. Set up the TRMNL X

1. Hold the device's reset to enter Wi-Fi setup, join its "TRMNL" network from
   your phone, enter your Wi-Fi, and under the custom server option enter
   `https://<project-id>.web.app`.
2. The first time it connects, the web page shows "A display (MAC …) asked to
   connect". In Firestore, create `devices/<that MAC>` with any field (for
   example `approved` = `true`).
3. Reset or wake the device. It fetches a key, shows the week, and from then on
   wakes just after each hour from 7am to midnight, and sleeps through the night.

The device refreshes 18 times a day. At an estimated 0.5–1.5 mAh per refresh,
plus its sleep draw, the 12,000 mAh battery should last about a year or more
between charges (an estimate: TRMNL doesn't publish per-refresh figures for the
X). The web page warns below 20%.

### 9. Optional: email when a build fails

In Google Cloud **Monitoring > Alerting > Create policy**, add a log-based
alert matching the text `Build failed`, with your email as the notification
channel. The web page also shows a banner after any failed build.

## Troubleshooting

To see what a function did, run (from the project folder):

```sh
npx firebase functions:log --only refreshNow -n 40     # or nightlyBuild, device
```

| What you see | Cause and fix |
| --- | --- |
| Deploy: *"Firebase Storage has not been set up"* | Step 1.5 was skipped. Storage > Get started (`us-west1`, production mode), then deploy again |
| `connect-google` or deploy: *"Secret Manager API has not been used … or it is disabled"* | Enable the Secret Manager API (step 3.2), wait a minute, run the command again |
| Deploy: *"Could not create Cloud Run service …"* | New-project permissions still settling. Wait 5 minutes, deploy again |
| Refresh now says **internal**, and the log says *"The request was not authenticated"* | The function isn't public. Cloud Run > `refreshnow` > Security > **Allow public access** > Save. Same for `device` if the TRMNL gets 403 errors. The code still checks sign-in and the allowlist (Refresh now) or the MAC and key (display) |
| Refresh now says **Refresh failed: …** | The build ran and failed; the message says why. A "Google … connect-google" message means the token was revoked or expired: run `npm run connect-google`, then deploy |
| *"Refreshed recently. Try again in 1 min"* | Refresh now runs at most once a minute. Wait, or delete `last_manual_at` from `status/latest` in Firestore |
| *"No week has been built yet"* | Normal before the first build: tap Refresh now |
| An event is missing | Check, in order: is it marked private by you; on the `hide_events` list or a reminder's `hide_events`; declined by everyone on it; on a calendar not in `calendars` or not shared with the connected account |
| Deploy: *"Secret ENPHASE … not found"* | Step 4 was skipped: run `npm run connect-enphase`, or store `{}` to go without |
| Deploy: *"Secret AIRNOW … not found"* | Step 4's AirNow part was skipped: `npx firebase functions:secrets:set AIRNOW` with your key, or `off` |
| The AQI differs from AirNow's website | Hover over the AQI on the web page: "(AirNow, …)" means it's AirNow's reading for that area, from the hour before the update. No "(AirNow)" means AirNow had nothing recent and Open-Meteo's forecast was used. `npx firebase functions:log --only nightlyBuild` shows "AirNow failed" with the reason (a 401 means the key is wrong) |
| Warning *"Enphase access expired"* | Run `npm run connect-enphase`, then `npm run deploy` |
| Warning *"Solar data unavailable"* | Enphase didn't answer; the strip shows the last figures, marked "earlier". `npx firebase functions:log --only nightlyBuild` shows which call failed (a 401/403 means an Access Control box is missing from the Enphase app) |
| A change in `config/household` doesn't show | It applies at the next hourly build (at :55), or tap Refresh now |
| Code changes don't show | Run `npm run deploy` (or `npx firebase deploy --only functions` for build and display changes only), then Refresh now |

## Local development

```sh
npm install && (cd functions && npm install)
npm run dev
```

Open <http://127.0.0.1:5000>. On localhost the page always uses the emulators.
Add `allowlist/<email>` with `role` = `owner` in the emulator UI
(<http://127.0.0.1:4000>), and seed a week with the fixtures in
`tests/fixtures.js` (the browser test shows how).

## Tests

```sh
npm test            # week rules, the build and device API, security rules (49 tests)
npm run test:e2e    # the web page in a browser, phone and desktop sizes
```

The functions tests run the real build against the Firestore emulator with
stand-ins for Google, the weather services and Chrome. Set `CHROME_PATH` to an
installed Chrome to use it for the browser test and for rendering locally.

## Security

- **No secrets in this repository.** The Google client secret and refresh
  token live in Secret Manager (`npm run connect-google`), and so do the
  Enphase app keys (`npm run connect-enphase`) and the AirNow key. Enphase's rotating tokens are
  in Firestore under `private/`, which no browser can read.
- **No email addresses in this repository.** People, calendars and the
  allowlist live in Firestore and in the git-ignored `household.local.json`.
  Don't commit exported data or service-account keys (also git-ignored).
- **Read-only calendar access** (`calendar.readonly`). Only what's displayed
  (title, time, place, badges) is stored; private events are dropped before
  anything is saved.
- **The display** needs an approved MAC address and its own key; its image
  URLs carry a random token. Nothing in Storage is publicly readable.
- Firebase web settings in `firebase-config.js` are public by design; the
  rules and the allowlist decide access.
