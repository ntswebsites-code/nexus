# Matanho Nexus

Institutional investment platform: four Next.js portals sharing one Express API, one MySQL
database (via Prisma) and one authentication system. The UI is the original V56 prototype,
preserved exactly.

| Portal | Port | Package |
| --- | --- | --- |
| Admin (Investment OS) | 3100 | `portals/admin-web` |
| Investor | 3101 | `portals/investor-web` |
| Public onboarding | 3102 | `portals/onboarding-web` |
| Portfolio company | 3103 | `portals/company-web` |
| Shared API | 4100 | `backend/api` |

Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
Cleanup notes: [`docs/CLEANUP-NOTES.md`](docs/CLEANUP-NOTES.md) ·
Future tables: [`docs/DOMAIN-ENTITIES.md`](docs/DOMAIN-ENTITIES.md)

## Requirements

* Node.js >= 22.9 and npm >= 10
* MySQL 8 (a running server and one empty database + a shadow database for `prisma migrate dev`)

## First-time setup

```bash
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
# edit .env: DATABASE_URL / SHADOW_DATABASE_URL (replace CHANGE_ME)
```

Create the databases and a dedicated MySQL user (run as a MySQL admin):

```sql
CREATE DATABASE matanho_nexus        CHARACTER SET utf8mb4;
CREATE DATABASE matanho_nexus_shadow CHARACTER SET utf8mb4;
CREATE USER 'matanho_app'@'%' IDENTIFIED BY '<choose-a-password>';
GRANT ALL PRIVILEGES ON `matanho_nexus`.*        TO 'matanho_app'@'%';
GRANT ALL PRIVILEGES ON `matanho_nexus_shadow`.* TO 'matanho_app'@'%';
```

Apply migrations and seed the roles (optionally a first user):

```bash
npm run db:generate
npm run db:deploy               # applies committed migrations
npm run db:seed                 # 14 roles taken from the prototype
# optional first user (values only in your shell, never committed):
#   SEED_USER_EMAIL=you@example.com SEED_USER_PASSWORD='at-least-10-chars' npm run db:seed
```

## Run everything (development)

```bash
npm run dev                     # API + the four portals together
```

or individually, each in its own terminal:

```bash
npm run dev:api                 # http://localhost:4100   (GET /api/health)
npm run dev:admin               # http://localhost:3100
npm run dev:investor            # http://localhost:3101
npm run dev:onboarding          # http://localhost:3102
npm run dev:company             # http://localhost:3103
```

Each portal has a shared sign-in page at `/login`. By default portals open without an account
(UI mock-up mode); set `REQUIRE_AUTH_PORTALS=admin,investor` to force sign-in.

## Build and production start

```bash
npm run build                   # API + all four portals
npm run start:api
npm run start:portals
```

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-check shared packages and the API |
| `npm run db:migrate -- --name <name>` | Create + apply a new migration (dev) |
| `npm run db:studio` | Prisma Studio |
| `npm run smoke -w @matanho/api` | End-to-end auth checks against a running API |
| `npm run legacy:extract` | Regenerate the prototype assets from git history |

## Security notes

* `.env` is git-ignored; only `.env.example` (placeholders) is committed.
* Passwords are bcrypt-hashed; sessions are opaque tokens in an `httpOnly` cookie, stored hashed.
* Browsers never talk to MySQL; only the API does.

## Legacy static prototype

The original static files are archived in [`legacy-static/`](legacy-static). The existing
Dockerfile / Pages workflow still deploy that archive - see the cleanup notes.
