# Cosmos Notebook

A free community lab notebook for learning astrophysics and quantum physics at home.

- **Library:** step-by-step home experiments, books and tools. Anyone can browse without an account.
- **Accounts:** email + password sign-up with email confirmation and password reset.
- **My notebook:** each member tracks their own progress, data and write-ups, plus an observing log. Private by default.
- **Community feed:** members can share a write-up or observing night; others can like and comment.
- **Vetted suggestions:** members suggest new experiments, books and resources; admins review, edit and approve them before they join the library.
- **Journal tabs:** each experiment gets a folder tab per session (tap **+** for a new one), plus a Write-up tab — the only part that can be shared.
- **Stellar Lab** (`/lab/`): set a star's mass and watch its whole life — red giant, planetary nebula, supernova, neutron star or black hole — on a pixel-art view and a live HR diagram. You can keep adding mass to a white dwarf or neutron star until it goes Type Ia or collapses. The simulation is Rust compiled to WebAssembly and runs on the device.
- **Tonight's sky:** the Moon's phase, when it gets dark, which planets and bright clusters are well placed (all calculated on the device), an hourly cloud forecast with a GO / MAYBE / NO-GO verdict, and upcoming meteor showers and eclipses you can add to your calendar.
- **Auto-graphs:** any table of numbers in a journal entry, write-up, observing log or shared post becomes a pixel-style chart — live as you type. Pick what goes on each axis, add a best-fit line (with slope and R²), and each experiment's **Data** tab joins every session's tables into one graph with a CSV download.
- **Light, dark and red modes:** red is a night-vision mode with no white light at all, for using the site outside at the telescope.

Everything runs serverless on AWS, and there are **no npm dependencies** — just Node.js.

```
 Browser ──► CloudFront ──┬──► S3            the website (built by build.js)
   │                      └──► /api/* ──► API Gateway ──► Lambda ──► DynamoDB
   └──────► Cognito (sign-up, log-in, password reset)
```

---

## 1. Try it on your computer (no AWS needed)

