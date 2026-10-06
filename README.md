# Turmoil Resource Tracker

A responsive, browser-based resource tracker for the Turmoil Forge Masters clan. Members sign in with Discord, record their weekly resources, and see the clan's combined inventory. The dark interface works on phones, tablets, and desktops; no native app is required.

To host it for your clan, follow the [beginner hosting guide](HOSTING-GUIDE.md) for Vercel, Neon, and Discord. It includes Windows-friendly secret generation and the exact settings to enter.

## Features

- Discord-only authentication with a configurable server membership requirement and optional required role.
- Weekly personal entries with instant save confirmation, notes, and a copy-from-previous-week action.
- Clan totals, a detailed member table, historical weeks, CSV export, and copy-to-clipboard.
- One combined Total eggs/pets quantity, with existing egg and pet rarity entries carried forward automatically.
- Weekly personal summoning costs, with whole-number skill and mount summon totals calculated per member.
- Potential clan war points in the Skill Tickets, Mounts to Merge, and Hammers cards, including a hammer estimate of 2–5 points each.
- Admin tools to edit any member's entry, promote or demote admins, and deactivate or reactivate members.
- Turmoil server nicknames and server avatars, last updated timestamps, and the identity of the member who last edited an entry.
- Persistent PostgreSQL storage in production, with a durable local PGlite database for development.
- Clan branding inspired by the Turmoil crest: charcoal surfaces, gold controls, emerald accents, and responsive logo artwork.

The stack is Next.js 16, React 19, TypeScript, and PostgreSQL. Discord OAuth is implemented on the server with authorization-code exchange and encrypted, expiring state validation. Session tokens live in HTTP-only cookies; privileged operations are checked on the server. The OAuth requests also include S256 challenge parameters, but Discord's documented flow does not guarantee provider-enforced PKCE.

## Clan branding

The full crest is stored in `public/turmoil-crest.png` and is optimized for each screen by Next Image. A simplified emerald-and-gold emblem is used in navigation (`public/clan-emblem.svg`) and the browser tab (`src/app/icon.svg`). `src/components/clan-brand.tsx` renders both logo variants.

The core palette is defined at the beginning of `src/app/globals.css`; clan-specific surfaces, controls, and responsive crest layouts are in `src/app/clan-theme.css`. Publishing design changes to the GitHub branch connected to Vercel triggers a new website deployment. Editing the downloaded Windows folder updates only the local copy.

## Run locally

On Windows with Node.js 22 or newer installed, extract the source ZIP and double-click `START-TURMOIL.bat` in the project folder. The launcher installs dependencies on the first run, starts the development demo, and opens the default browser. Keep its window open while using the app. It uses a separate local demo database and preserves existing environment files. See `START-HERE.txt` for the short instructions.

Use Node.js 22 or 24 LTS and npm.

```bash
npm ci
cp .env.example .env.local
```

For a local preview without Discord credentials, set `DEMO_MODE=true` in `.env.local`, then run:

```bash
npm run dev
```

The development server uses port 3000. Demo mode uses sample members and a separate durable database at `.data/turmoil-demo`; it is available only during development. It automatically opens as the sample admin **Kael**, with no real Discord identity or membership validation. Signing out reloads the same demo identity while demo mode remains enabled. Turn demo mode off and configure the credentials below when testing real sign-in.

For real authentication, follow the Discord setup below, set `DEMO_MODE=false`, provide the OAuth settings and a strong `AUTH_SECRET`, then start the development server. Without a `DATABASE_URL`, development stores real application data in `.data/turmoil`. These directories are ignored by Git. Restarting the server retains local data.

## Discord setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application, and name it **Turmoil Resource Tracker**.
2. Open **OAuth2**, copy the Client ID, and generate or copy the Client Secret. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in your local or hosting environment. Keep the secret on the server.
3. Add the exact callback URL to the application's OAuth2 redirects:
   - Local development: `http://localhost:3000/api/auth/callback`
   - Vercel production: `https://your-project.vercel.app/api/auth/callback`
   - Custom domain: `https://tracker.your-domain.com/api/auth/callback`
