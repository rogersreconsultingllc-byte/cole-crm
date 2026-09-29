# Cole CRM

Live CRM for Cole Rogers — contacts, follow-up calendar, satellite map with Florida parcel lines, and buyers list. Reads and writes the `cole-crm` Supabase project directly, so anything logged (in the app or by Claude) shows up right away.

## What's in it
- **Today** — overdue calls, today's calls, next 7 days, recent conversations
- **Contacts** — search everything (names, addresses, notes, call history), filter by A/B/C and type
- **Calendar** — month view of next follow-ups
- **Map** — Esri satellite imagery, Florida DOR statewide parcel lines (zoom in), colored pins by priority. Click any parcel for owner, value, last sale and building size; save it as a pin or turn it into a contact. Contacts without a map position are looked up automatically, or placed by hand.
- **Buyers** — buyer criteria (markets, product types, SF, price, 1031) with plain-English search (`search_crm`)
- Logging a conversation saves a dated entry and sets the next call by cadence (A 2 weeks, B monthly, C quarterly)

## Run locally
```
npm install
npm run dev
```

## Deploy on Vercel
1. Push this folder to a GitHub repo.
2. vercel.com → Add New → Project → import the repo. Vercel detects Vite; keep the defaults and click Deploy.
3. In Supabase → Authentication → URL Configuration, set **Site URL** to the Vercel address (e.g. `https://cole-crm.vercel.app`) so confirmation and password-reset emails link back to the site.

Supabase URL and publishable key are built in (they're public by design; all data is protected by row-level security). To override, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` in Vercel.

## Access
Only emails listed in the `app_users` table can read or write data. First visit: "Create your password", confirm the email, then sign in.
