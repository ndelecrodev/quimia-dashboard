# quimia-dashboard


> Also published as a browsable site at
> https://ndelecrodev.github.io/task-time-sync-docs/


Static dashboard (HTML, CSS, and plain JavaScript, no framework, no build
step) for tracking the team's tasks and hours. Data comes straight from the
Postgres/Supabase database that the `task-time-sync` pipeline keeps
updated. This site only reads, it never writes to those tables.

Available in Portuguese ([`README.md`](../../README.md), default) and in
English (this file).

## What this is

A read-only panel for the team to check its own progress: tasks by person
and by project, logged hours, deadlines, and an exportable breakdown. There
is no task creation or editing in the site itself, that's the job of the
task-time-sync pipeline (Jira + Clockify → Postgres). The dashboard is just
the viewing layer on top of the same database.

## Architecture

There's no server of its own and no intermediary API. The browser talks to
Supabase directly through two channels of the `@supabase/supabase-js` SDK:

- **Auth**: email/password login and signup.
- **PostgREST**: queries against the `funcionarios`, `tarefas`, `horas`,
  `etiquetas`, and `tarefa_etiqueta` tables, run with the logged-in user's
  session.

All the display logic (per-person/area aggregation, charts, export) runs in
the browser on top of whatever those queries return. There's no
server-side transformation.

**Access control is 100% Row Level Security on Postgres, not application
code.** The `SUPABASE_ANON_KEY` visible in `app.js` is public by design:
it's Supabase's `anon` key, made to run in the browser and sit in
source code in plain sight, and it grants no access on its own. Each RLS
policy only releases rows for the authenticated user whose email matches
`funcionarios.jira_email`/`clockify_email`; an anonymous session, or one
belonging to someone not on that list, sees zero rows in every table. The
two migrations checked into `sql/` cover the helper functions behind that
setup. The rest of the RLS policies, including `is_registered_employee()`,
used inside them to avoid recursion, were applied directly through the
Supabase SQL editor and aren't checked into this repository yet.

## Local development

No install step, no package manager: the three dependencies (Chart.js,
`@supabase/supabase-js`, SheetJS/XLSX) load from a CDN straight in
`index.html`, nothing is vendored locally.

Opening `index.html` directly via `file://` doesn't work reliably: the
Supabase client relies on per-origin `localStorage`/cookies, and browsers
treat `file://` as an unstable origin for that. Serve the folder with any
static file server, for example:

```bash
python3 -m http.server
```

or the VS Code Live Server extension. Then open the local URL in a
browser.

## Configuration

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are hardcoded near the top of
`app.js`. Pointing the dashboard at a different Supabase project (a
different environment, a different client) means changing those two
constants there. There's no `.env` and no build-time variable, because
there's no build.

## Features

- **Per-person view**: tasks, status, priority, and hours for one team
  member, with an avatar (photo from `funcionarios.photo_url` when set,
  falling back automatically to an initials circle if the URL fails to
  load or no photo is set).
- **Project view**: the same indicators aggregated across the whole team,
  tasks by area, overall status, hours by team member.
- **Task detail table**: the full table (per person or for the whole
  project), exportable to CSV (`;` separator with a UTF-8 BOM, so it opens
  correctly in Brazilian-Portuguese Excel) and to a real `.xlsx` via
  SheetJS.
- **Login and signup**: email/password through Supabase Auth. On signup,
  if the entered email isn't in `funcionarios`, the screen shows a
  non-blocking warning (the person can still proceed); it's a client-side
  heads-up only, RLS is what actually decides what they see after logging
  in.
- **Unauthorized signup logging**: every signup with an email outside
  `funcionarios` gets logged in the database by a trigger on
  `auth.users` (migration `002`), including attempts that skip the UI and
  call the Auth API directly. It records the email and the timestamp; it
  doesn't record the IP address, a Postgres trigger has no access to that
  information.

## Deployment

Hosted on Cloudflare Pages, connected to this repository's GitHub. No
build command, output directory is the repository root.

## Security and the `anon` key

The `SUPABASE_ANON_KEY` in `app.js` is **public by design** and is meant to
stay checked into version control and visible in the site's source. It is
**not** a secret, it's Supabase's `anon` key, built to run in the browser.

The actual access boundary is **Row Level Security (RLS)** on Postgres, as
described under Architecture above.

The key that should **never** land in this repository is `service_role`:
that one is secret and **bypasses RLS**. If it's ever needed (for example,
in a backend), it belongs outside the client, in an untracked `.env`.

## SQL migrations (`sql/`)

Apply in order in the Supabase **SQL editor**:

1. `sql/001_email_is_registered.sql`: the `email_is_registered(email)`
   function, used for the signup heads-up when an email isn't linked to
   Quimia.
2. `sql/002_log_unauthorized_signups.sql`: server-side logging of
   unauthorized signup attempts (depends on the function above).

## Unauthorized signup attempts

The "email not registered" warning on the login screen is only a
client-side heads-up, RLS is still the real boundary, so anyone who signs
up anyway still sees no data. To keep an actual **record** of these
attempts (including ones that skip the UI and call the Auth API directly),
migration `002` creates a database trigger that writes the email and
timestamp to `unauthorized_signup_attempts`.

There's no automatic notification yet, to check the log, run in the SQL
editor:

```sql
SELECT * FROM unauthorized_signup_attempts ORDER BY attempted_at DESC;
```

**Limitation:** only the **email** and the **timestamp** of the attempt are
recorded. The **IP address** isn't available to a Postgres trigger in this
setup, so it isn't captured here. Capturing IP would require a Supabase
Edge Function in front of signup, a bigger change, out of scope for now.

## Relationship to the other repositories

- **task-time-sync**: the pipeline that syncs Jira and Clockify into the
  same Postgres/Supabase database this dashboard reads from. This
  repository never writes to those tables, only queries them.
- **task-time-sync-docs**: the documentation site (MkDocs) with the fuller
  picture of the pipeline and the dashboard together, including the shared
  data model and the design decisions behind it.

## License

MIT, see [LICENSE](../../LICENSE).