4. Set `APP_URL` to the matching origin, without a trailing slash or callback path. The scheme, hostname, and port must match the registered redirect. For example, `APP_URL=https://tracker.your-domain.com`.
5. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click the Turmoil server and select **Copy Server ID**. Set that value as `DISCORD_GUILD_ID`.
6. If access should require a particular role, open **Server Settings → Roles**, copy the role's ID, and set `DISCORD_ROLE_ID`. Leave it empty to admit any member of the configured Turmoil server.
7. Sign in with a Discord account that belongs to the configured server and, if enabled, has the required role.

The app requests only `identify` and `guilds.members.read`. Discord server membership is always required; the role restriction is an additional check. No bot installation, privileged gateway intent, or Discord bot token is needed. The app stores the immutable Discord user ID and actual account username separately from the displayed clan profile, then creates its own application session. Sessions expire after seven days. Membership and the required role are checked at login and rechecked on requests after five minutes; Discord OAuth tokens refresh automatically. Application Admin/Member permissions are separate from Discord roles.

Names shown throughout the tracker prefer the member's **Turmoil server nickname**, then their global Discord display name, then their account username. Server-specific avatars take priority over global or default Discord avatars. Profiles refresh at sign-in and during the membership checks; sign out and back in to pick up a change immediately. Removing a server nickname or avatar restores the global fallback. Existing members adopt their server profiles as they next sign in or use the tracker; changing a name does not create a new member or affect resource history and permissions.

Register each actual callback you use. A changing Vercel preview domain needs its own registered redirect and matching `APP_URL`; use a stable staging domain for repeated OAuth testing.

## Initial admin and member access

For a deliberate initial admin, enable Discord Developer Mode, right-click that user's profile, choose **Copy User ID**, and set `INITIAL_ADMIN_DISCORD_ID` before the first login. Only that account is automatically assigned Admin. Other approved accounts can still log in as Members while waiting for the designated admin.

If `INITIAL_ADMIN_DISCORD_ID` is empty, the first approved Discord login becomes Admin. Initial assignment is protected by a database transaction and lock, so simultaneous first logins cannot both win that assignment.

Admins can promote more admins in **Manage Members**. The app prevents demoting or deactivating the last active admin. Deactivation preserves historical entries, blocks that member's tracker access, and excludes their resources from the active clan totals; reactivation restores access. Logging in again does not reactivate a disabled account.

## Environment variables

Copy [.env.example](.env.example) for local configuration. In production, enter values in the hosting provider's environment settings. Never commit secrets or expose these variables with a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Canonical application origin, such as `http://localhost:3000` or `https://tracker.example.com`. Used to build Discord redirects. |
| `AUTH_SECRET` | Required for real authentication. A random secret of at least 32 characters used to encrypt stored Discord OAuth tokens and pending OAuth state. |
| `DISCORD_CLIENT_ID` | OAuth application's Client ID. |
| `DISCORD_CLIENT_SECRET` | OAuth application's Client Secret. |
| `DISCORD_GUILD_ID` | Turmoil Discord server ID. `DISCORD_SERVER_ID` is accepted as an alternative name. |
| `DISCORD_ROLE_ID` | Optional required Discord role ID within that server. |
| `INITIAL_ADMIN_DISCORD_ID` | Optional Discord user ID that receives the initial Admin role. |
| `DATABASE_URL` | PostgreSQL connection URL for hosted deployments. Optional for development, which uses local PGlite when empty. |
| `DEMO_MODE` | Set to `true` only for the sample-data development preview. Set to `false` for real authentication and production. |
| `LOCAL_DATABASE_PATH` | Optional override for the local PGlite data directory; relative paths resolve from the project directory. |

Generate a local authentication secret with:

```bash
openssl rand -base64 48
```

Use a persistent secret across deployments. Rotating it invalidates encrypted Discord tokens, so existing users will need to sign in again. Production also requires HTTPS; secure session cookies are enabled there.

## Database and weekly data

Production uses a standard PostgreSQL connection and works with providers such as Neon, Supabase Postgres, or another managed PostgreSQL service. Provide the provider-supported connection URL and TLS settings; keep certificate verification enabled. Supabase's PostgreSQL connection URL is used directly—the app does not require a Supabase browser key or Supabase Auth.

For manual database initialization, run the idempotent migration:

