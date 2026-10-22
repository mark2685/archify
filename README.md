<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/archify-lockup-dark.svg" />
    <img src="docs/assets/archify-lockup-light.svg" alt="Archify" width="440" height="121" />
  </picture>
</p>
<h3 align="center">Archify for Hadrian: interactive diagrams in Hadrian's brand, from an AI agent.</h3>

<p align="center"><img src="docs/assets/archify-readme-hero.png" alt="Archify interactive diagrams" width="960" /></p>

<p align="center">
  <a href="CHANGELOG.md#320--2026-10-18"><img src="https://img.shields.io/badge/version-3.2.0-002548?style=flat-square" alt="Version 3.2.0" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-002548?style=flat-square" alt="MIT license" /></a>
</p>

> **This is Hadrian's fork of [Archify](https://github.com/tt-a1i/archify).** Diagrams render in the Hadrian brand by default, in light and dark, in the browser and in every export; the repository is English-only; and the upstream update reminder is off. [FORK.md](FORK.md) lists every difference from upstream, how to merge upstream releases, and how to install. Everything else, including the typed JSON contract, validation, delivery receipts and the Viewer, is upstream Archify.

**Current stable version:** `v3.2.0`. Upstream history is in the [Changelog](CHANGELOG.md).

## What it does

You describe a system, a process, a request path, a schema or a plan to your coding agent. The agent writes typed JSON; Archify's zero-dependency Node renderers validate it and produce one self-contained HTML file you can open, explore, present and export. Nothing is hosted and no runtime dependency is installed.

| Type | Best for | Include in your prompt |
|---|---|---|
| **Architecture** | Components, services, storage, boundaries | Scope, core components, primary path |
| **Workflow** | CI/CD, approvals, tool calls, runbooks | Participants, order, branches, exceptions |
| **Sequence** | API calls, cache fallback, auth, async traces | Callers, callees, returns, timing |
| **Data Flow** | Pipelines, lineage, PII, consumers | Sources, transforms, stores, boundaries |
| **Lifecycle** | States, retries, waits, terminal outcomes | States, events, retry and cancellation paths |
| **ERD** | Database schemas: tables, columns, keys, cardinality | Tables, every column with its type, keys, cardinality |
| **Class** | Classes, interfaces, selected members, type relationships | Types, key members, inheritance, composition, dependencies |
| **Tree** | Single-parent hierarchies: repositories, modules, capability breakdowns | Root, levels, what each branch contains |
| **Timeline** | When things happened: incident reviews, release histories | Timestamps with time zone, events, source lanes |
| **Waterfall** | Where the time went in one request or agent run | Spans, start times and durations, nesting |

Architecture Delta compares two validated snapshots as Before / Delta / After with a machine receipt:

`node archify/bin/archify.mjs compare architecture base.json head.json architecture-delta.html --json`

[![Architecture Delta showing added, removed, changed, and moved authored facts](docs/assets/architecture-delta-proof.jpg)](examples/checkout-platform-delta.html)

## Install

