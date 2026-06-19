# 🏡 Zen Residences CRM

A professional internal CRM for **Zen Residences** — a real-estate developer that
builds and sells houses. Built to run entirely on **free tiers** (Supabase +
Vercel). **No paid API keys, no recurring costs.**

> UI is in Albanian (Të hyrat, Shpenzimet, Pagesat, Borgjet, …). All currency in
> EUR (€).

---

## ✨ Modules

| Module | Albanian | What it does |
|---|---|---|
| **Dashboard** | Paneli | Income vs Expenses, each split **Bank** vs **Cash**; net profit; monthly cashflow & breakdown charts; recent transactions; overdue debts. |
| **Properties** | Pronat | Hierarchy **Houses → Tipi → House**. Per house: Payments (Pagesat), auto Debt (Borgjet) + deadline (Afati), Documents (Dokumentacionet), Floor plan (Planimetria), notes. Search/filter/paginate 1000+ records. |
| **Reservations** | Rezervimet | Reserve specific houses; client, dates, hold/expiry; active vs expired; reserved houses leave availability. |
| **Calculator** | Kalkulatori | Land area + sub-areas × price/m²; subtract **30% landowner share**; compare profit across price scenarios side by side. |
| **Offers** | Ofertat | Upload offers (PDF / email / document) to Supabase Storage; list, search, filter, download per client/house. |

---

## 🧱 Tech stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** + **shadcn/ui**
- **Supabase** — Postgres + Auth + Storage (free tier)
- **Vercel** — deployment (free tier)
- **recharts** for charts, **date-fns**, **zod**

---

## 🗂️ Data model (high level)

```
house_types (Tipi) 1───* houses ──┬──* transactions   (income/expense, bank/cash; income+house = a payment)
                                   ├──* documents       (documentation | floorplan | other)
                                   ├──* offers          (optional link)
                                   └──* reservation_houses *──—1 reservations

calc_projects 1──* calc_subareas
calc_projects 1──* calc_scenarios
profiles 1──≐1 auth.users
```

Key decisions baked in:
- **Debt is auto-calculated**: `debt = house.sale_price − Σ(payments)`; one `debt_deadline` per house. Exposed via the `house_financials` view.
- **Single financial ledger** (`transactions`) powers the dashboard; a house "payment" is just an `income` row tagged with `house_id`.
- **Profit = revenue − 30% landowner share** (company keeps the rest; no build cost modeled).
- **Reservations link to specific houses** (M:N) and flip those houses to `reserved`.
- **Clients** are lightweight text fields on reservations/offers (no separate table).

---

## 🚀 Setup

### 0. Prerequisites
- Node.js 18.18+ (or 20+)
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account (for deployment)

### 1. Install
```bash
npm install
```

### 2. Create a Supabase project
1. Go to **supabase.com → New project**. Pick a name + database password (free tier).
2. When it's ready, open **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   > The anon key is safe to expose to the browser — **Row Level Security** protects your data.

### 3. Configure env vars
```bash
cp .env.example .env.local
```
Edit `.env.local` and paste your two values.

### 4. Create the database
In the Supabase dashboard → **SQL Editor → New query**:
1. Paste the contents of **`supabase/migrations/0001_init.sql`** → **Run**.
   This creates all tables, the `house_financials` view, the dashboard RPC
   functions, RLS policies, and the three **private** storage buckets
   (`documents`, `floorplans`, `offers`).
2. (Optional) Paste **`supabase/seed.sql`** → **Run** for sample data to test with.
   > Seeded document/offer rows reference placeholder file paths — their download
   > links 404 until you upload real files through the app.

### 5. Create your team login (internal-only — no public signup)
**Authentication → Users → Add user** → enter an email + password and tick
*Auto Confirm User*. A `profiles` row is created automatically by a trigger.
Repeat for each team member.

### 6. Run locally
```bash
npm run dev
```
Open http://localhost:3000 → you'll be redirected to **/login**. Sign in with the
user you created.

---

## ☁️ Deploy to Vercel (free)

1. Push this repo to GitHub.
2. In Vercel → **Add New… → Project** → import the repo (framework auto-detected
   as Next.js).
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Deploy.**
5. In Supabase → **Authentication → URL Configuration**, add your Vercel domain
   to **Site URL / Redirect URLs**.

That's it — no other keys, no billing. The service-role key is **not** needed by
the app and should never be set in Vercel.

---

## 🔐 Security notes
- Every table has **RLS enabled**; only authenticated team members can read/write.
- Storage buckets are **private**; files are served via short-lived **signed URLs**.
- File uploads go **straight from the browser to Supabase Storage** (no server
  round-trip, no body-size limits).
- Email offers are uploaded as files and stored as-is (metadata shown) — no paid
  email API is used or required.

---

## 📁 Project structure
```
app/
  (app)/            # authenticated area (shell: sidebar + topbar)
    page.tsx        # Dashboard (Paneli)
    properties/     # Pronat (list + [houseId] detail)
    reservations/   # Rezervimet
    calculator/     # Kalkulatori
    offers/         # Ofertat
  login/            # auth screen
components/
  ui/               # shadcn/ui primitives
  layout/           # sidebar, topbar, mobile nav
  dashboard/ properties/ reservations/ calculator/ offers/   # per-module UI
lib/
  supabase/         # browser + server clients, middleware
  actions/          # shared server actions (auth, storage)
  types.ts format.ts labels.ts calc.ts nav.ts
supabase/
  migrations/0001_init.sql   # schema + RLS + storage + RPCs
  seed.sql                   # sample data
```

## 📜 Scripts
```bash
npm run dev     # local dev
npm run build   # production build
npm run start   # run the production build
npm run lint    # eslint
```