```bash
npm run db:migrate
```

Database initialization also runs on first application access. Migrations create the application's tables and constraints, add profile columns to existing member tables, and add weekly summoning costs to existing resource entries without resetting data. The configured PostgreSQL role needs permission to create and alter these tables and indexes because initialization also runs at application startup. The migration uses the same database configuration as the app.

The schema has three tables:

| Table | Stored data |
| --- | --- |
| `app_members` | Unique Discord user ID, raw account username, displayed clan name/avatar, global name/avatar fallbacks, Admin/Member role, active status, join time, and most recent resource update time. |
| `resource_entries` | One entry per member and week, resource quantities in `resources` JSONB, personal skill/mount costs in `summoning_costs` JSONB, optional notes, last update time, and the member who last edited it. |
| `auth_sessions` | Session-token hashes, member association, expiration, encrypted Discord OAuth tokens, and membership-check timestamps. |

Weeks start on **Monday at 00:00 UTC** and are stored using the Monday's `YYYY-MM-DD` date. Each entry contains Skill Tickets, **Total eggs/pets**, Mount Keys, Mounts to Merge, and Hammers. Total eggs/pets combines all eggs to hatch and pets to merge into one quantity. Existing entries that stored twelve separate egg and pet rarity quantities are automatically added together when read; their other resources, costs, notes, and timestamps are preserved. An explicitly saved combined value, including zero, takes precedence over older rarity fields. All quantities are nonnegative whole numbers and default to zero. Input boxes can be cleared while typing; saving an empty box stores zero. A uniqueness constraint keeps one entry per member per week. Saving an existing entry updates it.

Members can edit only their own entries; admins can edit any active member's entry. The database preserves historical weeks. Clan totals sum active members' saved quantities for the selected week, and members with no submission contribute zero. Export and clipboard actions apply to the currently selected week.

Choose a week, open **My Resources**, enter quantities, and select **Save resources** to persist the entry and update the clan totals. Enter **Cost of summoning 5 skills** beneath Skill Tickets: it must be **150–200 inclusive**, with up to **one decimal place**, such as **175.5**. **Cost per mount summon**, beneath Mount Keys, must be **37.5–50 inclusive** and accepts decimals. Both costs are required when saving; blank or zero costs are invalid. They can still be cleared while typing. Other blank resource quantities save as zero. Costs belong to that member's selected week. Existing historical prices remain stored, including legacy missing costs, and must meet the current ranges when an entry is edited and saved.

The Skill Tickets and Mount Keys dashboard cards include **Total skill summons** and **Total mount summons**. For each active member with a saved entry and a positive cost, skill summons are `skillTickets / fiveSkillsCost × 5` and mount summons are `mountKeys / mountCost`. The tracker adds everyone's exact results first, then rounds each clan total to the nearest whole number; a final `.5` rounds up. For example, members with 10 tickets at a cost of 3 and 5 tickets at a cost of 2 contribute approximately 16.667 and 12.5 skill summons, totaling approximately 29.167, displayed as **29**. The dashboard, member contributions table, CSV, and clipboard export use the same five resource quantities, including the combined Total eggs/pets. Summoning costs and calculated summon totals appear outside the member table and inventory exports.

A legacy zero or missing cost contributes zero summons for that resource, while the member's saved tickets and keys still count in the inventory totals. Each affected card shows how many members have positive inventory but a missing cost, so the clan knows its summon count is incomplete. Members with zero corresponding inventory or no saved entry do not trigger that notice. Submissions from older clients that omit the entire `summoningCosts` field preserve an entry's stored costs; a supplied cost object must include both numeric fields and meet the current ranges and precision rules.

The Skill Tickets card also shows **Potential clan war points** as the displayed Total skill summons multiplied by **225**. The Mounts to Merge card shows its selected week's combined Mounts to Merge multiplied by **1,080**. The Hammers card estimates a range from the selected week's combined Hammers multiplied by **2** to Hammers multiplied by **5**; for example, 1,000 hammers estimates **2,000–5,000 points**. These points estimates use whole numbers, update with the selected week's resources, and remain outside the member table and inventory exports. **Total eggs/pets** appears in the dashboard's top row alongside Skill Tickets and Mount Keys, and first on mobile. Missing skill costs also make the skill-points estimate incomplete, as indicated by that card's missing-cost notice.

