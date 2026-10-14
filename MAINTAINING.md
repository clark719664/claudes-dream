# Maintaining Cron Almanac

These are one-time settings that only the repository owner can change. Everything else, such as the license, contribution rules, templates and CI, is already in the repository.

## 1. Put the site live

1. Merge the release pull request into `main`.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **`main`** and **`/ (root)`**, then click **Save**.

The site appears at https://clark719664.github.io/claudes-dream/ within a few minutes. It updates every time a change is merged into `main`.

## 2. Lock down `main`

Only you have write access, so nobody else can push today. The ruleset in this repository also makes every change, including those from tools and bots, go through a pull request that you approve and that passes the tests.

1. Download [`.github/rulesets/protect-main.json`](.github/rulesets/protect-main.json) to your computer. Open it on GitHub, then use **Download raw file**.
2. Go to **Settings → Rules → Rulesets**, open the **New ruleset** menu, and choose **Import a ruleset**.
3. Pick the downloaded file. Before you click **Create**, check that:
   - **Enforcement status** is **Active**.
   - **Target branches** shows the default branch.
   - **Bypass list** shows **Repository admin**, allowed **for pull requests only**. Bypassing lets you merge your own pull requests without a second reviewer; nobody can push to `main` directly.
4. Click **Create**.

What the ruleset enforces on `main`:

- Changes only arrive through pull requests.
- Each pull request needs approval from the code owner (you, see `.github/CODEOWNERS`). Approval resets if new commits are pushed.
- The `test` check (CI) must pass, against the latest `main`.
- All review comments must be resolved.
- Nobody can force-push to or delete `main`.

If the import doesn't work, create the same rules by hand: **New ruleset → New branch ruleset**, then turn on each rule listed above.

## 3. Stop strangers' code from running in your Actions

Pull requests from forks can change the CI workflow. Make GitHub wait for you before running them:

1. Go to **Settings → Actions → General**.
2. Under the fork pull request approval setting, choose the strictest option: **Require approval for all external contributors**. Older screens call it "all outside collaborators".
3. Under **Workflow permissions**, keep **Read repository contents and packages permissions**, and leave **Allow GitHub Actions to create and approve pull requests** unchecked.

When a new contributor opens a pull request, read the diff, especially anything under `.github/`, before you click **Approve and run workflows**.

## 4. Turn on security features

Go to **Settings → Advanced Security** (older screens: **Code security and analysis**) and enable:

- **Private vulnerability reporting**, so people can report problems privately. `SECURITY.md` points them there.
- **Secret scanning** and **Push protection**, if they aren't on already. They're free for public repositories and block pushes that contain passwords or keys.

## Accepting a contribution

1. Read the change and check that CI is green.
2. If it changes how a scheduler is described, check the linked documentation.
3. Approve, then **Squash and merge**. The site updates automatically.

## Releasing a new version

Bump `version` in `package.json`, run `npm run build`, and merge through a pull request. The footer shows the version.

## Optional: rename the repository

A name like `cron-almanac` is easier to share. Rename it in **Settings → General**. GitHub redirects the old repository links, but the site moves to `https://clark719664.github.io/cron-almanac/`. Afterwards, update the links in `README.md`, `src/page.html`, `.github/ISSUE_TEMPLATE/config.yml` and `package.json`, then rebuild.
