<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="apps/web/public/logos/opencut/1k/logo-white-black.png" alt="OpenCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>OpenCut</span></h1>
      <h3 style="margin-top: -10px;">A free, open-source video editor for web, desktop, and mobile.</h3>
    </td>
  </tr>
</table>

## Sponsors

Thanks to [Vercel](https://vercel.com?utm_source=github-opencut&utm_campaign=oss) and [fal.ai](https://fal.ai?utm_source=github-opencut&utm_campaign=oss) for their support of open-source software.

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

<a href="https://fal.ai">
  <img alt="Powered by fal.ai" src="https://img.shields.io/badge/Powered%20by-fal.ai-000000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCAxMEwxMy4wOSAxNS43NEwxMiAyMkwxMC45MSAxNS43NEw0IDEwTDEwLjkxIDguMjZMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=" />
</a>

## Why?

- **Privacy**: Your videos stay on your device
- **Free features**: Most basic CapCut features are now paywalled 
- **Simple**: People want editors that are easy to use - CapCut proved that

## Features

- Timeline-based editing
- Multi-track support
- Real-time preview
- No watermarks or subscriptions
- Analytics provided by [Databuddy](https://www.databuddy.cc?utm_source=opencut), 100% Anonymized & Non-invasive.
- Blog powered by [Marble](https://marblecms.com?utm_source=opencut), Headless CMS.

## Project Structure

- `apps/web/` – Main Next.js web application
- `src/components/` – UI and editor components
- `src/hooks/` – Custom React hooks
- `src/lib/` – Utility and API logic
- `src/stores/` – State management (Zustand, etc.)
- `src/types/` – TypeScript types

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

> **Note:** Docker is optional but recommended for running the local database and Redis. If you only want to work on frontend features, you can skip it.

### Setup

1. Fork and clone the repository

2. Copy the environment file:

   ```bash
   # Unix/Linux/Mac
   cp apps/web/.env.example apps/web/.env.local

   # Windows PowerShell
   Copy-Item apps/web/.env.example apps/web/.env.local
   ```

3. Start the database and Redis:

   ```bash
   docker compose up -d db redis serverless-redis-http
   ```

4. Install dependencies and start the dev server:

   ```bash
   bun install
   bun dev:web
   ```

The application will be available at [http://localhost:3000](http://localhost:3000).

The `.env.example` has sensible defaults that match the Docker Compose config — it should work out of the box.

## ClipForge MVP (this fork)

ClipForge is implemented as an in-place OpenCut extension (same editor shell, timeline, and undo/redo system).

### Enable ClipForge features

Set the following in `apps/web/.env.local`:

```bash
NEXT_PUBLIC_ENABLE_CLIPFORGE_AUTO_EDIT=true
NEXT_PUBLIC_ENABLE_CLIPFORGE_CHAT=true
NEXT_PUBLIC_CLIPFORGE_CHAT_PLANNER_MODE=auto
```

Optional server-backed model planner:

```bash
OPENAI_API_KEY=your_openai_api_key
CLIPFORGE_OPENAI_MODEL=gpt-4.1-mini
CLIPFORGE_OPENAI_ENDPOINT=https://api.openai.com/v1/responses
```

Planner modes:

- `auto` (default): prefer the model planner, fall back to heuristic planning if the model is unavailable or returns invalid ops
- `heuristic`: force deterministic local parsing only
- `openai`: force the model planner and fail closed if it is unavailable

The env value sets the initial default only. After launch, users can change planner mode in the left `Settings` tab under `AI Planner`, and the selection is persisted in the browser.

Optional local Whisper CLI indexing:

```bash
CLIPFORGE_WHISPER_CLI_ENABLED=true
NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED=true
CLIPFORGE_WHISPER_CLI_BIN=whisper
CLIPFORGE_WHISPER_CLI_MODEL=small
```

Optional binary preview backend rollout flag:

```bash
ENABLE_BINARY_PREVIEW_RENDERER=true
NEXT_PUBLIC_ENABLE_BINARY_PREVIEW_RENDERER=true
```

The editor preview keeps the same DOM interaction overlays, but frame generation moves behind the shared render backend contract when this flag is enabled. If binary preview cannot safely render a frame yet, it falls back to the legacy canvas backend.
The preview toolbar now also surfaces a deterministic trust status (`Exact`, `Approximate`, `Unsupported`, or `Checking`) based on sampled frame parity against export plus actual backend fallback usage.

### MVP workflow

1. On a fresh empty project, click `Try Demo Project` in the onboarding modal (or the empty `Assets` panel) to load a built-in sample project without bringing your own clips.
2. If you are using your own footage, go to `Assets` panel and click `Import Clips`.
3. ClipForge indexes imported audio in the background for captions and smarter edits.
4. Use `Index All Clips`, `Index Clip`, or `Import SRT...` in the Assets panel if you need to re-run or override transcript metadata.
5. Click `Auto Edit TikTok` to build a 9:16 draft timeline.
6. Open `Captions` tab and generate captions using `Clean Bottom` or `Bold Center`.
7. ClipForge now ships a free-first starter library:
   - bundled open-source fonts in the font picker
   - built-in starter music and SFX in `Audio -> Songs` and `Audio -> Sound effects`
   - built-in sticker/icon pack in `Stickers`
   - bundled caption/graphics/overlay/motion presets in the existing creative surfaces
   - bundled `Polish` profiles that coordinate caption reveal, overlay style, finishing look, sound sync, and audio polish
   - expanded social SFX groups for:
     - typing / cursor
     - caption pops
     - airy transition sounds including fahhh-style sweeps
     - UI / accent utility sounds
   - one-click `Sound sync` controls on graphics and captions that insert real bundled SFX clips on the audio track
   - `Audio -> Songs` also separates:
     - bundled starter music
     - trend-sound references you save manually as style/pacing cues
     - imported audio with explicit user-managed rights labels
8. Open chat from the right panel toggle (or `Ctrl/Cmd + /`).
   - Direct edit prompts (for example `trim this clip by 0.5s at the start`, `add text here that says "watch this"`, `replace "teh" with "the" in this caption`, or `trim the first clip by 0.5s and move it to 5s`) still produce deterministic JSON ops for review/apply.
   - High-level draft prompts (for example `make me a viral TikTok from this`, `luxury morning routine style`, or `make it shorter with bold captions`) now produce a structured `Creative brief` card first.
   - The brief shows target duration, story shape, caption/overlay style, polish profile, version targets, and explicit build steps before you click `Build first draft`.
9. Use normal OpenCut `Undo/Redo` shortcuts.
10. Click the top-right `Export` button:
   - The preview toolbar shows sampled preview/export fidelity before you export.
   - Preview now supports version-target switching for enabled publish targets (`9:16`, `1:1`, `16:9`) without mutating the base edit.
   - `Exact` means sampled frames matched export without fallback; `Approximate` means fallback was needed; `Unsupported` means sampled export parity is not trustworthy for the current graph.
   - Export now runs a deterministic preflight readiness check in the popover.
   - Preflight is now reactive while the popover is open and refreshes automatically as project/media/timeline state changes.
   - Export now also asks for a publish destination (`generic export`, `TikTok`, `Instagram`, `YouTube`) so music-rights warnings can be evaluated against the intended destination.
   - Blocking issues (for example missing media refs or invalid ranges) must be fixed before export starts.
   - Missing media now uses a relink-first recovery flow: relink the missing `mediaId` to a compatible file without rewriting timeline segment IDs/timing.
   - Export preflight now also hard-blocks referenced media with unresolved or incompatible decode capability (`media-compatibility-unverified`, `unsupported-media-codec`, `unsupported-audio-decode`).
   - Compatibility probes are cached per media asset and run in the background after import/relink, with explicit `Scan` actions available in Assets and Export when verification is still unresolved.
   - Destructive missing-media cleanup is still available explicitly as `Remove Affected Segments` when relink is not possible.
   - One-click fixes are available for supported repair actions and preflight re-runs immediately after each fix.
   - Audio-only decode incompatibilities can be cleared deterministically by disabling export audio; visual decode incompatibilities remain relink/remove blockers.
   - Multi-format publishing is now built in:
     - enable additional version targets in `Settings -> Version pack`
     - preview target-specific overrides in the preview toolbar
     - auto reframe selected visuals and apply safe-layout adaptation for overlays/captions per target
     - export the current active target or all enabled targets in one run
     - exported filenames include deterministic target suffixes such as `_9x16`, `_1x1`, `_16x9`
   - Warning-only states (for example low quality, audio off, WebM compatibility) do not block export.
   - Music-rights issues are warning-first:
     - bundled starter tracks are treated as universal starter-library assets
     - imported tracks warn that rights are user-managed/unknown
     - platform-limited or attribution-required tracks surface explicit destination/attribution warnings
     - export remains allowed after acknowledgment because the app cannot authoritatively own the user's rights
   - Bundled SFX inserted through `Sound sync` remain universal/free-first and do not trigger music-rights warnings.
   - The export popover now also shows the same preview fidelity report as a non-blocking trust signal before render starts.
   - Runtime export still uses the existing binary pipeline and diagnostics once encoding begins.
   - If runtime export fails, ClipForge now shows explicit deterministic retry options (`Retry same settings` and a recommended safe profile when available).
   - Safe retries are user-clicked only, always re-run preflight before retry start, and never run hidden retry loops.
   - You can download an export incident diagnostics JSON bundle from the same error panel (attempt history + preflight snapshot + final diagnostics).

### In-app AI planner controls

- Open the left `Settings` tab to configure `AI Planner` mode in-app:
  - `Auto (Recommended)`
  - `OpenAI`
  - `Heuristic`
- The same section shows planner health:
  - `Ready`: route is available and server config is complete
  - `Degraded`: route is available but the OpenAI server config is incomplete
  - `Unavailable`: the health route could not complete
- Planner health is configuration-based only in this milestone. It does not probe live upstream OpenAI reachability.
- Implicit references are now context-aware:
  - selection is used first for `this` / `that`
  - playhead is used as fallback
  - `it` carries over only within the current prompt
- If more than one clip or caption matches a single-target request, the chat panel asks for clarification before proposing JSON ops in all planner modes (`auto`, `openai`, `heuristic`).
- Proposed ops now pass through a deterministic semantic safety layer before review:
  - safe repairs are applied automatically (with warnings),
  - unrecoverable ops are dropped,
  - and ambiguous repair targets trigger clarification instead of unsafe guesses.
- Proposed ops then pass through a validator-aware reconciliation pass:
  - first-pass `validateOps` failures are captured,
  - known validator codes are deterministically repaired or dropped,
  - validation is re-run exactly once before JSON review is accepted.
- Validator reconciliation is provider-agnostic and applies to `openai`, `auto`, and `heuristic` modes.
- Chat now includes deterministic dry-run impact preview cards before apply:
  - each proposed op gets a human-readable impact summary,
  - each card can be toggled on/off for selective apply,
  - the selected subset is re-validated before apply is enabled,
  - and `Jump` seeks playhead + selects the target segment when available.
- Preview is non-mutating and never bypasses the existing validator/apply authority.
- High-level AI draft assembly is now available for short-form prompts:
  - ClipForge extracts a structured creative brief from chat,
  - plans a deterministic draft recipe over existing systems (auto edit, captions, overlays, montage, version pack, safe layout),
  - shows the recipe for review,
  - and only builds after explicit user confirmation.
- Draft assembly remains active-scene scoped in M44 and uses the same command/validator/apply authority as the rest of the editor.
- Footage intelligence now strengthens that first draft before build:
  - ClipForge caches coarse video activity and scene-change analysis per asset,
  - ranks strong early moments as hook candidates,
  - surfaces likely trims/cuts with explainable reasons,
  - and lets the creative-brief planner prefer those hook/keep-cut recommendations when available.
- Retention-aware story shaping now sits on top of those draft plans:
  - ClipForge builds a reviewable `Story shape` with explicit `hook -> setup -> body -> payoff -> optional CTA` beats,
  - reshapes weak openers before duration tightening,
  - and keeps CTA reservation brief-driven instead of forcing it onto every draft.
- Publish-ready polish now sits on top of the structured draft:
  - ClipForge picks a bundled polish profile for the scene,
  - applies coordinated caption reveals, overlay styling, finishing looks, sound sync, and audio polish,
  - and keeps the whole pass deterministic and reversible before export.
- The free-first creative library is local and attribution-safe:
  - `Graphics`, `Captions`, `Audio`, and `Stickers` now expose bundled starter content before remote/imported sources
  - `Graphics -> Brand` now includes default bundled caption style, title preset, and music mood preferences
  - `Settings` now shows the bundled library packs and their license labels
- Music source handling is now explicit:
  - bundled music = universal/free-first starter library
  - imported audio = user-managed rights
  - trend references = planning cues only, not playable/licensed audio assets

### Built-in demo project

ClipForge ships with a bundled demo project under `apps/web/public/clipforge-demo/`.

- It imports through the normal media pipeline.
- It seeds deterministic transcript and silence metadata, so it works without Whisper setup.
- It auto-builds a draft timeline and captions before showing the guided checklist.
- It remains a normal editable project after it loads.

The guided demo points users to the same top-right `Export` button used everywhere else.

### Multi-format publishing workflow

ClipForge now keeps one base edit as the source of truth and layers target-specific layout overrides on top.

- Enable publish targets in `Settings -> Version pack`.
- Switch the active preview target from the preview toolbar.
- Use `Auto reframe selection` for video/image clips when moving from one aspect ratio to another.
- Use `Apply safe layout` to keep lower thirds, overlays, titles, captions, and CTA cards inside target-specific safe margins.
- Version-specific changes are non-destructive:
  - the base scene stays unchanged
  - target-specific transforms/background tweaks live in per-element version overrides
- Export either the current active target or all enabled targets from the same top-right export flow.

### Self-Hosting with Docker

To run everything (including a production build of the app) in Docker:

```bash
docker compose up -d
```

The app will be available at [http://localhost:3100](http://localhost:3100).

## Contributing

We welcome contributions! While we're actively developing and refactoring certain areas, there are plenty of opportunities to contribute effectively.

**🎯 Focus areas:** Timeline functionality, project management, performance, bug fixes, and UI improvements outside the preview panel.

**⚠️ Avoid for now:** Preview panel enhancements (fonts, stickers, effects) and export functionality - we're refactoring these with a new binary rendering approach.

See our [Contributing Guide](.github/CONTRIBUTING.md) for detailed setup instructions, development guidelines, and complete focus area guidance.

**Quick start for contributors:**

- Fork the repo and clone locally
- Follow the setup instructions in CONTRIBUTING.md
- Create a feature branch and submit a PR

## License

[MIT LICENSE](LICENSE)

---

![Star History Chart](https://api.star-history.com/svg?repos=opencut-app/opencut&type=Date)
