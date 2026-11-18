# Render deployment guide

This deployment uses a Render web service and a MongoDB Atlas database. The
repository's `render.yaml` contains the non-secret service configuration.

## 1. Prepare the repository

Render deploys from a Git provider. Put this project in a private GitHub or
GitLab repository and make sure `.env`, `node_modules`, logs, uploads, backups,
and temporary files remain excluded by `.gitignore`.

Never commit `MONGODB_URI`, `SESSION_SECRET`, seed passwords, API tokens, or the
existing `.env` file.

## 2. Create the MongoDB Atlas database

1. Create an Atlas project and a Free cluster.
2. Create a database user with a unique, strong password.
3. In **Network Access**, allow the outbound IP addresses shown by Render for
   the web service. For an initial test only, `0.0.0.0/0` works but exposes the
   database endpoint to the internet; the database password then becomes the
   only network-level barrier.
4. Copy the Node.js connection string and replace its password and database
   name. A typical value looks like:

   ```text
   mongodb+srv://solar_app:URL_ENCODED_PASSWORD@cluster.example.mongodb.net/solar_agency?retryWrites=true&w=majority
   ```

URL-encode special characters in the username or password.

## 3. Create the Render service

1. In Render, choose **New > Blueprint**.
2. Connect the private repository and select `render.yaml`.
3. Enter the requested environment variables:

   - `APP_URL`: initially use the expected Render URL, such as
     `https://solar-agency-software.onrender.com`. Correct it after creation if
     Render assigns a different name.
   - `MONGODB_URI`: the complete Atlas connection string.

4. Render generates `SESSION_SECRET` automatically. Do not regenerate it after
   users begin signing in, because changing it invalidates existing sessions.
5. Deploy the Blueprint. The health check is `GET /healthz` and returns HTTP
   200 only when Mongoose is connected.

The Blueprint uses:

```text
Build command: npm ci
Start command: npm start
Runtime: Node 22
Region: Singapore
```

## 4. Create the first owner

The safest method is to run the seed command from a trusted computer while
temporarily using the production `MONGODB_URI` in that terminal:

```powershell
$env:MONGODB_URI = 'mongodb+srv://...'
$env:SEED_OWNER_NAME = 'Company Owner'
$env:SEED_OWNER_EMAIL = 'owner@company.pk'
$env:SEED_OWNER_PASSWORD = 'ReplaceWithAStrongPassword123'
npm run seed
Remove-Item Env:MONGODB_URI, Env:SEED_OWNER_NAME, Env:SEED_OWNER_EMAIL, Env:SEED_OWNER_PASSWORD
```

This does not place the owner password in Render's configuration or deployment
logs. The seed is idempotent: without `--force`, it leaves an existing account
unchanged.

Sign in at `/login` and change the initial password immediately.

## 5. Prevent free-service sleep during evaluation

Render Free web services spin down after 15 minutes without inbound traffic.
Configure UptimeRobot, Better Stack, or cron-job.org to send a GET request every
10 minutes to:

```text
https://YOUR-SERVICE.onrender.com/healthz
```

Use the HTTPS URL and expect HTTP 200. Do not monitor `/login`; `/healthz`
avoids session-store writes and page rendering.

An external monitor improves demo availability but does not turn a free service
into a production SLA. Platform restarts and deploys can still interrupt it.

## 6. Important free-tier limitations

### Uploads

Render Free has an ephemeral filesystem. Company logos and survey photos saved
under `public/uploads` can disappear after a restart or deployment. Before real
use, move uploads to persistent object storage such as Cloudinary, Amazon S3,
or an S3-compatible provider.

### Scheduled jobs

The application runs reminders, recovery checks, cheque alerts, maintenance
alerts, drawer opening, and backups with in-process `node-cron`. These jobs only
run while the web process is awake. An uptime monitor reduces missed runs but
does not guarantee them. Production should use an always-on paid instance or an
external scheduler with idempotent job commands.

### Backups

The current backup job invokes `mongodump` and writes to the local `backups`
directory. Render's Node environment may not include `mongodump`, and local
archives are not durable on a Free service. Use Atlas-managed backups on a paid
database tier or run scheduled off-platform backups to durable storage.

## 7. Post-deployment checks

Verify all of the following:

1. `/healthz` returns `status: ok` and `database: connected`.
2. The owner can sign in and sign out.
3. A second browser request preserves the session.
4. CSRF-protected create/edit forms submit successfully.
5. A PDF report downloads correctly.
6. The Render logs contain no database, session, or cron initialization errors.
7. Atlas metrics show connections from the Render service.

If the service cannot connect to Atlas, check the Atlas IP access list, database
credentials, URL encoding, and database name before changing application code.
