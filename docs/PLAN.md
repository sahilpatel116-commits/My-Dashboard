# SubmitTrack — plan, phases and costs

*Working name. The app name can be changed any time in **Settings → App name**.*
*Other name ideas: **NONO Track** (the goal of every deliverable is a NONO), **ReviewLoop**, **SRR Desk**, **CloseOut**.*

## 1. The problem in one line

Every deliverable goes through a loop that crosses five parties, and today it is tracked in a notebook, in Excel and in a chat:

```
SCC DC sends SRR/ERS ─► Us ─► Design team (Arch / Str / MEPF)
                          ▲            │
                          │            ▼
                    BIM review ◄── BIM team (Revit sheets)  ⟲ corrections
                          │
                          ▼
                 Us ─► SCC ─► (Oracle, SRR no.) ─► TCAP ─► ERS: NR / NOO / NONOC / NONO
                                                             │
                                  repeat until NONO ◄────────┘
```

Questions the app must answer at any moment:

* Where is each drawing right now, and whose court is the ball in?
* How many SRRs came in this week? How many did we resubmit? Which ones are more than 7 days late?
* For HVAC (or any discipline), how many SRRs have we had so far, and what is the full chain? (SRR‑591 NOO → SRR‑682 NONOC → …)
* At the end: how many days did each deliverable take to close, and how much of that time was with the team, BIM, us, SCC or TCAP?

## 2. How the app models it (the key idea)

The app stores **dated events** for each deliverable, not a single status. The status is worked out from the latest event.

| Event | Who → who | Ball moves to | 7‑day clock |
|---|---|---|---|
| SRR / ERS received (code NR/NOO/NONOC/NONO) | SCC DC → Us | Us (or **Closed** if NONO) | starts for us |
| Sent to design team | Us → Team | Team | **starts for the team** |
| Team returned revised drawing / calc | Team → Us | Our review | starts for us |
| Sent to BIM (again for corrections) | Us → BIM | BIM | starts for BIM |
| BIM returned Revit sheets | BIM → Us | Our review | starts for us |
| Submitted to SCC | Us → SCC | SCC | not ours |
| SCC forwarded to TCAP (SRR no.) | SCC → TCAP | TCAP review | not ours |
| Waiting for vendor / SCC input | — | Vendor | not ours |

Because every date is kept (TCAP date, the date the SCC DC gave it to us, the date we forwarded it to the team, and so on), the long‑term numbers fall out automatically: days to close, number of cycles, and days spent with each party.

NONOC is treated as **still open** (compliance required) unless you tick "NONOC accepted as closed" on that response.

## 3. Roles

| | Administrator (you) | Internal team (Arch / Str / MEPF / BIM) | Client (SCC) |
|---|---|---|---|
| Dashboard and weekly report | ✔ | ✔ | ✔ (no internal delays) |
| Register | ✔ edit everything | ✔ view all, update only their own items | ✔ read‑only |
| Internal steps (team, BIM) and notes | ✔ | ✔ | hidden: shown as "In preparation" |
| SRR Inbox, Follow‑ups, Outbox, Team, Settings | ✔ | — | — |
| "My work" (pending with my team, oldest first) | — | ✔ | — |

## 4. Phases

### Phase 1 — done in this commit (cost ₹0)

* Installable web app (PWA), which works on laptop and phone, including offline.
* **Imports your current MTC dashboard HTML** in one click: all 1,344 deliverables from 6 stations, with their latest SRR and code.
* Register with filters, search, bulk updates (for example, mark 8 sheets "Sent to BIM" in one go), and new sheets added mid‑project (marked "added").
* **SRR Inbox**: paste the Outlook mail (or drop a saved `.eml`) and the app finds the SRR no., codes and drawing numbers and shows a proposal. You check it and press **Confirm**. It can also mark the items "forwarded to team" in the same step.
* **Outbox**: messages are written for you per team (new SRR, reminders, BIM hand‑over). One tap opens WhatsApp or your mail app with the text ready.
* **Follow‑ups**: everything pending on our side for 5+ days, grouped by team, with a "Queue reminder" button. There is also a separate list for chasing SCC or TCAP.
* Weekly report (SRRs received / resubmitted / closed / delayed), closure progress by station and discipline (sheet‑weighted, useful for payment claims).
* Analytics: average days to close, SRRs per deliverable, and days with the team, BIM, us and TCAP.
* Excel export with 3 sheets: Register, full SRR history, and cycle summary. This replaces the manual Excel.
* Role views (Admin / Team / Client) via "Viewing as".