Install [Node.js](https://nodejs.org) 20 or newer, then in this folder run:

```bash
node build.js
node scripts/dev-server.js
```

Open <http://localhost:4321> and create an account. The local server imitates AWS:

- **Confirmation and reset codes are printed in the terminal** instead of emailed.
- **The first account you create is an admin**, so you can try the review queue.
- Data is saved in `.dev-data/`. Delete that folder to start fresh.

Run all tests (API and astronomy) with `node --test api/test/*.test.js test/*.test.js`.

**Stellar Lab** needs [Rust](https://rustup.rs) to build its engine (once, and after changing `sim/stellar`):

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm      # → sim/stellar/target/…/stellar.wasm, copied into dist/ by build.js
npm run test:wasm       # the physics tests
```

Without it the rest of the site builds fine; `/lab/` just says the simulator couldn't load. GitHub Actions installs Rust and builds it on every run.

---

## 2. Put it on AWS (about 30 minutes, once)

**Cost:** at hobby scale this should be **£0–£2 a month**. CloudFront's Free plan covers the website, Cognito is free up to 10,000 monthly active users, and Lambda and DynamoDB have always-free allowances. API Gateway costs about $1 per million requests once any free-tier period ends. The API is rate-limited (20 requests a second by default) so a misbehaving script can't run up a bill.

### Step A — Set a budget alarm first
AWS console → **Billing → Budgets → Create budget → Zero spend budget**, then add your email.

### Step B — Put the code on GitHub
Create a free [GitHub](https://github.com) account and a new repository, and upload this folder, including the hidden `.github` folder.

### Step C — Create everything with one template
1. AWS console, region **Europe (London) eu-west-2** (top right).
2. **CloudFormation → Create stack → With new resources → Upload a template file** → choose `infra/cloudformation.yaml`.
3. Stack name `cosmos-notebook`. For **GitHubRepo** enter `your-github-name/your-repo`. Leave the rest.
4. Tick the IAM acknowledgement and **Submit**. Wait 5–10 minutes for `CREATE_COMPLETE`.
5. Keep the **Outputs** tab open.

> Already deployed the earlier blog version? Choose **Update stack → Replace existing template** on the same stack instead.
>
> If the stack fails because the GitHub identity provider already exists, recreate it with **CreateGitHubOIDCProvider** = `false`.

### Step D — Switch CloudFront to the Free plan
**CloudFront → Distributions** → your distribution → choose the **Free** pricing plan.

### Step E — Connect GitHub to AWS
GitHub repo → **Settings → Secrets and variables → Actions → Variables**. Add these from your stack's Outputs:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | `Region` output (e.g. `eu-west-2`) |
| `AWS_ROLE_ARN` | `DeployRoleArn` |
| `S3_BUCKET` | `BucketName` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `DistributionId` |
| `API_FUNCTION_NAME` | `ApiFunctionName` |
| `COGNITO_CLIENT_ID` | `UserPoolClientId` |
| `SITE_URL` | `SiteURL` |

No passwords or keys are stored. GitHub proves its identity to AWS, and the role can only update this one site.

### Step F — Deploy
**Actions** tab → **Deploy to AWS** → **Run workflow**. It runs the tests, uploads the API and the website, and refreshes the cache. Open your `SiteURL` and sign up.

From now on, **every push to GitHub deploys automatically.**

### Step G — Make yourself an admin
1. Sign up on your live site first.
2. AWS console → **Cognito → User pools → cosmos-notebook-members → Groups → admins → Add user to group** → pick your email.
3. **Log out and back in** on the site. An **Admin** link appears in the header.

The admin console is hidden from everyone else: there is no link, `/admin/` shows the normal "page not found", and the console's code isn't on the public site at all — the API sends it only to members of the `admins` group (`api/src/console/admin.js`). Admin API routes answer 404 to non-admins.

Or with the AWS CLI:

```bash
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> --username you@example.com --group-name admins
```

### Deploy from your computer instead
Leave **GitHubRepo** blank, install the [AWS CLI](https://aws.amazon.com/cli/), sign in, set the variables from the table above (`export AWS_REGION=...` etc.), then run `./scripts/deploy.sh`.

---

## Running a community: what to know

- **Emails:** Cognito's built-in email sender is limited to about 50 emails a day — fine to start. If you grow beyond that, connect Amazon SES in the Cognito console (*Messaging → Email*).
- **Moderation:** admins see a **Remove post** button on every community post and can delete any comment. Post authors can delete comments on their own posts.
- **What's public:** only what members choose to share — the write-up, their display name, and (for observing nights) the date, target, equipment and conditions. Email addresses and observing locations are never shown.
- **Limits:** each member can have up to 5 suggestions waiting for review. Notes are capped at 20,000 characters and comments at 2,000.
- **Backups:** the database has point-in-time recovery switched on, and the database, user pool and website bucket are kept even if the stack is deleted.

---

## Customising

| To change | Edit |
| --- | --- |
| Site name and tagline | `content/site.json` |
| Learning paths (and the plan's phases, which come from `road-map.md`) | `content/paths/*.md` — the format is described at the top of `src/paths.js` |
| The starter experiments and books | `content/experiments/*.md`, `content/reading/*.md` (`node scripts/new.js experiment "Title"` starts one) |
| Tools and resources list | `content/resources.json` |
| About page | `content/about.md` |
| Colours, fonts and the three themes | the variables at the top of `public/styles.css` |
| Sky events | `content/events.json` |

Members' approved suggestions live in the database, not in these files, so you can keep editing the starter library while the community grows it.

### Let others run their own copy
GitHub repo → **Settings → Template repository**. Anyone can then click **Use this template**, change `content/site.json`, and follow section 2 in their own AWS account.

---

## How the code is organised

```
content/            the starter library (Markdown) and site settings
web/js/             the app in the browser: auth.js (Cognito), api.js, ui.js, feed.js, pages/*.js
src/                shared by the build and the browser: Markdown (safe links), labels, pixel icons, astronomy, charts
api/src/app.js      every API route, with input checks and permissions
api/src/store.js    all database access (DynamoDB single-table design)
api/src/fake-dynamo.js   in-memory DynamoDB stand-in for local dev and tests
api/index.mjs       the Lambda entry point
api/test/           API tests (node --test)
test/               astronomy and chart tests
build.js            builds the website into dist/
scripts/            dev-server.js (local everything), deploy.sh, new.js
infra/              the CloudFormation template
.github/workflows/  test + deploy on every push
```

**Adding a feature** usually means adding a route in `api/src/app.js` (and a store method in `api/src/store.js` if it needs new data), a test in `api/test/`, and a page in `web/js/pages/` registered with `appPage(...)` in `build.js`.

## Stellar Lab: how it works

`sim/stellar` is a small Rust crate with no dependencies. `physics.rs` evolves a star from scaling laws (mass–luminosity, main-sequence lifetime ∝ M^-2.5, the white-dwarf initial–final mass relation, the Chandrasekhar and TOV limits) through each stage; `render.rs` draws a 320×180 pixel view (particles for winds, nebulae and debris; point-lens bending of background stars around black holes) and a 160×180 HR diagram into byte buffers. `lib.rs` exposes plain C-ABI functions, so there's no wasm-bindgen: `web/js/stellar.js` instantiates the module and copies the buffers onto canvases, and `web/js/pages/lab.js` is the controls. Explosions are softened for visitors who prefer reduced motion. The explainer text under the simulator is `content/lab.md`.

## Tonight's sky: how it works

- **Planet and Sun positions** come from NASA JPL's published orbital elements, calculated in `src/astro.js` — no external service. `test/astro.test.js` checks them against real oppositions, equinoxes and Moon phases.
- **Cloud forecasts and place search** come from [Open-Meteo](https://open-meteo.com/), a free weather service with no key or sign-up. Its free tier is for non-commercial use; if you ever charge for the site, check their terms.
- **Location** is saved only in the visitor's browser, rounded to about 1 km, and is sent only to Open-Meteo — never to your API.
- **Sky events** live in `content/events.json`. Yearly events use `"MM-DD"`, one-offs use `"YYYY-MM-DD"`. Add eclipses or other events there.

## Security notes

- Passwords are handled only by Cognito, over HTTPS; the site never stores them.
- The API checks every login token in API Gateway, before your code runs. Members can only read and change their own notebook; admin actions check the `admins` group and answer 404 to anyone else.
- All member writing is escaped before display, and links can only point to web addresses (no `javascript:` links).
- Log-in tokens are kept in the browser's local storage and expire after an hour, renewing automatically for up to 30 days.

## Safety

Never look at the Sun directly or through binoculars or a telescope — only ever use projection. Never point a laser at anyone's eyes. Keep a resistor in every LED circuit.
