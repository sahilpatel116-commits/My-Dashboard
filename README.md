# My-Dashboard → SubmitTrack

Document tracking software for EPC projects. It tracks architectural, structural and MEPF drawings and calculations through the
SRR / ERS review loop (Design consultant → BIM → Client → PMC), with reminders to every team.

* **App:** [`app/`](app/). Open `app/index.html`, or publish the folder (see the plan, section 6).
* **Plan, phases and costs:** [`docs/PLAN.md`](docs/PLAN.md)
* **Phase 2 database:** [`supabase/schema.sql`](supabase/schema.sql)

## What v1 does

* Imports the existing MTC dashboard HTML (all stations and disciplines) in one click.
* Each deliverable keeps a dated history: SRR received → team → BIM (and corrections) → SCC → TCAP → ERS code (NR / NOO / NONOC / NONO).
* Weekly report: SRRs received, resubmissions, closures, and items delayed more than 7 days on our side.
* SRR Inbox: paste an Outlook mail, review the proposed update, and confirm it.
* Outbox: one-tap WhatsApp or email messages per team. Follow-ups: grouped reminders.
* Analytics (days to close, cycles, time with each party) and an Excel export.
* Admin, internal team and client views. Installable on phone and desktop (PWA).

No build step and no server: plain HTML, CSS and JavaScript.
