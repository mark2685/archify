# Archify for Hadrian

This repository is Hadrian's fork of [Archify](https://github.com/tt-a1i/archify) (MIT), the agent Skill that turns typed JSON into a self-contained interactive HTML diagram. The fork makes three changes and otherwise tracks upstream:

1. **Diagrams render in Hadrian's brand by default**, in light and dark, in the browser and in every export (SVG, PNG/JPEG/WebP, Share Cards, WebM), through a new `hadrian` visual preset.
2. **The repository is English-only**: no non-English locale catalogs, docs, examples, prose or tests.
3. **The upstream update reminder is off**, so a Hadrian installation never asks to install upstream over the fork.

Current fork version: `3.2.0-hadrian.1`, built on upstream `v3.2.0` (`e62275b`) plus the unreleased upstream commits up to `25cf370`. Everything not listed here is upstream Archify; read [`archify/SKILL.md`](archify/SKILL.md) and upstream's [README](https://github.com/tt-a1i/archify#readme) for what it does.

## Install

The Skill is the `archify/` directory. Install it with the Skills CLI from the Hadrian repository:

```bash
npx -y skills add Hadrian-MTV/archify --skill archify -g
```

Discover before installing (expect exactly one Skill named `archify`): `npx -y skills add Hadrian-MTV/archify --list --full-depth`. Project-scoped, non-interactive variants follow upstream's shape, for example `npx -y skills add Hadrian-MTV/archify --skill archify --agent codex --copy --yes`. The Skills CLI clones with git, so a private `Hadrian-MTV/archify` works for anyone whose git credentials can read it. Installing from a local checkout (`npx -y skills add /path/to/archify --skill archify ...`) also works but copies the checkout's `archify/node_modules` with it; prefer the repository URL.