The Skill lives under [`archify/`](archify/). Install it with the Skills CLI from the Hadrian repository (the exact source is in [FORK.md](FORK.md#install)):

```bash
npx -y skills add Hadrian-MTV/archify --skill archify -g
```

Then ask your agent, for example:

```text
Use Archify to draw: Browser -> API -> Redis cache -> PostgreSQL fallback.
```

For source evidence, open a repository and ask:

```text
Analyze this repository, then use archify to create a high-level runtime architecture diagram.
Show 8–12 core components, one primary path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
```

Continue with focused requests such as `add Redis`, `move auth to the left`, or `highlight the rollback path`. Archify keeps the typed source available for targeted iteration.

## Repository commands

```bash
cd archify
node bin/archify.mjs doctor
node bin/archify.mjs demo /tmp/archify-demo
node bin/archify.mjs guide "Show CI/CD checks, approval, deploy, and rollback"
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --quality showcase --json
node bin/archify.mjs preview workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase --no-open
node bin/archify.mjs deliver workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase --open --json
```

`preview` is an explicit loopback-only desktop mode: it watches one JSON file on a random `127.0.0.1` port, keeps the last verified output through failures, and stops with Ctrl-C. `deliver --open` is an opt-in one-shot handoff after the atomic commit. On failure, `validate --json` and `deliver --json` emit one JSON object whose `diagnostics[]` name the exact repair.

Settings:

```json
{
  "meta": {
    "locale": "en",
    "animation": "trace"
  }
}
```

Omit `meta.visual_preset`: every diagram opens in the `hadrian` style. The upstream `classic`, `signal-flow`, `blueprint` and `editorial` styles remain authorable through an explicit `meta.visual_preset` but are not offered in the Viewer's style picker. `meta.locale` localizes renderer-owned copy only; this fork bundles English, and other locales fall back to English with a warning unless `meta.translations` supplies the strings.

## Examples

Architecture: [`web-app`](examples/web-app.html) · [`Archify pipeline`](examples/archify-repo.html) · [`grid placement`](examples/archify-repo-grid.html) · [`RAG pipeline`](examples/rag-pipeline.html) · [`MAKA`](examples/maka-architecture.html). Parallel relationships stay readable without authored ports: shared automatic endpoints spread deterministically along a node edge.

Other types: [`ERD`](examples/erd-orders-rendered.html) · [`Class`](examples/class-payments-rendered.html) · [`Tree`](examples/tree-payment-platform-rendered.html) · [`Timeline`](examples/timeline-payment-incident-rendered.html) · [`Waterfall`](examples/waterfall-checkout-request-rendered.html) · [`Workflow`](examples/workflow-agent-tool-call-rendered.html) · [`Sequence`](examples/sequence-cache-miss-request.html) · [`Data Flow`](examples/dataflow-product-analytics.html) · [`Lifecycle`](examples/lifecycle-agent-run.html).

Every example's typed source sits next to it in [`examples/`](examples/) and [`archify/examples/`](archify/examples/).

## Explore and share the output

| Action | Control |
|---|---|
| Open the factual Diagram Guide | <kbd>?</kbd> |
| Find and focus a semantic node | <kbd>/</kbd> |
| Trace upstream/downstream authored reach | Focus a node → `Upstream` / `Downstream` |
| Probe a directed route and inspect its journey | <kbd>R</kbd> or `PATH` |
| Compare one or two semantic roles | <kbd>L</kbd> or `LENS` |
| Open the live overview radar | <kbd>M</kbd> or `MAP` |
| Enter Presentation Stage | <kbd>F</kbd> |
| Toggle theme / open Export | <kbd>T</kbd> / <kbd>E</kbd> |
| Zoom or reset | <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> |

Stable links can restore `#focus=<id>`, `#focus=<id>&reach=upstream|downstream`, `#relation=<id>`, `#route=<source>~<target>`, and `#lens=<kind>~<kind>`.

The Export menu copies PNG to the clipboard and downloads SVG, PNG, JPEG, WebP, WebM and a 1200×630 Share Card, all in the reader's current theme and style. After tracing a route, **Export → Route Share Card** downloads that authored path with the full diagram retained for context; after an Upstream/Downstream query, **Export → Reach Share Card** does the same for the authored reach.

| Route Share Card | Reach Share Card |
|---|---|
| ![Route Share Card](docs/assets/archify-route-share-card.png) | ![Reach Share Card](docs/assets/mco-runtime-reach-share-card.png) |

The complete generation and viewer contract lives in [`archify/SKILL.md`](archify/SKILL.md).

## Reference

- [FORK.md](FORK.md): differences from upstream, merging upstream releases, installing, verifying
- [Schema reference](archify/schemas/README.md) · [Skill](archify/SKILL.md) · [Agent cookbook](docs/authoring-cookbook.md)
- [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md) (upstream)
- [Contributing](CONTRIBUTING.md) · [Reviewing](REVIEWING.md) (upstream process, kept for reference)

## License

Archify is MIT licensed; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The fork's modifications are also MIT licensed; see [FORK.md](FORK.md#licence).
