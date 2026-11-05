# Porting notes: built-in → external app

## Needs a maintainer security ruling before adoption

**The crew auto-approve grant is OFF in this copy.** The built-in minted a
`SafetyOverride` auto-approve grant for an unattended crew's chat session
(`backend/crew_runtime_session.py:116-184`, `_hold_grant` and `sync_trust`:
`safety_override().activate_scoped(...)` / `renew_scoped(...)`), slid it forward
every watchdog cycle, and consulted it on every tool approval of that session
(`slot._trust_scope`). That is a privilege only core code could exercise: there
is no App Kit seam for it, and this port does not create one.

What this copy does instead:

- `backend/_host.py` binds every crew module's `safety_override` to
  `_DisabledSafetyOverride`. `activate_scoped` and `renew_scoped` answer "not
  granted" without touching the host; `is_scope_active` and
  `scope_remaining_secs` report no grant. `AUTO_APPROVE_GRANTS_ENABLED = False`,
  and nothing sets it.
- The built-in's code path is kept unchanged, so its existing fail-closed branch
  runs: `sync_trust` returns `False`, the slot carries no `_trust_scope`, and the
  wake's dispatch gate (`crew_runtime_supervision.py`, `_wake_crew_body`) starts
  **no turn for an unattended crew**. An attended crew still runs, and every tool
  call it makes goes through the ordinary interactive approval prompt.
- Revocation still reaches the host (`deactivate_scope` calls the gateway's
  `SafetyOverride` when it has one): a revocation can only remove access.
- `tests/test_auto_approve_disabled.py` pins the shipped behaviour (the stand-in
  is the binding of every crew module, it never reaches the host to mint, no
  other mechanism sets a trust flag, no other module names the host's
  `SafetyOverride`). The built-in's own grant suites
  (`tests/test_issue_radar_crew_runtime*.py`) still run the kept code path, against
  the host's real `SafetyOverride`, through the test-only `host_grants` fixture in
  `tests/conftest.py`; nothing in `backend/` can reach that binding.

Re-enabling unattended crews needs a ruling on a generic, app-agnostic App Kit
seam for a bounded, audited auto-approve grant scoped to the app's own slots (the
24 h ceiling, fail-closed SEL audit and per-call re-check the built-in relied on
included). Until that ruling, the README states that unattended crews do not run
in this copy.

---

This repository was ported from Kiro Crew's built-in Issue Radar at KiroCrew
`main` `55439d87700799a8789a341da65e2e1c355e26fc`:

- the backend, `src/kiro_crew/apps/builtins/issue_radar/` (`app.json`, the 58
  modules of `backend/` and the 13 of `backend/http_routes/`, the two Markdown
  briefs `crew_brief.md` and `crew_ledger_spec.md`), and its own 28 tests
  (`tests/`);
- the dashboard page, `website/src/apps/issue-radar/` (98 files, the pipeline
  dashboard included) and its 28 co-located tests, and its store art,
  `website/public/app-assets/issue-radar/`;
- the `apps.issueRadar.*` and `apps.autoTriagePipeline.*` strings of
  `website/src/i18n/locales/*.json` (English merged with `en.manual.json`), plus
  nine shared dashboard strings the page used;
- the tests: every `test/test_issue_radar_*.py` (51), the five
  `test/issue_radar_*_helpers.py`, `test/test_gitlab_client_boundaries.py`,
  `test/test_gitlab_client_coverage.py`, `test/test_gitlab_deps.py`, the
  Issue Radar cases of six core test files (`tests/test_ported_core_cases.py`,
  below), every `website/src/test/IssueRadar*` / `issueRadar*` test (51) and the
  eleven other dashboard tests that exercised this page.

Paths with a line number below refer to that commit. A **gap** is something the
built-in gets from Kiro Crew that an external app has no public way to get yet;
closing one is a Kiro Crew change (a generic, app-agnostic App Kit seam), not a
change here.

## What carried over unchanged

- `app.json` `name` (`issue-radar`), `version` (`0.1.0`), `author`,
  `permissions` (`api` `/api/apps/issue-radar` and `/api/apps/issue-radar/*`,
  `network`, `storage`), `platform`, `dependencies.optionalCommands`
  (`gh`, `glab`, `az`), `notifications.channels` (`ci-failure`),
  `defaultEnabled: false`, and every display field. `tests/test_manifest_contract.py`
  compares them with the built-in's manifest (`tests/fixtures/builtin-app.json`).