**Limitation:** data is saved in the browser of the device you use. Other people cannot see it live yet. That is what Phase 2 fixes. Use **Settings → Download backup** regularly.

### Phase 2 — shared online database and real logins (about ₹0/month to start)

* Move the data to **Supabase** (hosted Postgres database with login). The free tier is enough for this project. The schema is ready in [`supabase/schema.sql`](../supabase/schema.sql).
* Each person logs in with their own email, so permissions are enforced by the database (row‑level security), not just hidden in the screen.
* Everyone sees the same data live. Phase 1 data moves over through the backup file.
* Note: Supabase free projects pause after about a week with no use. If that becomes annoying, Pro is about US$25/month.

### Phase 3 — automatic WhatsApp and email (about ₹200–500/month)

* **Email:** sent automatically from a scheduled job (Resend free tier: 3,000 mails/month, or from your Microsoft 365 account).
* **WhatsApp:** Meta **WhatsApp Business Cloud API**. You need a Meta Business account, a phone number that is *not* already on WhatsApp, and approved message templates (for example "SRR reminder"). Utility messages in India cost a small amount per message. Check Meta's current rate card; for a team of about 15–20 people this is roughly a few hundred rupees a month. Resellers such as AiSensy, Interakt or WATI are easier to set up but charge a monthly fee (about ₹1,000–2,500).
* **Daily 9:00 a.m. reminder:** each person gets one message listing their overdue items. A new‑SRR alert goes out when you confirm an inbox proposal.

### Phase 4 — Outlook auto‑capture with confirmation (about ₹0–300/month)

1. Outlook rule: mail from the SCC document controller with "SRR" or "ERS" in the subject is **forwarded** to a private app address. Free with Cloudflare Email Routing and a Worker. Alternatives: Power Automate (its HTTP action needs a premium licence) or a Microsoft Graph connection, if your IT allows it.
2. The app reads the mail (the same parser as the Inbox; optionally an AI model for messy mails or ERS PDF attachments, costing a few paise to a few rupees per mail) and creates a **pending proposal**.
3. You get a WhatsApp or notification message saying "SRR‑682: 8 docs, NONOC. Confirm?" You open it and tap **Confirm**, and then the register updates and the team messages go out.

### Phase 5 — scale to other EPC projects

* Several projects under one login, with a project switcher and per‑project people and roles.
* A client portal link for SCC or the PMC.
* Payment milestone report (progress % against the agreed deliverable list, which the "added" flag already separates).

## 5. Budget view (first ₹10,000)

| Item | Cost |
|---|---|
| Hosting the app (GitHub Pages / Netlify / Vercel) | free |
| Database and logins (Supabase free tier) | free |
| Domain name, optional (e.g. submittrack.in) | ~₹800/year |
| WhatsApp Cloud API messages | ~₹200–500/month |
| Email sending | free tier |
| AI reading of mails / PDFs (optional) | ~₹100–300/month |
| **Running total** | **about ₹300–800/month**, well inside ₹10,000 for the first year of tools |

## 6. How to start using Phase 1 today

1. **Publish the app** (pick one):
   * **Netlify Drop:** open <https://app.netlify.com/drop> and drag the `app` folder onto the page. You get a link at once.
   * **GitHub Pages:** in the repository, go to *Settings → Pages → Deploy from branch → `main` / root*. The app will be at `https://<your-user>.github.io/My-Dashboard/app/`.
   * Or open `app/index.html` directly in Chrome for a quick look (install and offline need one of the two options above).
2. Open the link, then **Import old dashboard HTML** and choose your current `MTC_MEPF_Dashboard_Filtered.html`.
3. Under **Team**, add each person with their access, team, WhatsApp number and email.
4. When an SRR mail comes in: copy the mail → **SRR Inbox** → paste → **Read email** → check → **Confirm** → **Outbox** → tap WhatsApp or Email.
5. Every Monday: **Dashboard** for the weekly numbers, **Follow‑ups → Queue reminder**, and **Export Excel**.
6. On the phone, use the browser's menu → **Add to Home screen**. It then opens like an app.

> The repository is public. **Do not commit the real project data** (client name, SRR numbers) into it. The app keeps data in the browser and in the backup file you download. In Phase 2 it moves into the private database.