**Copy previous week** copies quantities, both summoning costs, and notes from the immediately preceding week and saves them in the selected week; it replaces any existing selected-week entry after confirmation. The **Weeks** view includes saved weeks, the current week, and your selected week. The date picker can open a week with no entry yet.

## Deploy to Vercel

1. Create a managed PostgreSQL database and copy its supported connection URL. A connection pooler is recommended for serverless deployments; follow the provider's connection and TLS guidance.
2. Import this repository into Vercel. Use the **Next.js** preset, Node.js 22 or 24, `npm ci` for installation, and `npm run build` for the build.
3. Add the production environment variables from the table above. Set `DATABASE_URL`, a strong `AUTH_SECRET`, the Discord client/server settings, and `DEMO_MODE=false`. Set the optional role and initial-admin IDs as appropriate.
4. Choose the production hostname and set `APP_URL` to its HTTPS origin. Add the corresponding full `/api/auth/callback` URL to the Discord application. Repeat these settings if you add a custom domain.
5. The app initializes its tables automatically on first database access. For optional manual initialization, run `npm run db:migrate` from a trusted environment with the same database configuration. Protect connection credentials; do not paste them into source code or build commands.
6. Deploy. Open the application in a browser and log in as the designated initial admin, or let the first approved member establish the Admin account when no ID is designated.
7. Verify that a second clan member can save a weekly entry and that the dashboard shows its quantities. Verify that a Discord account outside the configured server is denied.

Local PGlite data is not a production database: Vercel filesystems are temporary and separate across instances. Set `DATABASE_URL` for hosted deployment. Demo mode is rejected in production. The application requires the Node.js runtime for its database driver; do not configure these server routes as Edge functions.

For another Node.js host, use the same environment variables, migrate the hosted database, then run `npm run build` and `npm run start`. Configure the host's HTTPS proxy and public origin to match `APP_URL`.

## Development checks

```bash
npm run typecheck
npm test
npm run build
```

`npm run dev` starts the development server. `npm run start` serves a production build. `npm run db:migrate` initializes the configured database. Real Discord login requires an OAuth application and an authorized Discord account; local demo checks do not substitute for that integration check.

The browser suite covers desktop and mobile layouts, resource and summoning-cost persistence, blank inputs, copying a previous week, per-member summon totals and missing-cost notices, CSV export, and admin changes. Start the demo server in one terminal:

```bash
DEMO_MODE=true npm run dev
```

In a second terminal, run:

```bash
npm run test:browser
```

These workflows run only against demo mode, ensure the required sample entries have valid prices, and restore the resource values, valid costs, and member settings changed during each test. For an isolated test database, also set `LOCAL_DATABASE_PATH=.data/turmoil-browser-tests` when starting the server. The suite uses `/usr/bin/chromium` if present. Set `CHROMIUM_PATH` to another system Chromium executable, or install Playwright's browser with `npx playwright install chromium`. The default test origin is `http://localhost:3000`; set `PLAYWRIGHT_BASE_URL` and the matching server `APP_URL` if using another origin.

## Troubleshooting

- **Discord rejects the redirect:** check the complete redirect in the Developer Portal against `APP_URL` plus `/api/auth/callback`, including protocol and port.
- **Membership or role denied:** confirm the copied server ID, confirm the account belongs to that server, and check the required role ID if configured.
- **Missing configuration:** use demo mode only for local previews, or supply the OAuth variables and `AUTH_SECRET` for real sign-in. Production needs a hosted `DATABASE_URL`.
- **No admin access:** sign in as the configured `INITIAL_ADMIN_DISCORD_ID`, or ask an existing active admin to promote your account. Changing the configured ID does not demote existing admins.
- **Database connection fails:** confirm the connection URL, provider allowlist, TLS configuration, and database permissions. Use the hosting provider's supported connection format.
- **A member cannot regain access:** an admin must reactivate deactivated members; Discord sign-in does not override deactivation.

Keep database backups and protect the Discord application secret, authentication secret, and database credentials. Restore local development data from `.data` when moving a development workspace; managed production databases should use their provider's backup facilities.