- Every backend module's logic, byte for byte apart from its imports: the three
  provider clients and their mirror facades, the stores and their caches, the
  crew store, ledger, carry and fabric, the crew runtime and watchdog, the
  pipeline fold, the watcher and CI watch, every route handler's method, path,
  validation, status codes and response shape, and the facade mirrors
  (`kiro_crew._facade_mirror`, vendored as `backend/_facade_mirror.py`: pure,
  stdlib-only).
- Where the data lives: `<data home>/apps/issue-radar/data/` (`config.json`,
  `repos/<provider>/<host>/<owner>/<repo>/...`, the crews). The gateway hands the
  hooks the same directory as `ctx.data_dir`, so a user's connected repos,
  settings, caches, investigations and crews are read as they are. The crew
  ledger's entries stay in core's crew log (`<data home>/crew-log/`), outside the
  app directory, so an adoption's tree swap does not touch them.
- The vendor-CLI posture: no credential of the app's own; `gh` through the
  host's runner (minimal env, audit-or-deny SEL write), `glab` and `az` through
  the app's own hardened spawns with the host's critical SEL audit.
- The crews' chat slots keep their keys and their app provenance (`issue-radar`).

## What changed, and why

| Built-in | Here | Why |
|---|---|---|
| `"backend": {"routes": "backend.routes:register_routes"}` (`app.json:52-54`) and the package re-export (`__init__.py:13`) | `"backend": {"hooks": {"routes", "on_startup", "on_shutdown"}}`, all three in `backend/app_hooks.py` | Top-level `backend.routes` is read only by the built-in boot loop. An external app's routes go through `RouteRegistry`, its lifecycle through the hook dispatcher. |
| `register_routes(app)` adding 63 absolute routes to `app.router` and appending `app.on_startup` / `app.on_cleanup` (`backend/routes.py:742-842`, `crew_routes.py:1354`, `pipeline_routes.py:339`) | `register_routes(ctx) -> list[Route]`: the same registration body (`routes._register_on`) run against a collector that records relative route records; `on_startup(ctx)` / `on_shutdown(ctx)` run the collected callbacks with `ctx.http_app` | The `hooks.routes` contract. `Route` is the app's own frozen dataclass (`backend/_host.py`), accepted structurally from App Kit level 1. The handlers keep their one-argument shape; the registry's `(request, ctx)` call goes through an adapter. The gateway executes the hook file once per hook, so the shared state lives in `routes` (imported once). |
| `/deps` refresh registries written onto the gateway's application (`http_routes/deps.py:88-110`, `app[...] = ...`) | Held in `http_routes/deps.py` (`_APP_REGISTRIES`, a weak map keyed by the application) | The gateway's application is frozen once it serves; an app must not write to it. |
| `_require_enabled` reading `apps.manager.is_app_enabled` (`routes.py:385`) | Kept, through `_host.is_app_enabled`; a gateway that cannot say reads as disabled | Defence in depth beside the registry's own deregistration on disable. |
| `require_owner_dashboard_request(request, "issue_radar.<verb>")` at 32 call sites (`http_routes/*.py`, `crew_routes.py:493`, `routes.py:455`) | The same name, now `_host.require_owner_dashboard_request`, which calls `ctx.require_owner(request, "<verb>")` | The App Kit level-1 owner gate, the same host gate. A denial is audited as `issue-radar.<verb>` (the built-in wrote `issue_radar.<verb>`). A gateway without the seam refuses every caller. |
| `sel().log_api_access(caller="core:issue-radar", operation="issue_radar.<op>", source="builtin-app")` for route audits (`routes.py:400-410`) | `ctx.audit.record(op, outcome, resources=..., error=...)` (`_host.audit`) | The level-0 audit seam. Rows now read caller `app:issue-radar`, operation `issue-radar.<op>`, source `app`. No seam is a logged warning, as a failed SEL write was. |
| `security.redact`, `redact_credentials`, `redact_exfiltration_urls` (`http_routes/ai.py:281`, `recommendations.py:73`, `tagging.py:151`, `pipeline_fold.py:47`, `azure_client_writes.py:12`, `crew_runtime_session.py:31`) | `ctx.scrub.outbound(text).text` (`_host.scrub_text`), under the same names | The level-0 scrub seam runs the same baseline passes and then the active policy. No scrubber, a raising one, or one that answers no text: the whole string is masked. |
| `apps.manager.app_data_dir` / `app_dir` (`store_repos.py:20`, `store.py:212`, `pipeline_fold.py:44`) | `ctx.data_dir` (created owner-only through the host's `owner_only_files.ensure_directory`, else `0700` by hand) | The App Kit data directory, the same path. |
| `dashboard.handlers._shared.string_field_error` (`routes.py:455`) | `_host.string_field_error`, the same 400 | A few lines with no policy. |
| Absolute self-imports `kiro_crew.apps.builtins.issue_radar.backend.*` (every module) and the facades' dotted owner names (`store.py:41`, `github_client.py:68`, `azure_client.py:94`, `crew_store.py:52`, `crew_runtime.py:600`) | Relative imports; `f"{__package__}.<owner>"` | Hook files load into a synthetic package named after the app; `tests/test_manifest_contract.py` loads the hooks through the gateway's own module loader. |
| Loggers `kiro_crew.apps.builtins.issue_radar.backend.store` / `.crew_store` (`store_repos.py:23`, `crew_store_records.py:39`) and those classes' `__module__` | `<package>.store` / `<package>.crew_store` | The module's own package name; the other modules already logged as `kirocrew.app.issue-radar`. |
| SEL caller of the `gh`/`glab`/`az` spawn audits: `core:issue-radar` | Unchanged | The host's runner namespaces the operation from it (`issue_radar.gh_run`) and its audit-or-deny contract is the host's; changing the identity is the host's call at adoption. |
| (none) | `GET /gitlab-hosts`, `GET /models`, `GET /agents`, `GET /pipeline/live-slots` | The built-in page read four things from the dashboard itself: the GitLab allowlist (its config query), the model list and agent roster (its shared pickers) and which chat slots are live (its slot list). All four paths are outside an installed app's API grant, and adoption refuses a widened grant, so the app answers them under its own prefix. `/gitlab-hosts` is the allowlist `/connect` already enforces; `/models` and `/agents` call the gateway's own handlers for the same request (gap 4); `/pipeline/live-slots` answers only for the keys the caller names. |
| `iconUrl` / `heroImage*` as `/app-assets/issue-radar/*.svg`, `screenshots` `/app-assets/…` (`app.json:62-71`) | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source. The PNGs were rendered from the built-in SVGs (kept beside them): the icon at 512×512 on an opaque tile with `--ico-a` / `--ico-b` resolved to fixed colours, the heroes at 1200×675 and the detail heroes at 1200×288. |
| `ui.pages` `[{"route": "/issue-radar", "label": "Issue Radar", "icon": "Radar"}]`, page compiled into the dashboard | `ui.entry: "dist/index.mjs"` (a committed ESM bundle built from `ui/src/`), `ui.pages` `[{"route": "/apps/issue-radar", "label": "Issue Radar"}]`, no `icon` | An installed app ships its page as a bundle AppHost loads. The legacy route and the `Radar` glyph of an adopted record come from Kiro Crew's adoption pin, never from this manifest. |
| App Store copy keys in the dashboard catalogs (`website/src/components/appstore/appManifest.ts:238-255`) | `l10n` block in `app.json` for the 11 non-English locales | The listing copy travels with the app. It is the `apps.issueRadar.manifest` subtree of `ui/i18n/<locale>.json`, kept equal by a test. |
| No `minKiroCrewVersion`, no `license` | `"minKiroCrewVersion": "0.13.0"`, `"license": "Apache-2.0"` | 0.13.0 is the first release line with App Kit level 1 (structural route records, `ctx.require_owner`, `ctx.sdk_level`); a 0.12.x registry skips every record of this app. |

## Private Kiro Crew imports and the seam each needs

Nothing in `backend/` has an `import kiro_crew` statement. `backend/_host.py`
resolves every host name through `importlib` at call time (`_HostFunction`,
`_HostModule`), from the `HOST_SURFACE` table that `tests/test_no_host_imports.py`
pins; a missing one raises `HostCapabilityMissing` (the operation is refused,
never run some other way), and `register_routes` names it in `ctx.health`
(`_host.capability_issues`). Exception types and constants are resolved once,
with a stand-in that never matches or the host's current value.

| Built-in import | Where (built-in) | Seam it needs | Without it |
|---|---|---|---|
| `kiro_crew.github_runner` (`run_gh`, `resolve_gh`, `gh_env`, `parse_github_repo_url`, `RepoUrlError`, `apply_session_bus_address`) | `github_client.py:23`, `github_transport.py:10`, `errors.py:25`, `azure_client_cli.py:20`, `gitlab_client.py:58` | A provider-CLI spawn seam: resolve a trusted vendor CLI, run it with a minimal env and an audit-or-deny SEL write | Every GitHub read and write is refused |
| `kiro_crew.sel.sel` (the critical spawn audit) | `azure_client_cli.py:21`, `gitlab_client.py:59` | A fail-closed audit (`ctx.audit` is best-effort by design) | The `glab` / `az` spawn is refused unaudited |
| `kiro_crew.apps.registry.minimal_env` | `azure_client_cli.py:19`, `gitlab_client.py:56` | The same spawn seam | GitLab and Azure DevOps calls are refused |
| `kiro_crew.dashboard.handlers.source_providers._validate_provider_executable`, `provider_executable_candidates` | `azure_client_cli.py:210`, `gitlab_client.py:176` | The same spawn seam | `glab` / `az` are not resolved |
| `kiro_crew.security.redact_local_paths` | `errors.py:26` | A local-path pass on `ctx.scrub` | CLI stderr is masked whole |
| `kiro_crew.platform_compat` (`IS_WINDOWS`, locks, links, replace retries) | `store.py:209`, `store_*.py:14-16`, `crew_store_records.py:22`, `crew_store_unit_order.py:15` | A public portable-file SDK | File work is refused |
| `kiro_crew.atomic_write` (`atomic_write`, `read_json_or`, `read_bytes_with_retry`, the pinned-parent replace) | `crew_runtime.py:56`, `crew_store*.py`, `store*.py` | A public atomic-file SDK | Writes are refused (no unsafe fallback) |
| `kiro_crew.config.loader.KiroCrewConfig` | `gitlab_client.py:57`, `http_routes/ai.py:21`, `routes.py:88` | A read-only config view (`dashboard.gitlab_hosts`, `dashboard.language`) | The GitLab allowlist reads empty (no self-managed host), the AI language falls back to the browser's |
| `kiro_crew.context.ui_language_tag`, `normalize_ui_language_tag` | `http_routes/ai.py:22` | The same config view | As above |
| `kiro_crew.llm_helpers.stream_and_collect`, `ToolApprovalPolicy`, `parse_llm_json`; `kiro_crew.shared_crew.admission_gate.actor_budget`, `turn_gate.run_admitted_or_raise`; `kiro_crew.dashboard.request_priority.owner_start_priority` | `http_routes/ai.py:223-234`, `:280`, `recommendations.py:209`, `tagging.py:150` | A one-shot model call seam with the host's admission and priority | AI summaries, label recommendations and tagging answer an error |
| `kiro_crew.config.paths.data_home`, `kiro_crew.constants.env_file_display` | `crew_store*.py`, `pipeline_fold.py:45` | A crew-log seam (below) and a read of the gateway's usage ledger | Crew writes and the pipeline's cost columns are refused |
| `kiro_crew.crew_log` (`emit`, `projection`, `resolve.unit_for_session_key`, `schema.Entry`, `KIND_SESSION`, `store.CrewLog`, `log_exception_text`, `session_units_for_slot`) and the `RADAR_*` vocabularies of `crew_log.entry_types` | `crew_store_carry.py:17-20`, `:456`, `:477`, `:541`, `crew_store_ledger.py:15-17`, `:243-257`, `:370`, `crew_store_log.py:17-19`, `:172`, `:205`, `crew_store_records.py:24-35`, `:707`, `crew_routes.py:219` | An app-scoped crew-log seam (append and fold the app's own entry type) | The crew ledger is unavailable (the routes answer the built-in's `crew_log_unavailable` 409). The vocabularies fall back to the values core declares today (`tests/test_host_surface.py` pins them equal) |
| `request.app["state"]` (`get_or_create_slot`, `get_slot`, `_slots`, `conversation_log`), `kiro_crew.dashboard.chat_runner._run_chat`, `chat_persistence.rehydrate_slot_from_history_async`, `chat_utils.slot_history_key`, `session_control.arm_model_switch_reset` / `model_switch_deferred` | `crew_runtime_session.py:17-19`, `:187-260`, `crew_model.py:47`, `crew_routes.py:222`, `:807`, `:861`, `:920` | An app-owned chat slot API (create, title, run a turn, switch its model) | Crews take no turn |
| `kiro_crew.autonudge.get_instance`, `autonudge_service.model.*_FAILURE_REASON` | `crew_runtime_session.py:26`, `crew_runtime_supervision.py:20` | An AutoNudge loop API scoped to the app's own slots | Crews are not re-woken on their idle timer |
| `kiro_crew.apps.teardown` (`register_slot_close_hook`, `register_slot_close_undo_hook`, the app-disable hook registry) | `crew_runtime_supervision.py:17-19` | Slot-close and app-disable hooks for an app | A dismissed crew tab is resurrected by the next sweep; a disable stops crews on the next 60 s sweep |
| `kiro_crew.apps.manager.is_app_enabled`, `app_lifecycle_lock` | `routes.py:87`, `pipeline_routes.py:25`, `crew_runtime_supervision.py:18`, `ci_watch.py:48` | An "is this app enabled" read and a lifecycle lock on the context | Routes answer 403, crews stand down, CI watch skips |
| `kiro_crew.safety_override.safety_override` | `crew_runtime_session.py:20`, `crew_runtime_supervision.py:24` | **See the first section: needs a security ruling** | Never minted (by design) |
| `kiro_crew.dashboard.handlers.notifications_push`, `kiro_crew.notifications.bus.NotificationPayload` / `NotificationValidationError` | `ci_watch.py:49-50`, `watch.py` | A notification-push seam for an app's declared channels | New-issue and CI-failure notifications are not sent |
| `kiro_crew.hooks`, `kiro_crew.memory.workspace_dir` | `pipeline_fold.py:42`, `:46` | A read of the gateway's hook audit and workspace for the pipeline fold | The pipeline dashboard answers 503 |
| `kiro_crew.loop_lock.LoopBoundLock` | `routes.py:93` | (pure helper) | The probe coalescer cannot be built (the module fails to import; the host has had it since before 0.12) |
| `kiro_crew.validation.MODEL_PICKER_HIDDEN_MODEL_ID_RE` | `crew_store_records.py:35` | The model-id grammar on the context | No triage model id passes (a crew runs on its agent's model) |
| `kiro_crew.dashboard.handlers.api_models`, `agent_catalog.api_agent_catalog` | (new: `routes._handle_models`, `_handle_agents`) | A model-list and agent-catalog read for apps | The crew editor's pickers answer 503 |
| `kiro_crew._facade_mirror` | `azure_client.py:61`, `crew_runtime.py:51`, `crew_store.py:34`, `github_client.py:23`, `store.py:24` | (pure, stdlib-only) | Vendored as `backend/_facade_mirror.py` |

## Remaining gaps

1. **Unattended crews do not run** (first section).
2. **Core still hard-codes the app.** Kiro Crew keeps Issue Radar's MCP tools
   (`mcp_tools/apps.py:50`, `:332`, `:358`, `:540-542`, `:620`, `:933`, `:953`,
   `:1100-1108`, `mcp_core.py:929`, `mcp_core_parts/radar_crew.py`), their
   internal-secret path rows (`dashboard/server_internal_paths.py:328-390`) and
   argument schemas (`validation.py:146-162`, `validation_parts/app_schemas.py`),
   the crew-log entry type and its fold (`crew_log/entry_types_ledgers.py:56-190`,
   `:350-495`, `crew_log/projection_radar.py`, `projection.py:275`, `:756`,
   `projection_registry.py:25`, `:643`, `crew_log/schema.py`), the
   `core:issue-radar` caller namespace in `github_runner.py:1287-1328`, rows in
   `security_posture*.py`, `data/mcp_tool_titles.json`, the dashboard catalogs,
   `website/src/apps/builtinRegistry.ts`, `appManifest.ts:238-255`, the module spec
   `docs/system-specs/modules/issue-radar.md` and the RFCs
   `rfc-issue-radar-crews.md` / `rfc-issue-radar-dispatch.md`, and the ratchet rows
   in `test/spawn_audit_app_spawns.py`, `test/link_screen_sites.py`,
   `test/test_chat_follow_default_slot_kinds.py`, `test/test_start_priority.py`,
   `test/test_campaign_facades_base_public_names.py`, `test/test_mcp_apps_tool_gate.py`
   and `test/campaign_facade_inventories/`. The MCP tools call this app's routes
   by their unchanged paths (`/api/apps/issue-radar/investigation`, `/crew`,
   `/crew/work`), so they keep working after adoption while core ships them.
   Moving them needs an app-declared MCP tool seam (the tools, their schemas and
   their internal-secret paths declared by the app) and an app-declared crew-log
   entry type; the user doc and the spec belong in this repository then.
3. **Execution trust.** A built-in's in-gateway Python is exempt from the
   third-party execution gate (`apps/execution.py`, `is_builtin_app`). This copy's
   hooks load only when the operator trusts it; for an existing user, Kiro Crew's
   adoption writes that grant for this repository.
4. **Dashboard reads through private handlers.** `/models` and `/agents` call the
   gateway's own `api_models` / `api_agent_catalog` for the same request. A generic
   SDK read for the model list and the agent roster would remove them.
5. **Investigate and Review open a draft, not a filed, titled, running session.**
   The built-in dispatched the dashboard's Redux thunks: it filed the session into
   a per-repo "Issue Radar - <repo>" folder, titled it, opened it in the repo's
   working copy (`workspace_path`), seeded and ran the first turn, and linked the
   new slot's key to the item's record so a repeat click resumed it. The SDK's
   `useChatLauncher().openChat` opens a new draft with the prompt staged
   (`memoryMode: 'persistent'`, `sessionFolder: false`) and does not report the
   slot it opened, so the person presses Send, the session is not filed, titled or
   placed in the working copy, and a second click on an unfinished item opens a
   second draft. A record the built-in linked still resumes. A launch option that
   names the folder, title and working directory and answers the slot key would
   close this.
6. **Repo-settings working-copy picker.** The dashboard's `ProjectPicker` browses
   the gateway's filesystem and recent projects through dashboard routes; this copy
   offers a typed path (`ui/src/host/ProjectPicker.tsx`). The backend validates it
   on save, as before.
7. **Markdown reference cards.** The built-in turned `#123` links in rendered
   issue bodies into hover cards through the dashboard's `LinkOverrideCtx`, which
   the SDK's `MarkdownRenderer` does not expose; links render as plain links.
8. **Model credit badges.** The crew editor's model rows carried credit-multiplier
   pills through `SimpleSelect`'s `optionBadges`, which the SDK's `Select` does not
   take.
9. **Error hand-off report.** `ErrorNotice`'s "Ask the agent" hand-off carried the
   dashboard's journaled error report (`utils/errorReport.findReport`); a bundle
   cannot read that journal, so the hand-off carries the message alone.
10. **Styles.** The page keeps the built-in's Tailwind utility class strings. They
    render because the dashboard's stylesheet still carries them while the
    compiled built-in page ships with Kiro Crew.
11. **Store listing localization**, **sidebar icon on a fresh install** and
    **author**: as for every first-party port (the catalog's publish step does not
    carry `l10n` yet; the `Radar` glyph and `/issue-radar` route come only from
    the adoption pin; `"author": "kirocrew"` is stated on the catalog row).

## UI

The page is `ui/src/`, the built-in's tree with the same markup, class strings
and behaviour. `npm run build` in `ui/` writes the committed `ui/dist/index.mjs`;
CI rebuilds it and fails on a difference. It imports only the seven modules the
dashboard provides (`tests/test_manifest_contract.py` checks the built file);
`framer-motion`, `react-virtuoso`, four Radix primitives, `clsx` and
`tailwind-merge` are bundled.

| Built-in | Here |
|---|---|
| `fetch('/api/apps/issue-radar/...')` in `api.ts` and `pipeline/api.ts` | `appFetch` (`ui/src/transport.ts`) over `useAppApi().raw`, which the root sets; a scoped refusal is read back as the `Response` the call sites decode |
| `i18n/t.i18nT`, `react-i18next` (`useTranslation`, `Trans`) | `ui/src/host/i18n.tsx` over the app's own catalogs (`ui/i18n/<locale>.json`) |
| `i18n/format`, `i18n/languages` | `ui/src/host/format.ts` (the dashboard's, over the host's `activeLocale`), `languages.ts` |
| `components/ui` (`Badge`, `Btn`, `Card`, `CardTitle`, `EmptyState`, `Input`, `PageHeader`, `StatCard`, `Toggle`), `ErrorNotice`, `Clickable`, `MarkdownRenderer`, `hooks/useImeGuard` | The host's, from `@kirocrew/app-sdk/ui` and `@kirocrew/app-sdk` |
| `IconButton`, `components/ui/{dialog,dropdown-menu,popover,tabs,tabsPill}`, `ConfirmDialog.useConfirm`, `ListDetailBack`, `StatusNotice`, `RadioChipGroup`, `ResizeHandle`, the provider logos, `overlayRoot.OverlayPortal`, `CopyCommandButton`, the `useColumnResize` / `useDialogFocusTrap` / `useListDetailView` / `useReducedMotion` / `useTouchReplay` hooks, `columnWidth`, `safeUrl`, `splitOnPlaceholder`, `safeStorage`, `codePoints`, `pullRequestErrors`, `gitlabHostSet`, `maskInlineCode`, `errMessage`, `formatMultiplier`, `isPricedMultiplier` | Restated in `ui/src/host/` from the dashboard's source, minus the guide's probe hooks and the remote-crew overlay scope |
| `components/SimpleSelect` | The host's level-1 `Select` (native `<select>` on an older host); see gap 8 |
| `components/ProjectPicker` | `ui/src/host/ProjectPicker.tsx`; see gap 6 |
| `react-router-dom` `useNavigate` / `Link` | The host's `useNavigate` (`ui/src/host/router.tsx`) |
| `store` + `store/chatSlice` (`createSlot`, `switchSlot`, `deleteSlot`, `requestSlotFolderOpen`), `api.chatFolders` / `createChatFolder` / `chatSlotDetail`, `chat-core/transport/sendTurn`, `utils/ensureChatFolder`, `utils/seedReceipt` (`lib/agentSession.ts`, `views/CrewPageView.tsx:400`) | `useChatLauncher().openChat` (`lib/agentSession.ts`); see gap 5. The liveness probe before a resume is `GET /pipeline/live-slots` |
| `api.chatSlots` (`pipeline/views/ItemSessionsTable.tsx:296`) | `autoTriagePipelineFoldApi.liveSlots` over `GET /pipeline/live-slots` |
| `api/dashboardConfigQuery.fetchDashboardConfig` (`ConnectPanel.tsx:377`) | `issueRadarApi.gitlabHosts` over `GET /gitlab-hosts` |
| `hooks/useAgents`, `hooks/useAvailableModels` (`components/CrewEditor.tsx:357`, `:361`) | `ui/src/lib/roster.ts` over `GET /agents` and `GET /models` |
| `utils/errorReport.findReport` | No report; see gap 9 |

## Tests

Every built-in test is here and green offline: `python -m pytest` (3,400+
backend tests) and `npm test` in `ui/` (1,600+ UI tests). Kiro Crew is a pinned
test dependency (`tests/requirements.txt`), and the suites patch its real
collaborators as the built-in's did.

| Built-in | Here | Change |
|---|---|---|
| `src/.../issue_radar/tests/*.py` (28), `test/test_issue_radar_*.py` (51), the five helpers, `test/test_gitlab_client_*.py`, `test/test_gitlab_deps.py` | `tests/` | `kiro_crew.apps.builtins.issue_radar.backend` is `backend`. The pieces of Kiro Crew's test floor they used are in `tests/conftest.py` (a per-test data home, the floor's own `monkeypatch`, the crew log off by default, the SEL session directory and `sel_private_root`, retiring the crew log's fold worker). The shared helpers they imported (`dashboard_owner_helpers`, `off_loop_helpers`, `crew_log_drain`, `turn_harness`, `chat_test_helpers`, `source_corpus`, `facade_mirror_scan`, `windows_sim`) are copied. |
| Tests that registered on a `web.Application` (`routes.register_routes(app)`) | `routes._register_on(app)`, the same body | The route-table pins gain the four added reads. |
| The deps registry tests reading `app[_DEPS_REFRESH_TASKS_APP_KEY]` | `routes._deps_refresh_registry(app)` | The registries are off the application. |
| `test_issue_radar_http_routes_seams.py::TestAuditSeam::test_audit_payload` | The same name, over `ctx.audit`, plus two cases (the SEL row, no seam) | The audit seam. |
| `test_issue_radar_facades.py` | Scans this repository's test tree; `backend.*` and the host through `backend._host` are the project homes | The tree moved. |
| `test_issue_radar_crew_triage_model.py::TestPickGenerationWriters` | Scans the pinned host minus its built-in copy of this app, plus `backend/` | The tree moved. |
| `test_issue_radar_http_routes_surface.py` (package re-export, fresh-interpreter import) | The manifest hook and `backend.app_hooks` | No package re-export. |
| `test_issue_radar_crew_runtime*.py` | Unchanged cases, run with the `host_grants` fixture | See the first section. |
| Issue Radar cases of `test/test_github_runner.py`, `test_link_screen_hold_pin.py`, `test_read_json_or_signal.py`, `test_owner_only_files.py`, `test_crew_log_routes_dispatch_fence.py`, `test_slot_close_nudge_race.py`, `test_provider_cli_invoked_name.py` | `tests/test_ported_core_cases.py` | The core cases stay in Kiro Crew. `test_mcp_apps_tool_gate.py` and the ratchet tables pin core's own tables and stay there (gap 2). |
| (none) | `tests/test_no_host_imports.py`, `test_host_surface.py`, `test_app_hooks.py`, `test_auto_approve_disabled.py`, `test_manifest_contract.py` | The host surface pinned, the seams' fail-closed fallbacks, the hook contract and the added reads, the disabled grant, the manifest and the bundle. |
| `website/src/apps/issue-radar/**/*.test.*` (28), `website/src/test/IssueRadar*` / `issueRadar*` (51) and eleven others | `ui/tests/app/`, `ui/tests/ext/` | Run by vitest in the dashboard's own environment (happy-dom, UTC) with a stand-in host SDK (`ui/tests/stubs/`) whose components are restated from the dashboard's source, so the suites see the markup they were written against. Imports point at `ui/src/`; `renderWithProviders`, `MemoryRouter`, `readSource` and the `i18n/all` loader are test helpers; the dev-only `en-XA` pseudolocale is a test fixture. |
| `agentSessionConcludedNoRerun`, `agentSessionResumeMissingSlot`, `agentSessionFolderResolve`, `agentSessionSeedReceipt`, `IssueRadarSessionTitle` | `ui/tests/ext/agentSessionLauncher.test.ts` | They drove the dashboard's Redux slot flow (gap 5). Every rule of theirs this copy still owns is a case there: probe before resume, a failed probe is an error, decline a concluded item (an unknown status too, an absent one not), re-read first, a failed re-read surfaces, reattach a replacement, `force` starts over, the verdict is never cleared, the merge-request namespace. The `isMissingSlotError`, folder, title, seed-receipt and Auto Improvement cases test dashboard code and stay in Kiro Crew. |
| `ItemSessionsTable.test.tsx`, `CrewEditor.agentRoster.test.tsx`, `IssueRadarConnectFlow.test.tsx`, `IssueRadarGitLabGroups.test.tsx`, `RadioChipGroup.test.tsx`, `issueRadarPolling.test.tsx` | Same files | Mock this app's routes (`liveSlots`, `agents`, `gitlabHosts`) instead of the dashboard's client; the error hand-off is the stub host's navigation; the revert guard lists this app's one converted file; the host's cache-retention constant is pinned locally. |
| (none) | `ui/tests/port/` | The transport, the catalogs (every key the page names resolves), the level-1 fallbacks and the path picker. |

## What Kiro Crew keeps doing

The release that adds adoption still ships the built-in. A user's built-in record
moves onto this repository at the commit Kiro Crew pins; a record that cannot
move keeps running the built-in copy, unchanged. Removing the built-in from Kiro
Crew is a later release, after gap 2 (and the security ruling, for anyone who
runs unattended crews) is settled.

## Release handoff: one commit for both pins

1. Call the full 40-hex SHA of the ported tree `C` (`git rev-parse HEAD`).
2. In the Kiro Crew release PR that adds adoption, run
   `python3 scripts/adoption_pin.py compute <this URL> C`, add the row it prints
   to `src/kiro_crew/apps/adoption-pins.json`, then
   `python3 scripts/adoption_pin.py verify`. **Do not add the row before the
   security ruling above**: adoption would silently stop every unattended crew a
   user runs today.
3. The KiroCrewApps row for `issue-radar` switches to `"type": "git"`, this URL,
   `"ref": "C"`, in the same release, never a branch name.