The installed Skill needs only Node 18 or newer. The final browser check (`finalize --browser-check`, `visual-check`) needs Chrome, Chromium or Edge; see [Browser for the browser gate](#browser-for-the-browser-gate).

Nothing here updates a live installation; reinstalling is the update path.

## What differs from upstream

### The `hadrian` visual preset (default)

- `viewer/hadrian.css` is a new stylesheet fragment inlined into the generated template beside upstream's `viewer.css`. It defines the preset from Hadrian design-hub tokens (`Hadrian-MTV/design`: `src/index.css` `@theme` and the `color` records of `backend/migrations/seed/registry-seed.sql`) and nothing else.
- Documents without `meta.visual_preset` resolve to `hadrian` in the HTML root, the canonical SVG and every export. Upstream's `classic`, `signal-flow`, `blueprint` and `editorial` remain valid values of `meta.visual_preset`.
- The Viewer's style picker offers **Hadrian** and **Editorial**. The other three are hidden unless the document was authored with one of them, in which case that one is also offered. `S` cycles the offered styles. Exports always use the reader's current style, as upstream.
- The explainer (one-page answers) keeps its own four page styles and English copy; its embedded native diagrams open in `hadrian` (or `editorial` for the editorial page style). Restyling the explainer page itself is open; see [Open items](#open-items).

#### Brand rules

Carried over from the Hadrian documentation-site rules (`Hadrian-MTV/quorum` `docs/brand.md`):

| Rule | How the preset meets it | Guard |
| --- | --- | --- |
| Colours only from hub tokens | Every hex literal lives in a `--color-*` token in `hadrian.css`; all other declarations use `var()`. Derived colours (the hub's white alpha stops on navy, category tints/shades, node fills) are precomputed tokens annotated `/* derived: <token> <p>% over <token> */`. | `test/hadrian-tokens.test.mjs` recomputes each derivation from the hub literals. |
| Square corners | `border-radius: 0 !important` on everything in the preset; `rx: 0` on SVG rects; label chips squared in `node-card-style.mjs`. | `test/hadrian-shape-browser.test.mjs` measures computed styles in Chrome. |
| No shadows or glows | `box-shadow`, `text-shadow`, `filter`, `backdrop-filter` all `none`; motion halos zeroed. | same |
| Every edge a 1px hairline | `border-width: 1px` on panels, menus, cards and `kbd`; hairlines are white 16%/32% on navy (as opaque mixes) and gray-200/gray-300 on the light ground. | same (no visible border wider than 1px) |
| Hadrian's fonts | Page chrome uses `"Sohne", "Inter", system-ui…`; labels, `kbd` and toolbar controls use `"Sohne Mono", ui-monospace…`. Söhne is licensed and never embedded; the stack falls back. **The SVG diagram keeps the embedded JetBrains Mono (OFL)**: the validators guarantee label fit from its metrics and every export embeds the same bytes, so any other face would break the layout contract. | `hadrian-tokens` (fonts change only on `html`, never on `svg`) |
| Stratosphere Blue only for interactive state on navy | Used once: the keyboard-focus ring (`outline-color`) in dark; blue-600 in light. Upstream's single accent (`--frontend-stroke`) stays the frontend category colour, so Stratosphere does not become a general accent. | `hadrian-tokens` |
| Gold reserved for one meaning | Gold colours only the **message bus** (and its async-edge labels): "events in transit". | `hadrian-tokens` |
| Text ≥ 4.5:1 | Every ink token against every surface it can sit on, and ~100 rendered text elements per mode and theme, in both themes. | `test/hadrian-contrast.test.mjs` |
| Categories tell apart | Every pair of category fills is at least 8 CIE76 ΔE apart and every pair of outlines at least 15, in each theme; see [Node fills](#node-fills). Rendered architecture and workflow nodes paint exactly those tokens. | `test/hadrian-distinguishability.test.mjs`, `test/hadrian-category-paint-browser.test.mjs` |

Why derived colours are hex rather than `color-mix()`: Chrome serialises `color-mix()` results as `color(srgb …)`, which upstream's contrast tests cannot parse, and exported SVGs would then depend on `color-mix()` support outside browsers. Plain colours export everywhere; the derivation is still verifiable.

#### Colour mapping

Archify's semantic categories map to one hub family each. Ratios are contrast against the page ground / the raised panel / the category's own node fill (where its tag text sits).

| Category (also lifecycle state) | Dark on navy `#002548`, raised `#062e54` | Light on gray-100 `#f4f6f9`, white | Family and meaning |
| --- | --- | --- | --- |
| frontend (start, active) | blue-200 `#a2cef7` · 9.4 / 8.3 / 6.8 | Heritage Blue `#13497d` · 8.5 / 9.2 / 7.6 | the brand's primary blue: user-facing |
| backend (success) | status-green `#9bc08f` · 7.6 / 6.8 / 5.6 | status-green 50 % over black `#4e6048` · 6.3 / 6.8 / 5.1 | hub's "completed work" colour |
| database (decision) | Defense Green 60 % over white `#b3b197` · 7.1 / 6.3 / 4.8 | Defense Green 45 % over black `#3a3824` · 11.0 / 11.9 / 9.0 | the brand's Secondary: grounded, persisted |
| message bus (async edges) | gold-400 `#ffb830` · 8.9 / 8.0 / 6.3 | gold-700 `#8c5d01` · 5.3 / 5.7 / 4.6 | Liberty Gold's one meaning: events in transit |
| security (failure) | status-red `#e79089` · 6.4 / 5.7 / 4.6 | status-red 60 % over black `#8b5652` · 5.5 / 5.9 / 4.8 | hub's "declined work" colour |
| cloud (waiting; region frames) | gray-400 `#a5aeb6` · 6.9 / 6.1 / 5.5 | gray-700 `#5c6167` · 5.8 / 6.2 / 5.8 | neutral container, like lanes |
| external | gray-300 `#c6cacd` · 9.4 / 8.3 / 8.3 | gray-800 `#414448` · 9.0 / 9.8 / 9.8 | quiet: the same ink as muted text, as upstream's classic does |
| text / muted / dim | white 15.5 · white 72 % over navy `#b8c2cc` 8.6 · gray-400 6.9 | navy 14.3 · gray-800 9.0 · gray-700 5.8 | hub ink ladder |
| relationship arrows / **emphasis path** | gray-400 / **white** | gray-700 / **navy** | the primary path is drawn in ink; this also removes upstream's light-mode label contrast bug (#1017) |
| focus ring | Stratosphere Blue `#70b8fd` · 7.3 | blue-600 `#0258ab` · 6.5 | interactive state only |

The hub has five chromatic families for seven categories, so **cloud and external share the gray family** one step apart; both already carry distinct sigils and cloud is mostly dashed frames. Backend (status green) and database (Defense Green) are both yellow-greens, so in light mode the database shade is deep (45 % over black) to sit 18 ΔE from the backend shade. Lifecycle `success`/`failure` reuse the backend/security tokens; a `svg[data-lifecycle-layout]` override pins them to the status colours should the architecture mapping ever move away from them.

#### Node fills

A node's fill must name its category on its own, not only through a 1px outline. The first palette tinted every node 13 % (dark) or 10 % (light) of the muted hub colour, which left most fill pairs 1–3 ΔE apart (backend/database 0.9 in light), below what anyone sees. The fills now follow two rules, each as strong as text contrast allows:

- **Dark:** the most saturated member of the category's family mixed into the navy ground, as far as gray-400 ink (`--text-dim`, `--arrow`) and the category's own tag ink keep 4.5:1. That cap is what limits dark fills: they all sit near L\* 25–27 and differ in hue, so mixing a vivid source (blue-500, Liberty Gold, Defense Green itself) at 16–34 % carries more colour than a pale one at a higher percentage.
- **Light:** the family's light member over white, as deep as gray-700 ink keeps 4.5:1. Message bus uses the hub's own gold-200 step.
- **Quiet grays:** cloud barely lifts (gray-400 6 % over raised; gray-100 in light) and external keeps the panel colour (raised; white), so both read as neutral beside five tinted categories.

| Category | Dark fill | Light fill |
| --- | --- | --- |
| frontend | blue-500 24 % over navy `#063b6e` | blue-200 39 % over white `#dbecfc` |
| backend | status-green 16 % over navy `#193e53` | status-green 45 % over white `#d2e3cd` |
| database | Defense Green 34 % over navy `#2c434b` | Defense Green 23 % over white `#e2e1d7` |
| message bus | Liberty Gold 22 % over navy `#354038` | gold-200 `#ffe5b2` |
| security | status-red 21 % over navy `#313b56` | status-red 25 % over white `#f9e3e2` |
| cloud | gray-400 6 % over raised `#10365a` | gray-100 `#f4f6f9` |
| external | raised `#062e54` | white `#ffffff` |

The closest pairs are 8.9 ΔE in dark (security/cloud) and 9.1 in light (backend/database); outlines are at least 16.8 apart (light database/external). The lowest text-on-fill ratios are 4.63 (dark security tag ink on its fill), 4.64 (dark gray-400 on database, light gray-700 on backend) and 4.65 (light gold-700 on gold-200): above the floor, with little margin, which is the price of the stronger tints. Any further strengthening of the dark fills needs a lighter `--text-dim`/`--arrow` ink first.

`test/hadrian-distinguishability.test.mjs` measures every category pair's fill and outline in CIELAB (CIE76) in both themes: fills ≥ 8, outlines ≥ 15. Cloud/external share the gray family and are allowlisted, with the reason in the test, at fills ≥ 3 and outlines ≥ 10 (currently 4.1/3.6 and 11.0/12.3). Its second test proves the check rejects a palette where database collides with backend.

Upstream's shared card style (`archify/renderers/shared/node-card-style.mjs`) recomputes dark architecture and workflow nodes as 13 % of the stroke over the mask with a 72 % stroke. The fork skips that rule for the Hadrian preset, so nodes paint the tuned tokens; `test/hadrian-category-paint-browser.test.mjs` compares every rendered node's fill and stroke with its tokens in Chrome so the token guards keep measuring what is painted.

### English-only

- Bundled Viewer catalogs: `en` only (`archify/locales/manifest.json`). `meta.locale` and `meta.translations` keep their contract: any other well-formed tag renders English renderer-owned copy with the existing `i18n/locale-fallback` warning unless the document supplies a catalog. The i18n suites prove the catalog machinery with a synthetic pseudo-locale derived from `en.json`.
- Removed: `README_EN/ZH/JA/KO.md`, the `zh-CN`, `zh-TW`, `es`, `ko`, `ar` catalogs, `archify/examples/locales/*`, the Chinese halves of reference docs, Chinese prompts in the scenario guide (`--lang` accepts `en`), the explainer's Chinese dictionary and Chinese-only writing lints (its default locale is `en`), Chinese code comments (translated), and the WeChat/Douyin CJK brand aliases (romanized forms stay). Shipped examples (`holiday-planning.workflow.json`, `delivery.explainer.json`) are translated.
- Kept, deliberately: general Unicode handling. `textUnits`/`FULLWIDTH_RE` wide-glyph measurement, the sequence renderer's CJK closing-punctuation wrap rule, the explainer's reading-unit counter and sentence terminators, and the vertical-axis-title rule for CJK chart labels. Where such code or a test needs a wide glyph, it is written as a `\uXXXX` escape. **Escaped code points are ASCII and pass the scan; they are not prose.** Fixtures under `test/fixtures/` that reproduce real layout regressions keep their original wide-glyph labels this way (about 30 files), so the regressions measure the same geometry.
- Guard: `scripts/check-english-only.mjs` runs in `npm run test:generated` and fails on any non-Latin-script character in tracked text outside `scripts/english-only-allowlist.json`, where every entry needs a reason and a stale entry fails too. The single allowed file is the vendored `.agents/skills/simplify-codebase/SKILL.md`, whose pinned upstream description lists Chinese trigger phrases. `test/english-only.test.mjs` proves the scan on CJK, Hangul, Cyrillic and Arabic samples.

### Dropped surfaces

Removed because they are bilingual by design, serve upstream's community, or are upstream research with no Hadrian use: `website/`, the GitHub Pages site (`docs/index|gallery|guide|start.html`, `docs/gallery/`, `docs/cases/`, their builders and templates under `scripts/`), `docs/specs|evidence|reviews|research|reading-evidence|releases|skill-updates` and the article files, `community/`, `integrations/` (DeepSeek Harness, Hermes), `journal/`, `experiments/`, `benchmarks/`, `tools/contributor-cards`, the star-history and contributor-card workflows, and the tests that covered only them. Kept: `docs/assets/` (README artwork; sponsor, community and payment images pruned), `docs/authoring-cookbook.md`, upstream's `CONTRIBUTING.md`, `REVIEWING.md`, `DESIGN.md`, `PRODUCT.md`, `ROADMAP.md` and `CHANGELOG.md` for reference.

`scripts/render-fork-examples.mjs` re-renders every checked-in example artifact, the repository showcases and the checkout delta proof from tracked sources (upstream regenerated these by hand).

### Update check

`archify/skill-release.json` carries `"updateChecks": false`. `check-update.mjs` returns `{ status: "silent", reason: "disabled" }` before touching the network or the cache, and `deliver`/`finalize` receipts report `update.status: "unavailable"`, `update.reason: "disabled"`. The upstream manifest machinery is kept intact (its 3,000-line test suite still runs against copies of the release file with the flag removed), so merges stay clean. The repository and manifest URL in `skill-release.json` still name upstream: they record the lineage the contract validates, not an update source.

### Versioning

Fork versions are `X.Y.Z-hadrian.N`: `X.Y.Z` is the upstream release the fork is built on and `N` counts fork revisions on it. `archify/package.json`, its lockfile, `archify/SKILL.md` (`X.Y`), both templates' generator meta, `README.md` and this file must agree; `scripts/check-release-identity.mjs` (part of `test:generated`) checks that, that the core is a published upstream release in `CHANGELOG.md`, and that `updateChecks` is `false`. `update-contract.mjs` recognises `hadrian` as its own release channel beside upstream's `stable` and `development`.

**Semver caveat:** a prerelease sorts *before* its release, so `3.2.0-hadrian.1 < 3.2.0`. Any tool that compares versions (including upstream's own `compareSemver`) will consider the fork older than the upstream release it is built on. That is accepted: the fork never participates in upstream's update manifest, and the honest "built on" identity is worth more than a sort order.

Tag releases `vX.Y.Z-hadrian.N`.

### Licence

Archify is MIT licensed: `LICENSE` and `archify/LICENSE` (copyright tt-a1i and Cocoon AI) are byte-identical to upstream and must stay so. The fork's modifications are © Hadrian Automation and are also released under the MIT licence; this file is the notice. `THIRD_PARTY_NOTICES.md` (Simple Icons marks, JetBrains Mono under the SIL OFL 1.1) is unchanged; the fork adds no third-party material. Söhne is named in a font stack and never embedded.

### Other fork files

- `.github/workflows/hadrian.yml`: the fork's CI (generated checks, English-only scan, full regression, Node 18/20/24 smoke, two browser shards with the brand guards, ZIP freshness). Upstream's `ci.yml` and `release.yml` are kept byte-for-byte because several contract tests parse them; **disable them in the repository's Actions settings**, since they expect upstream's website, integrations and release channels.
- `archify/bin/visual-check.mjs` launches Chrome with `--use-mock-keychain`: Chrome for Testing cannot keep a macOS "Always Allow" keychain grant and otherwise prompts on every headless profile.
- `test/helpers/hadrian-browser.mjs`, `test/hadrian-*.test.mjs`, `test/english-only.test.mjs`, `test/fork-update-check.test.mjs`: the fork's guards.

## Verifying

```sh
npm ci && npm --prefix archify ci
npm run test:generated     # viewer, brand marks, validators, release identity, English-only scan, goldens
npm run test:full          # generated checks + every Node test file
ARCHIFY_CHROME="/path/to/chrome" npm run test:browser   # real-browser gate incl. the Hadrian guards
```

### Browser for the browser gate

Use Google Chrome for Testing rather than a desktop Chrome: on at least one macOS machine desktop Chrome 155's `--remote-debugging-pipe` never answers (every browser test times out at 90 s), while Chrome for Testing 154 works. Install it with Puppeteer's downloader and point `ARCHIFY_CHROME` at the binary:

```sh
npx -y @puppeteer/browsers install chrome@stable      # prints the installed path
export ARCHIFY_CHROME="$HOME/.cache/puppeteer/chrome/<platform>-<version>/chrome-<platform>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"   # macOS
```

On Linux the binary is `.../chrome-linux64/chrome`. A browser test skipped for lack of `ARCHIFY_CHROME` is skipped, not passed.

Building `archify.zip` (`scripts/build-zip.sh`) requires official Node 22 with bundled zlib `1.3.1-e00f703`, for example `mise install node@22` and run the script with that `node` first on `PATH`; the builder refuses other toolchains and the archive is byte-reproducible.

## Merging an upstream release

```sh
git fetch upstream --tags
git checkout main && git merge --ff-only upstream/main      # main mirrors upstream
git checkout hadrian && git merge upstream/main               # or merge the release tag
```

Then, in order:

1. **Resolve conflicts.** Expect them in: `archify/package.json` and `package-lock.json` (take upstream's dependencies, keep the fork's version string), `README.md` (ours), `viewer/template.source.html` (both: keep the `HADRIAN_CSS` marker, the picker entries and the `KNOWN`/`PRESETS` arrays), `archify/renderers/shared/cli.mjs`, `utils.mjs` and `viewer/export.js` (`'hadrian'` defaults), `archify/renderers/shared/node-card-style.mjs` (ours: square Hadrian chips and the Hadrian exclusion from the dark card tint), `archify/schemas/*.json` enums, `archify/locales/en.json` (ours adds two `viewer.preset.hadrian*` keys), `scripts/check-release-identity.mjs` (ours), and tests the fork edited (`test/i18n*.test.mjs`, `test/release-identity.test.mjs`, `test/preset-tryon.test.mjs`, `test/explainer-*.test.mjs`).
2. **Remove re-added surfaces.** Upstream adds files under the dropped directories constantly; a merge re-creates them without conflict:
   `git rm -rq --ignore-unmatch website community integrations journal experiments benchmarks tools docs/cases docs/gallery docs/specs docs/evidence docs/reviews docs/research docs/reading-evidence docs/releases docs/skill-updates docs/index.html docs/gallery.html docs/guide.html docs/start.html README_EN.md README_ZH.md README_JA.md README_KO.md`
   and delete any new non-English catalog under `archify/locales/` or `archify/examples/locales/`.
3. **Bump the fork version** to `<new upstream>-hadrian.1` in `archify/package.json`, `archify/package-lock.json` (two places), `viewer/template.source.html` (generator meta), `README.md` (badge and "Current version" line) and this file.
4. **Regenerate**, from the repository root:
   ```sh
   npm --prefix archify run generate:viewer
   npm --prefix archify run generate:validators
   npm --prefix archify run generate:brand-marks
   node scripts/render-fork-examples.mjs
   PATH="$(mise where node@22)/bin:$PATH" scripts/build-zip.sh
   ```
5. **Run the guards and gates**: `npm run test:generated` (includes the English-only scan: translate or escape anything upstream added), `npm run test:full`, and the browser gate with `ARCHIFY_CHROME`. If upstream added a preset, Viewer chrome rule or stylesheet, open a rendered page in both themes and look: the shape and contrast guards measure, but they do not judge taste.
6. Record the new upstream base and anything newly dropped or allowlisted in this file.

Never push to, or open issues or pull requests on, `tt-a1i/archify` from this fork.

## Open items

- **Explainer restyle.** Explainer pages (`archify/explainer/reader.css`) keep upstream's four page styles and palette; only their embedded diagrams are Hadrian. A `hadrian` page style is the natural follow-up.
- **Cloud and external share the gray family** and both have neutral fills (cloud a slight lift, external the panel colour), so they differ by outline (11.0 ΔE dark, 12.3 light), sigil and cloud's dashed frames; see [Node fills](#node-fills). If that reads ambiguously in practice, the candidate change is cloud → a second blue step; it must then clear the distinguishability guard against frontend, so the frontend fill would have to move too.
- **Backend/security colours.** Mapping A (status-green/status-red for architecture backend/security) is implemented; the alternative B (Defense Green backend, danger-red security, gold database, blue-400/blue-600 message bus) changes the stroke and fill tokens of those four categories in `viewer/hadrian.css` and the lifecycle override, and must pass `test/hadrian-distinguishability.test.mjs`.
- **Private-repository install** from `Hadrian-MTV/archify` is to be verified once the repository exists; local-path installation with the real Skills CLI is verified.
- **Upstream contrast fixes** (#1055/#1040/#1017) will land in `viewer.css` for the upstream presets; the Hadrian preset already clears the floor, so merging them needs no change here.
- `npm run test:webm` (real WebM decoding with ffmpeg) was not part of this rebrand's verification.
