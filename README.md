# Lasts

**A tracker for everything that expires, wears out, or needs renewing — with a built-in guide to how long things actually last, where the date is printed, and why it matters.**

No account. No server. No network calls. No analytics. No ads. Your list lives in your
browser and goes nowhere else.

---

## Why this exists

Almost everyone has been caught out by a date they had no way of knowing about:

- Smoke alarms are a **10-year part**, counted from the manufacture date stamped on the
  back — not from when you installed it. A working beep does not mean a working sensor.
- Tyres age out at around **six years** regardless of tread. The date is four digits after
  `DOT` on the sidewall: week, then year.
- Child car seats have an **expiry sticker** on the shell.
- Washing machine hoses are a **five-year part**, and they are a leading cause of domestic
  water damage.
- Many countries refuse entry unless your passport has **six months of validity left**
  beyond your trip — so the date that matters is not the one in the passport.

The tools for this are either subscription home-maintenance software, ad-choked reminder
apps that want your contacts and your location, or a calendar you have to already know what
to put in. None of them tell you *what* to track or *where to look for the date*.

So Lasts ships the knowledge as well as the reminder. Every one of its **78 catalogue
entries** answers three questions a reminder app leaves to you: how long the thing lasts,
where its date is printed, and why being late costs you something.

## Read it from a photo

Every catalogue entry tells you to *go and look at the label*. The camera does the looking:
point it at a thing — or a whole room — and Lasts works out what needs tracking and
transcribes the date printed on it. A photo of the back of a smoke alarm reading
`MFD 04/2016` comes back as a unit that was due for replacement in April 2026.

The design rule is that **the model is an eye, not an authority.** It names what it can see
and transcribes what is printed. Every interval, lead time and explanation still comes from
this repository's own catalogue, so the advice never depends on what a model happens to
recall, and improving an entry improves every item already tracked against it.

Three consequences of that rule, all deliberate:

- **Nothing is saved until you confirm it.** Findings arrive as a proposal with a confidence
  chip, one clause naming what in the image prompted it, the characters as printed, and an
  editable date. Low-confidence rows arrive unticked.
- **Partial dates round to the start of the period.** A label reading `2016` becomes
  `2016-01-01`. That is the safe direction in both cases this app cares about: an earlier
  manufacture date expires sooner, and an earlier printed expiry warns sooner. A safety date
  is never rounded later than it might be.
- **What a date *means* decides how it is used.** A printed expiry is the due date itself; a
  manufacture date starts a lifespan; a service date starts a cycle. Getting this backwards
  would file a 2016 smoke alarm as "later" instead of eight years past its useful life, so it
  is `dueFromRead()` and it is tested.

**This is the one feature that leaves your browser,** and it says so where you use it. The
photo goes to Claude on the viewer's own account to be read; your list never goes anywhere.
It requires a host that provides the capability, so it appears on the hosted page and is
simply absent when you self-host — every other feature works with the network switched off.

## What else it does

- **Browse what to track** — 78 entries across safety, home systems, vehicles, documents,
  money, health, kitchen, pets and digital, each with a sensible interval and a lead time
  tuned to how long the fix actually takes. A passport warns you nine months out, because
  that is how long renewal and the six-month validity rule really need. A filter warns you
  a week out, because that is a trip to a shop.
- **One question per thing** — it asks for the one date it needs and shows you where that
  date is printed while you look for it. No date to hand? Add it anyway; it waits under
  *Needs a date* with the hint attached.
- **Honest status** — what is overdue, what is coming up, what still needs a date, and what
  is far off. Repeating upkeep rolls forward when you mark it done, skipping missed cycles
  in one step rather than nagging about eight of them.
- **Real reminders** — export a `.ics` calendar file and import it into whatever calendar
  you already use, with an alarm the right number of days before each item and a recurrence
  rule for anything repeating. No push infrastructure, no permissions, nothing to trust.
- **Your data stays yours** — JSON backup and restore, and a delete-everything button that
  really does.
- **Works offline** — a service worker caches the whole app after first load. Installable to
  a home screen as a PWA.

## Try it

Serve the folder over HTTP (ES modules will not load over `file://`):

```sh
npm start          # python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `dist/lasts.html` — a single self-contained file with no dependencies, which works
straight off a `file://` path, a USB stick, or any static host.

## Deploy

It is static files. Copy the repository to GitHub Pages, Netlify, an S3 bucket, or a
Raspberry Pi on your LAN. There is no build step for the multi-file version and no backend
to run.

## Development

```sh
npm test           # node --test — date arithmetic, status buckets, calendar output, catalogue integrity
npm run build      # regenerates dist/ from source
```

No dependencies, no framework, no toolchain. Vanilla ES modules, one stylesheet, one
knowledge base.

| File | What it holds |
| --- | --- |
| `src/core.js` | Pure logic: calendar arithmetic, status buckets, relative phrasing, RFC 5545 export. No DOM, no storage — this is what the tests import. |
| `src/catalog.js` | The knowledge base. 78 entries with intervals, lead times, where the date is printed, and why it matters. |
| `src/store.js` | `localStorage` persistence, schema sanitising on load, backup/restore, example seeding. |
| `src/vision.js` | Photo reading: prompt construction, tolerant normalising of the reply, safe date rounding, and the date-meaning-to-due-date mapping. Pure except for the canvas re-encode. |
| `src/ui.js` | Four views, one detail sheet, one toast. Renders to strings, delegates events from `document`. |
| `build/bundle.mjs` | Flattens the modules and stylesheet into `dist/`. Walks the imports from the entry module rather than keeping a list, and fails the build on duplicate top-level names, surviving imports, or a leftover module script. |

### Things worth knowing if you change it

- **Dates are `YYYY-MM-DD` strings compared at UTC midnight.** Local-time arithmetic loses an
  hour across a DST boundary and silently shifts due dates by a day; there are tests for both
  transitions.
- **Month and year steps are calendar arithmetic with clamping.** A filter changed on 31
  January is due 28 February, not 3 March.
- **A lead time must be shorter than its own cycle**, or the item is permanently "due soon".
  The test suite enforces this across the whole catalogue.
- **The catalogue is copied by reference, not by value.** Items store a catalogue id, so
  improving an entry's wording improves it everywhere, and exports stay small.
- **Everything a model returns is untrusted in shape and in content.** `normalizeFindings()`
  takes only what fits: an invented catalogue id degrades to a custom item, an unknown
  confidence reads as `low`, an unparseable date becomes no date, and the list is capped.
- **Host capabilities are optional and advertised through data attributes**, so the CSS hides
  affordances the host cannot serve. The app is fully usable with none of them.

## About the intervals

Every interval is typical manufacturer or public-safety guidance, and every one is editable
per item. Where they disagree, **the label on your device and your local rules win** — this
app's job is to remind you to go and read them. Nothing here is medical, legal, or
engineering advice.

## Known limits

- **Your list lives in one browser.** It does not sync between devices, and clearing site data
  takes it with you. Back it up from the Data tab.
- **The calendar file is copy-paste on the hosted page.** `.ics` is not in the host's download
  allowlist, so it comes as copyable text with instructions; the self-hosted version downloads
  it directly, and the JSON backup saves as a real file either way.
- **Photo reading needs a host that offers it.** Absent when self-hosted.
- **The intervals are guidance, not a compliance schedule.** See above.

## Accessibility

Keyboard reachable throughout, visible focus rings, `aria-selected` tabs, a native `<dialog>`
for focus trapping and Escape, a live region for confirmations, `prefers-reduced-motion`
respected, and full light/dark support that follows the system or an explicit choice.
