# ClipForge Release Checklist

Run this checklist before tagging a release or promoting `main` to a public deployment.

## Brand consistency

- [ ] No public-facing path or asset references `opencut/` outside upstream attribution.
  - Sanity grep: `grep -rn "logos/opencut\|opencut\." apps/web/public apps/web/src/app apps/web/src/components README.md`
- [ ] `SITE_INFO.title` and `SITE_INFO.description` in [site-constants.ts](../apps/web/src/constants/site-constants.ts) say ClipForge, not OpenCut.
- [ ] `DEFAULT_LOGO_URL` resolves to a file that actually exists.
- [ ] Open-graph and favicon assets reflect ClipForge branding.
- [ ] Privacy and Terms pages describe ClipForge's actual data flows (local-first today, cloud opt-in once shipped).

## Plans and docs hygiene

- [ ] [PLANS.md](../PLANS.md) reflects every shipped milestone — milestone tracker hygiene is mandatory.
- [ ] [docs/production_readiness.md](production_readiness.md) "Closed in this pass" section matches what was actually merged.
- [ ] [lessons.md](../lessons.md) has an entry for any regression the release fixes.

## Capability surface

- [ ] [capabilities.ts](../apps/web/src/lib/clipforge/production/capabilities.ts) status fields (`available`, `scaffolded`, `needs-provider`, `planned`) reflect real wiring, not aspirational.
- [ ] No capability is `available` without an end-to-end happy path the team has manually exercised.

## Required CI

- [ ] `bun run typecheck:web` passes locally.
- [ ] `bun test` passes locally.
- [ ] `bun run test:clipforge-evals` passes locally.
- [ ] `bun run build:web` passes locally.
- [ ] CI green on the release commit (matrix: ubuntu, macos, windows).

## Secrets and env vars

- [ ] No real secrets committed in `.env*` files or workflow YAML.
- [ ] Production deployment has all env vars referenced from CI placeholders set with real values:
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `R2_*`, `CLOUDFLARE_ACCOUNT_ID`, `MODAL_TRANSCRIPTION_URL`, `OPENAI_API_KEY` (when planner is enabled).

## Publish/destination integrations (when active)

- [ ] OAuth redirect URIs match the deployment URL.
- [ ] Token refresh paths exercised at least once on a non-prod account.
- [ ] Rights receipts generated for at least one bundled-asset publish.

## Smoke tests on the deployed build

- [ ] Fresh-storage first-run shows the demo project onboarding card (clear browser storage first — see [lessons.md](../lessons.md)).
- [ ] Auto Edit TikTok produces a draft on the demo project.
- [ ] Chat planner returns ops in `auto`, `heuristic`, and `openai` modes (or surfaces health status when keys are absent).
- [ ] Export popover preflight runs and `Exact`/`Approximate`/`Unsupported` fidelity status renders.
- [ ] Local export produces a downloadable artifact.
