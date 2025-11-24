# MediLink — Smart Hospital Chat & Booking

A simple static app with:
- Chat assistant (demo or proxy to MediVirtuoso Gemini backend)
- Login/Register modal
- Partner hospitals' doctor list and profiles
- Booking modal (simulated)

## Folder layout

- `frontend/` – static site (HTML, CSS, vanilla JS, doctor JSON)
- `frontend/public/index.html` – landing page with CTA tiles that route to the dedicated surfaces below
- `frontend/public/assistant.html` – MediVirtuoso chat shell plus prompt chips and booking modal
- `frontend/public/doctors.html` – searchable doctor directory with profile modal + booking entry point
- `frontend/public/bookings.html` – authenticated appointments dashboard with upcoming + past visits
- `frontend/public/login.html` & `register.html` – standalone auth forms with `?next=` redirect support
- `backend/` – Express API, SQLite store, import scripts

Each page pulls the shared styles from `frontend/public/assets/css/styles.css` and the shared logic in `frontend/public/assets/js/app.js`. The script does light feature detection so it can run on all pages without errors.

## Run locally

Requires Node 18+.

```bash
npm install
# If you have a MediVirtuoso server, set its chat endpoint
# Example: export MEDIVIRTUOSO_URL="http://localhost:8000/chat"
export MEDIVIRTUOSO_URL=""
# Optionally set JWT secret
export JWT_SECRET="change-me"
npm start
```

The backend serves `frontend/public`, so open http://localhost:3000 and navigate using the header links or go directly to:

- `/assistant.html`
- `/doctors.html`
- `/bookings.html`

Bookmark whichever surface you use the most; the login and register pages both honor a `?next=/path` query so you can return to that screen after signing in.

## Chat

The chat sends all messages to `/api/medivirtuoso`, which proxies to the upstream `MEDIVIRTUOSO_URL` you configure.
If `MEDIVIRTUOSO_URL` is not provided, the server now falls back to a heuristic responder that:
- Parses the message locally and matches it against the doctor database.
- Returns a short triage reply plus the top doctor suggestions.

Set `MEDIVIRTUOSO_URL` whenever you want to forward messages to an actual MediVirtuoso deployment; otherwise the local helper keeps the UI functional for demos and offline development.

## Authentication UI

- `frontend/public/login.html` – standalone sign-in page that calls `/api/auth/login`, stores the JWT + user profile, and redirects back to `index.html` (or the `next` route in the query string).
- `frontend/public/register.html` – dedicated registration page with password confirmation. On success it auto-signs the user in and redirects just like the login page.
- The main landing page shows a **Login / Register** button that now opens the login page instead of a modal. When the user is logged in, that button becomes a Logout control and their name/email appear in the header badge.

You can deep-link to either page with `?next=/some/path` to return users to a specific route after authentication.

## Use DrListify data

This project can import doctors from a JSON export you prepare from DrListify.

Steps:
- Create a file at `backend/data/drlistify.json` containing an array of doctors. Minimal fields per item: `name`, `specialty`, `hospital`, `location`. Optional: `languages` (array or comma string), `experienceYears`, `rating`, `nextAvailable`, `education` (array or comma string), `bio`, `conditions` (array or comma string), `id`.
- On first server start, if the DB is empty, it will seed from `backend/data/drlistify.json`. Otherwise, run the importer:

```bash
npm run import:doctors              # imports from backend/data/drlistify.json
REPLACE=1 npm run import:doctors   # clears and replaces existing doctors
```

Note: Do not scrape or copy content from third-party sites without permission. Ensure you have rights to use any data you import.

## Wiring MediVirtuoso

This project expects a POST JSON upstream compatible with:
- Request: `{ "message": "text" }`
- Response: `{ "reply": "model reply" }` (or `text`/`response` fields)

Set `MEDIVIRTUOSO_URL` to the upstream chat route you run from:
```
https://github.com/vijaisuria/MediVirtuoso-ChatBot-Gemini-LLM
```
If the exact endpoint path differs, point `MEDIVIRTUOSO_URL` to that path.

## Notes

- The booking flow is simulated for now (alert confirmation).
- Auth and bookings persist in a local SQLite DB at `backend/data.sqlite`.
- Doctors are seeded from `frontend/public/data/doctors.json` into the DB on first run.
- Logged-in users now see a "Your Appointments" card on the home page that lists every booking returned by `/api/bookings`, with quick actions to revisit the doctor profile or book a follow-up slot.
