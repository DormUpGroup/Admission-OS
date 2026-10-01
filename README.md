# Admission OS

Operations system for Italian-university admissions. Staff run cases from an inbound lead through program matching, applications, documents, deadlines, and consultations. Students use a separate portal for their own case.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS 4
- **Prisma** + Postgres
- **Auth.js** credentials auth with roles `ADMIN`, `CURATOR`, and `STUDENT`
- Private file storage, served only after an access check

## Quick start

Copy `.env.example` to `.env` and fill in local values. Do not commit `.env`.

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The seed script creates local sample accounts; use those only against a local database.

## Areas

**Staff**

- Work queue, students, and leads
- Applications, documents, tasks, and deadlines
- University and program catalog, including match and shortlist
- Consultations
- Message inbox
- Automation that asks a person to approve sensitive actions

**Student portal**

- Case progress, programs, documents, messages, and booking a consultation

Public booking and registration links are token-based and do not require an account until the person is invited in.

## Scripts

- `npm run dev` — development server
- `npm run worker` — background worker
- `npm run db:seed` — load local sample data
- `npm run db:reset` — reset the local database and seed it again
- `npm run test` — tests
- `npm run build` — production build

Program catalog scripts (`programs:*`) are for maintaining university data. Run them only against a database you are allowed to change.
