"""Every place Issue Radar reaches into the Kiro Crew gateway, in one module.

An external app's Python runs inside the gateway process. Issue Radar needs three
kinds of host surface:

1. **The App Kit context** handed to its hooks (``ctx``): the data directory
   (``ctx.data_dir``), the owner gate (``ctx.require_owner``), outbound redaction
   (``ctx.scrub``), the audit log (``ctx.audit``), health reporting
   (``ctx.health``) and the seam level (``ctx.sdk_level``). These are public
   seams. ``register_routes`` binds the context here (:func:`bind`) and every
   reader feature-detects it with ``getattr``. Each has a fallback that is never
   MORE permissive than the host: no owner gate refuses every write, no scrubber
   masks every string, no audit sink logs locally.

2. **Gateway services with no App Kit seam yet.** The vendor-CLI spawn
   chokepoints (``gh`` through the host's runner, ``glab`` and ``az`` with the
   host's audit-or-deny SEL write), the crew sessions (chat slots, the chat
   runner, AutoNudge loops, the crew log, the slot-close hooks), the one-shot
   model call behind the AI summaries, notifications, the host's file helpers.
   None of that has a public seam, so it is resolved from the running gateway
   here by name, through :func:`_host_attr` (``importlib``), and only when an
   operation calls for it. When the gateway does not provide one, the operation
   that needs it raises :class:`HostCapabilityMissing` and is refused, never run
   some other way, and ``register_routes`` names the gap through ``ctx.health``
   (:func:`capability_issues`). ``HOST_SURFACE`` is the whole list, and
   ``tests/test_no_host_imports.py`` pins it; ``PORTING.md`` lists each entry as a
   gap with the generic seam that would replace it.

3. **The crews' auto-approve grant, through ``ctx.auto_approve``.** An
   unattended crew's chat session runs with nobody watching, so its tool calls are
   approved by a bounded, audited grant held on the crew's own slot. The manifest
   declares ``permissions.workerAutoApprove``, and the gateway hands the hooks the
   App Kit's worker auto-approve seam as ``ctx.auto_approve``; :func:`worker_grants`
   is the crew modules' handle on it. Every grant goes through that seam (its own
   slots and scope keys only, the owner's approval, the approval-mode ceiling, a
   fail-closed SEL audit, the 24 h cap, ended with the app). Without the seam (an
   older gateway, or the owner has not approved the permission) nothing is granted:
   an unattended crew takes no turn and an attended crew's tool calls go through
   the ordinary approval prompt. This module never names the host's
   ``SafetyOverride``.

Nothing else in ``backend/`` names ``kiro_crew`` in an import, and this module has
no ``import kiro_crew`` statement: every host name goes through :func:`_host_attr`,
so a missing one never breaks the load.
"""

from __future__ import annotations

import importlib
import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from aiohttp import web

logger = logging.getLogger("kirocrew.app.issue-radar")

APP_NAME = "issue-radar"

#: The App Kit seam level this app is written against: structural route records,
#: ``ctx.require_owner`` and ``ctx.sdk_level``.
REQUIRED_SDK_LEVEL = 1


# ── route records ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Route:
    """One route record for the gateway's ``RouteRegistry``.

    The registry accepts any record with a str ``method``, a str ``path`` and a
    callable ``handler`` from App Kit level 1. ``path`` is relative to
    ``/api/apps/issue-radar``; ``handler`` is called as ``handler(request, ctx)``.
    """

    method: str
    path: str
    handler: Callable[..., Any]


# ── the bound context ───────────────────────────────────────────────────────

_bound_lock = threading.Lock()
_bound_ctx: Any | None = None


def bind(ctx: Any) -> None:
    """Make *ctx* the context every host read below consults."""
    global _bound_ctx
    with _bound_lock:
        _bound_ctx = ctx


def unbind() -> None:
    global _bound_ctx
    with _bound_lock:
        _bound_ctx = None


def bound() -> Any | None:
    """The context :func:`bind` installed, or ``None`` before ``register_routes``."""
    with _bound_lock:
        return _bound_ctx


def sdk_level(ctx: Any | None = None) -> int:
    """The seam level the gateway reports; 0 for a gateway that predates the field."""
    ctx = bound() if ctx is None else ctx
    level = getattr(ctx, "sdk_level", 0)
    return level if isinstance(level, int) and not isinstance(level, bool) else 0


class HostCapabilityMissing(RuntimeError):
    """The gateway does not provide a service this operation requires."""


class HostAttributeMissing(HostCapabilityMissing, AttributeError):
    """A gateway module has no attribute of that name.

    Also an ``AttributeError``, so ``hasattr`` answers ``False`` on it the way it
    does on the gateway's module itself.
    """


# ── public seams ────────────────────────────────────────────────────────────


def _owner_denied() -> web.Response:
    return web.json_response(
        {"error": "owner authorization required", "code": "owner_only"}, status=403
    )


#: The built-in named its owner-gate operations ``issue_radar.<verb>``; the host's
#: ``ctx.require_owner`` prefixes the app's own name (``issue-radar.<verb>``), so
#: the operation passed to it is the bare verb.
_LEGACY_OPERATION_PREFIX = "issue_radar."


async def require_owner_dashboard_request(request: web.Request, operation: str) -> Any | None:
    """``None`` when *request* comes from the dashboard owner; else the refusal.

    Same name and shape as the host helper the built-in imported, so each handler
    keeps its call. It goes through ``ctx.require_owner`` (App Kit level 1), the
    same host gate, which audits a denial as ``issue-radar.<verb>``. A gateway
    without the seam refuses every caller, the owner included (fail closed).
    """
    ctx = bound()
    gate = getattr(ctx, "require_owner", None)
    if not callable(gate):
        return _owner_denied()
    verb = operation
    if isinstance(verb, str) and verb.startswith(_LEGACY_OPERATION_PREFIX):
        verb = verb[len(_LEGACY_OPERATION_PREFIX) :]
    return await gate(request, verb)


_MASK = "[REDACTED]"


def scrub_text(text: str) -> str:
    """*text* through the gateway's outbound redaction (``ctx.scrub``).

    The built-in called ``security.redact`` (credentials and exfiltration URLs);
    ``ctx.scrub.outbound`` runs those same baseline passes and then the active
    policy, so nothing that was masked before is left. No context, no scrubber, a
    scrubber that raises or answers no text: the whole string is masked.
    """
    if not isinstance(text, str):
        text = str(text)
    if not text:
        return text
    scrub = getattr(bound(), "scrub", None)
    outbound = getattr(scrub, "outbound", None)
    if not callable(outbound):
        return _MASK
    try:
        result = outbound(text)
    except Exception:  # noqa: BLE001 - a failed scrub must not let the text out
        logger.warning("issue-radar: outbound scrub failed; masking the text", exc_info=True)
        return _MASK
    out = getattr(result, "text", None)
    return out if isinstance(out, str) else _MASK


def redact(text: str) -> str:
    """The built-in's ``security.redact``, served by :func:`scrub_text`."""
    return scrub_text(text)


def redact_credentials(text: str) -> tuple[str, list[str]]:
    """The built-in's ``security.redact_credentials``, served by :func:`scrub_text`."""
    return scrub_text(text), []


def redact_exfiltration_urls(text: str) -> tuple[str, list[str]]:
    """The built-in's ``security.redact_exfiltration_urls``, served by :func:`scrub_text`."""
    return scrub_text(text), []


def audit(operation: str, outcome: str, *, resources: str = "", error: str = "") -> None:
    """A best-effort audit row through ``ctx.audit`` (caller ``app:issue-radar``).

    The built-in wrote these through ``sel().log_api_access`` as caller
    ``core:issue-radar``; the seam mints the caller from the app name. No audit
    seam is a logged warning, as a failed SEL write was.
    """
    sink = getattr(bound(), "audit", None)
    record = getattr(sink, "record", None)
    if not callable(record):
        logger.warning("issue-radar: no audit seam; %s %s not recorded", operation, outcome)
        return
    try:
        record(operation, outcome, resources=resources, error=error)
    except TypeError:
        record(operation, outcome, resources=resources)
    except Exception:  # noqa: BLE001 - best-effort, like the seam itself
        logger.warning("issue-radar: audit write failed for %s", operation, exc_info=True)


def app_data_dir(name: str = APP_NAME) -> Path:
    """The app's data directory, ``ctx.data_dir``, created on first use.

    The built-in resolved ``<data home>/apps/issue-radar/data`` through
    ``apps.manager.app_data_dir``; the gateway hands an app's hooks the same path
    as ``ctx.data_dir``, so a user's existing data is read as is.
    """
    if name != APP_NAME:
        raise ValueError(f"issue-radar has no data directory for app {name!r}")
    ctx = bound()
    data_dir = getattr(ctx, "data_dir", None)
    if data_dir is None:
        raise HostCapabilityMissing(
            "issue-radar has no data directory yet (register_routes has not run)"
        )
    path = Path(data_dir)
    _ensure_owner_only_directory(path)
    return path


def _ensure_owner_only_directory(path: Path) -> None:
    """Create *path* the way the host creates a data-home directory: ``0700``.

    The host's ``owner_only_files.ensure_directory`` when the gateway has it (the
    built-in's ``app_data_dir`` called exactly that); otherwise every directory
    this creates is made ``0700`` (POSIX), and an existing one is left as it is.
    """
    ensure = _host_attr("kiro_crew.owner_only_files", "ensure_directory")
    if callable(ensure):
        ensure(path)
        return
    missing: list[Path] = []
    probe = path
    while not probe.exists():
        missing.append(probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            if not directory.is_dir():
                raise


def app_dir(name: str = APP_NAME) -> Path:
    """The parent of :func:`app_data_dir`, without creating anything.

    The built-in's pipeline read ``apps.manager.app_dir(...) / "data"``; this is
    the same directory, derived from ``ctx.data_dir``.
    """
    if name != APP_NAME:
        raise ValueError(f"issue-radar has no app directory for app {name!r}")
    data_dir = getattr(bound(), "data_dir", None)
    if data_dir is None:
        raise HostCapabilityMissing(
            "issue-radar has no data directory yet (register_routes has not run)"
        )
    return Path(data_dir).parent


def string_field_error(field: str, value: object) -> web.Response | None:
    """The 400 for a body field that should be text but is not, or ``None``.

    The host's ``dashboard.handlers._shared.string_field_error``, restated: a few
    lines with no policy.
    """
    if isinstance(value, str):
        return None
    return web.json_response(
        {"error": f"{field} must be a string", "code": "invalid_field_type"}, status=400
    )


# ── host services with no seam: resolved by name ────────────────────────────


def _host_attr(module: str, name: str) -> Any | None:
    """``module.name`` from the running gateway, or ``None`` when it has none.

    The one seam tests replace to model an older or stripped-down gateway.
    """
    try:
        mod = importlib.import_module(module)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None
    value = getattr(mod, name, None)
    if value is None:
        # A submodule the package does not bind until something imports it
        # (``kiro_crew.crew_log.emit``): the built-in's ``from pkg import name``
        # imported it on the spot, so this does too.
        try:
            value = importlib.import_module(f"{module}.{name}")
        except Exception:  # noqa: BLE001 - not a submodule either: not provided
            return None
    return value


def _host_module(module: str) -> Any | None:
    try:
        return importlib.import_module(module)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None


#: Every gateway name this app reaches without a seam: surface -> (module, names).
#: ``tests/test_no_host_imports.py`` pins this table, so a new reach into the host
#: is a reviewed change with the gap it creates (``PORTING.md``).
HOST_SURFACE: dict[str, tuple[str, tuple[str, ...]]] = {
    "github_runner": ("kiro_crew.github_runner", ("*",)),
    "github_runner.names": (
        "kiro_crew.github_runner",
        ("PROVIDER_WINGET_ID", "RepoUrlError", "apply_session_bus_address"),
    ),
    "platform_compat": ("kiro_crew.platform_compat", ("*",)),
    "owner_only_files": ("kiro_crew.owner_only_files", ("ensure_directory",)),
    "atomic_write": (
        "kiro_crew.atomic_write",
        ("*", "atomic_write", "read_bytes_with_retry", "read_json_or"),
    ),
    "hooks": ("kiro_crew.hooks", ("*",)),
    "teardown": (
        "kiro_crew.apps.teardown",
        ("*", "register_slot_close_hook", "register_slot_close_undo_hook"),
    ),
    "manager": ("kiro_crew.apps.manager", ("app_lifecycle_lock", "is_app_enabled")),
    "registry": ("kiro_crew.apps.registry", ("minimal_env",)),
    "autonudge": ("kiro_crew.autonudge", ("get_instance",)),
    "autonudge_model": (
        "kiro_crew.autonudge_service.model",
        ("CONSECUTIVE_FAILURE_REASON", "SESSION_START_FAILURE_REASON"),
    ),
    "config": ("kiro_crew.config.loader", ("KiroCrewConfig",)),
    "paths": ("kiro_crew.config.paths", ("data_home",)),
    "constants": ("kiro_crew.constants", ("env_file_display",)),
    "context": ("kiro_crew.context", ("normalize_ui_language_tag", "ui_language_tag")),
    "crew_log": ("kiro_crew.crew_log", ("emit", "projection")),
    "crew_log.entry_types": (
        "kiro_crew.crew_log.entry_types",
        (
            "RADAR_CLEARABLE_FIELDS",
            "RADAR_CREW_LEVEL_EVENT_KIND",
            "RADAR_DEFAULT_SKIP_SCOPE",
            "RADAR_EDITING_PHASES",
            "RADAR_ENTRY_TYPE",
            "RADAR_EVENT_KINDS",
            "RADAR_NUMBER_BOUNDS",
            "RADAR_PHASES",
            "RADAR_SKIP_SCOPES",
            "RADAR_TERMINAL_PHASES",
            "RADAR_TTL_ACTIVE_PHASES",
        ),
    ),
    "crew_log.resolve": ("kiro_crew.crew_log.resolve", ("unit_for_session_key",)),
    "crew_log.schema": ("kiro_crew.crew_log.schema", ("Entry", "KIND_SESSION")),
    "crew_log.store": (
        "kiro_crew.crew_log.store",
        ("CrewLog", "log_exception_text", "session_units_for_slot"),
    ),
    "chat_persistence": (
        "kiro_crew.dashboard.chat_persistence",
        ("rehydrate_slot_from_history_async",),
    ),
    "chat_runner": ("kiro_crew.dashboard.chat_runner", ("_run_chat",)),
    "chat_utils": ("kiro_crew.dashboard.chat_utils", ("slot_history_key",)),
    "chat_utils_slots": ("kiro_crew.dashboard.chat_utils_slots", ("revoke_slot_trust",)),
    "gateway_notice": (
        "kiro_crew.dashboard.gateway_notice",
        ("GATEWAY_NOTICE_CREW_TURN_NO_PERMIT", "gateway_notice_meta"),
    ),
    "crew_log.projection_radar": ("kiro_crew.crew_log.projection_radar", ("RADAR_TEXT_LIMIT",)),
    "notifications_push": ("kiro_crew.dashboard.handlers.notifications_push", ("*",)),
    "notifications_bus": (
        "kiro_crew.notifications.bus",
        ("NotificationPayload", "NotificationValidationError"),
    ),
    "source_providers": (
        "kiro_crew.dashboard.handlers.source_providers",
        ("_validate_provider_executable", "provider_executable_candidates"),
    ),
    "request_priority": ("kiro_crew.dashboard.request_priority", ("owner_start_priority",)),
    "session_control": (
        "kiro_crew.dashboard.session_control",
        ("arm_model_switch_reset", "model_switch_deferred"),
    ),
    "llm_helpers": (
        "kiro_crew.llm_helpers",
        ("ToolApprovalPolicy", "parse_llm_json", "stream_and_collect"),
    ),
    "loop_lock": ("kiro_crew.loop_lock", ("LoopBoundLock",)),
    "memory": ("kiro_crew.memory", ("workspace_dir",)),
    "security": ("kiro_crew.security", ("redact_local_paths",)),
    "sel": ("kiro_crew.sel", ("sel",)),
    "shared_crew": (
        "kiro_crew.shared_crew.admission_gate",
        ("actor_budget",),
    ),
    "shared_crew.turn_gate": ("kiro_crew.shared_crew.turn_gate", ("run_admitted_or_raise",)),
    "session_ledger_control": ("kiro_crew.session_ledger_control", ("_causal_units",)),
    "validation": ("kiro_crew.validation", ("MODEL_PICKER_HIDDEN_MODEL_ID_RE",)),
    "dashboard_handlers": ("kiro_crew.dashboard.handlers", ("api_models",)),
    "agent_catalog": ("kiro_crew.dashboard.handlers.agent_catalog", ("api_agent_catalog",)),
}

#: The surfaces an operation cannot run without, named in ``ctx.health`` when the
#: gateway lacks one.
_REQUIRED_FOR_HEALTH = tuple(HOST_SURFACE)


def capability_issues() -> list[str]:
    """One line per host surface the running gateway does not provide."""
    issues: list[str] = []
    for surface in _REQUIRED_FOR_HEALTH:
        module, names = HOST_SURFACE[surface]
        mod = _host_module(module)
        if mod is None:
            issues.append(f"{surface}: the gateway has no {module}")
            continue
        missing = [n for n in names if n != "*" and _host_attr(module, n) is None]
        if missing:
            issues.append(f"{surface}: the gateway's {module} lacks {', '.join(missing)}")
    return issues


class _HostFunction:
    """A gateway function looked up by name on every call.

    Raises :class:`HostCapabilityMissing` when the gateway has no such function,
    so the operation that needed it is refused. Attribute reads are forwarded to
    the resolved object, so a class (``KiroCrewConfig.load``) works the same way.
    """

    __slots__ = ("_module", "_name")

    def __init__(self, module: str, name: str) -> None:
        self._module = module
        self._name = name

    def _resolve(self) -> Any:
        target = _host_attr(self._module, self._name)
        if target is None:
            raise HostCapabilityMissing(
                f"this Kiro Crew gateway has no {self._module}.{self._name}"
            )
        return target

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self._resolve()(*args, **kwargs)

    def __getattr__(self, attr: str) -> Any:
        if attr.startswith("__") and attr.endswith("__"):
            raise AttributeError(attr)
        return getattr(self._resolve(), attr)

    def __setattr__(self, attr: str, value: Any) -> None:
        if attr in _HostFunction.__slots__:
            object.__setattr__(self, attr, value)
            return
        setattr(self._resolve(), attr, value)

    def __delattr__(self, attr: str) -> None:
        delattr(self._resolve(), attr)

    def __repr__(self) -> str:
        return f"<host {self._module}.{self._name}>"


class _HostModule:
    """A gateway module whose attributes are looked up on every read.

    A missing module raises :class:`HostCapabilityMissing`; a missing attribute
    raises :class:`HostAttributeMissing`, which is also an ``AttributeError``.
    """

    __slots__ = ("_module",)

    def __init__(self, module: str) -> None:
        self._module = module

    def _target(self) -> Any:
        mod = _host_module(self._module)
        if mod is None:
            raise HostCapabilityMissing(f"this Kiro Crew gateway has no {self._module}")
        return mod

    def __getattr__(self, attr: str) -> Any:
        if attr.startswith("__") and attr.endswith("__"):
            raise AttributeError(attr)
        try:
            return getattr(self._target(), attr)
        except AttributeError:
            raise HostAttributeMissing(
                f"this Kiro Crew gateway has no {self._module}.{attr}"
            ) from None

    # A write or delete lands on the gateway's module itself, so a test's
    # ``mock.patch.object(<this>, name, ...)`` patches what the gateway's own code
    # reads too, exactly as the built-in's patch of the imported module did.
    def __setattr__(self, attr: str, value: Any) -> None:
        if attr in _HostModule.__slots__:
            object.__setattr__(self, attr, value)
            return
        setattr(self._target(), attr, value)

    def __delattr__(self, attr: str) -> None:
        delattr(self._target(), attr)

    def __repr__(self) -> str:
        return f"<host module {self._module}>"


def _const(module: str, name: str, fallback: Any) -> Any:
    """``module.name`` resolved once, at import, or *fallback* when it is missing."""
    value = _host_attr(module, name)
    return fallback if value is None else value


class _AbsentHostError(Exception):
    """Stands in for a gateway exception type the gateway does not define.

    Nothing raises it, so an ``except`` clause naming it simply never matches.
    """


# Modules read attribute by attribute.
github_runner = _HostModule("kiro_crew.github_runner")
platform_compat = _HostModule("kiro_crew.platform_compat")
atomic_write_module = _HostModule("kiro_crew.atomic_write")
hooks = _HostModule("kiro_crew.hooks")
teardown = _HostModule("kiro_crew.apps.teardown")
notifications_push = _HostModule("kiro_crew.dashboard.handlers.notifications_push")
projection = _HostModule("kiro_crew.crew_log.projection")

# Functions and classes looked up per call.
atomic_write = _HostFunction("kiro_crew.atomic_write", "atomic_write")
read_bytes_with_retry = _HostFunction("kiro_crew.atomic_write", "read_bytes_with_retry")
read_json_or = _HostFunction("kiro_crew.atomic_write", "read_json_or")
app_lifecycle_lock = _HostFunction("kiro_crew.apps.manager", "app_lifecycle_lock")
minimal_env = _HostFunction("kiro_crew.apps.registry", "minimal_env")
register_slot_close_hook = _HostFunction("kiro_crew.apps.teardown", "register_slot_close_hook")
register_slot_close_undo_hook = _HostFunction(
    "kiro_crew.apps.teardown", "register_slot_close_undo_hook"
)
get_instance = _HostFunction("kiro_crew.autonudge", "get_instance")
KiroCrewConfig = _HostFunction("kiro_crew.config.loader", "KiroCrewConfig")
data_home = _HostFunction("kiro_crew.config.paths", "data_home")
env_file_display = _HostFunction("kiro_crew.constants", "env_file_display")
normalize_ui_language_tag = _HostFunction("kiro_crew.context", "normalize_ui_language_tag")
ui_language_tag = _HostFunction("kiro_crew.context", "ui_language_tag")
emit = _HostFunction("kiro_crew.crew_log", "emit")
unit_for_session_key = _HostFunction("kiro_crew.crew_log.resolve", "unit_for_session_key")
Entry = _HostFunction("kiro_crew.crew_log.schema", "Entry")
CrewLog = _HostFunction("kiro_crew.crew_log.store", "CrewLog")
log_exception_text = _HostFunction("kiro_crew.crew_log.store", "log_exception_text")
session_units_for_slot = _HostFunction("kiro_crew.crew_log.store", "session_units_for_slot")
rehydrate_slot_from_history_async = _HostFunction(
    "kiro_crew.dashboard.chat_persistence", "rehydrate_slot_from_history_async"
)
_run_chat = _HostFunction("kiro_crew.dashboard.chat_runner", "_run_chat")
slot_history_key = _HostFunction("kiro_crew.dashboard.chat_utils", "slot_history_key")
_validate_provider_executable = _HostFunction(
    "kiro_crew.dashboard.handlers.source_providers", "_validate_provider_executable"
)
provider_executable_candidates = _HostFunction(
    "kiro_crew.dashboard.handlers.source_providers", "provider_executable_candidates"
)
owner_start_priority = _HostFunction("kiro_crew.dashboard.request_priority", "owner_start_priority")
arm_model_switch_reset = _HostFunction("kiro_crew.dashboard.session_control", "arm_model_switch_reset")
model_switch_deferred = _HostFunction("kiro_crew.dashboard.session_control", "model_switch_deferred")
apply_session_bus_address = _HostFunction("kiro_crew.github_runner", "apply_session_bus_address")
ToolApprovalPolicy = _HostFunction("kiro_crew.llm_helpers", "ToolApprovalPolicy")
parse_llm_json = _HostFunction("kiro_crew.llm_helpers", "parse_llm_json")
stream_and_collect = _HostFunction("kiro_crew.llm_helpers", "stream_and_collect")
LoopBoundLock = _HostFunction("kiro_crew.loop_lock", "LoopBoundLock")
workspace_dir = _HostFunction("kiro_crew.memory", "workspace_dir")
NotificationPayload = _HostFunction("kiro_crew.notifications.bus", "NotificationPayload")
sel = _HostFunction("kiro_crew.sel", "sel")
actor_budget = _HostFunction("kiro_crew.shared_crew.admission_gate", "actor_budget")
run_admitted_or_raise = _HostFunction("kiro_crew.shared_crew.turn_gate", "run_admitted_or_raise")


def dashboard_handler(surface: str) -> Callable[..., Any] | None:
    """The gateway's own handler for ``GET /api/models`` (``"models"``) or
    ``GET /api/agents/catalog`` (``"agents"``), or ``None``.

    The crew editor offers the list the dashboard's own pickers show, and both
    paths are outside this app's API grant; the app's ``/models`` and ``/agents``
    answer them by calling the host's handler for the same request, so the host's
    own access rules apply unchanged.
    """
    module, name = {
        "models": ("kiro_crew.dashboard.handlers", "api_models"),
        "agents": ("kiro_crew.dashboard.handlers.agent_catalog", "api_agent_catalog"),
    }[surface]
    fn = _host_attr(module, name)
    return fn if callable(fn) else None


def is_app_enabled(name: str) -> bool:
    """The host's enabled flag for *name*; ``False`` when the gateway cannot say.

    Every caller treats ``False`` as "stand down": a route answers 403, a crew
    takes no turn and its grants are revoked.
    """
    fn = _host_attr("kiro_crew.apps.manager", "is_app_enabled")
    if not callable(fn):
        return False
    return bool(fn(name))


def redact_local_paths(text: str) -> tuple[str, list[str]]:
    """The host's local-path redaction; the whole string is masked without it."""
    fn = _host_attr("kiro_crew.security", "redact_local_paths")
    if not callable(fn):
        return (_MASK if text else text), []
    return fn(text)


def causal_units(
    slot_key: str, units: tuple[str, ...], recorded: tuple[str, ...]
) -> tuple[str, ...]:
    """*units* reordered by the *recorded* order tail, the host's ledger rule.

    The host's ``session_ledger_control._causal_units``: a unit missing from the
    tail folds before the recorded ones, except the slot's newest unit by
    succession (a reset's new session that has not recorded yet), which folds
    last. A gateway without it gets the earlier rule, every missing unit first;
    the record folded is the same either way, only the warm cell may refold.
    """
    fn = _host_attr("kiro_crew.session_ledger_control", "_causal_units")
    if callable(fn):
        return tuple(fn(slot_key, units, recorded))
    if not recorded:
        return units
    known = [unit for unit in recorded if unit in units]
    rest = [unit for unit in units if unit not in recorded]
    return tuple(rest + known)


# Exception types an ``except`` clause names, resolved once.
RepoUrlError = _const("kiro_crew.github_runner", "RepoUrlError", _AbsentHostError)
NotificationValidationError = _const(
    "kiro_crew.notifications.bus", "NotificationValidationError", _AbsentHostError
)

# Constants, resolved once, with the host's current values as the fallback.
PROVIDER_WINGET_ID = _const(
    "kiro_crew.github_runner", "PROVIDER_WINGET_ID", {"gh": "GitHub.cli", "glab": "GLab.GLab"}
)
CONSECUTIVE_FAILURE_REASON = _const(
    "kiro_crew.autonudge_service.model", "CONSECUTIVE_FAILURE_REASON", "consecutive_failures"
)
SESSION_START_FAILURE_REASON = _const(
    "kiro_crew.autonudge_service.model", "SESSION_START_FAILURE_REASON", "session_start_failures"
)
KIND_SESSION = _const("kiro_crew.crew_log.schema", "KIND_SESSION", "session")
#: The model picker's id rule. Without the host's, no id passes (a crew then runs
#: on the agent's own model, the built-in's answer to an id the picker refuses).
MODEL_PICKER_HIDDEN_MODEL_ID_RE = _const(
    "kiro_crew.validation", "MODEL_PICKER_HIDDEN_MODEL_ID_RE", re.compile(r"(?!)")
)

# The crew ledger's closed vocabularies. Core DECLARES them (the crew log is core
# and validates every ``radar/recorded`` entry against them), so they are read
# from the gateway; the fallbacks are the values core declares today, and
# ``tests/test_host_surface.py`` pins them equal to the pinned host's.
_ET = "kiro_crew.crew_log.entry_types"
RADAR_ENTRY_TYPE = _const(_ET, "RADAR_ENTRY_TYPE", "radar/recorded")
RADAR_PHASES = _const(
    _ET,
    "RADAR_PHASES",
    (
        "selected",
        "claimed",
        "investigating",
        "implementing",
        "awaiting-ci",
        "addressing-review",
        "awaiting-merge",
        "awaiting-reply",
        "resolved",
        "skipped",
        "yielded",
        "handed-back",
        "preempted",
    ),
)
RADAR_TERMINAL_PHASES = _const(
    _ET,
    "RADAR_TERMINAL_PHASES",
    frozenset({"resolved", "skipped", "yielded", "handed-back", "preempted"}),
)
RADAR_TTL_ACTIVE_PHASES = _const(
    _ET, "RADAR_TTL_ACTIVE_PHASES", frozenset({"claimed", "investigating", "implementing"})
)
RADAR_EDITING_PHASES = _const(
    _ET, "RADAR_EDITING_PHASES", frozenset({"implementing", "addressing-review"})
)
RADAR_EVENT_KINDS = _const(
    _ET,
    "RADAR_EVENT_KINDS",
    (
        "claim",
        "investigate",
        "reply",
        "implement",
        "ci",
        "review",
        "conflict",
        "merge",
        "handback",
        "skip",
        "yield",
        "sweep",
    ),
)
RADAR_CREW_LEVEL_EVENT_KIND = _const(_ET, "RADAR_CREW_LEVEL_EVENT_KIND", "sweep")
RADAR_SKIP_SCOPES = _const(
    _ET,
    "RADAR_SKIP_SCOPES",
    (
        "architecture",
        "new-feature",
        "needs-design",
        "needs-decision",
        "needs-investigation",
        "duplicate",
        "already-fixed",
        "not-reproducible",
        "wrong-root-cause",
        "breaking-change",
        "gate-config",
        "other",
    ),
)
RADAR_DEFAULT_SKIP_SCOPE = _const(_ET, "RADAR_DEFAULT_SKIP_SCOPE", "other")
RADAR_CLEARABLE_FIELDS = _const(
    _ET,
    "RADAR_CLEARABLE_FIELDS",
    (
        "decision",
        "why",
        "next",
        "worktree",
        "branch",
        "base_sha",
        "pr_number",
        "claim_comment_id",
        "ci_state",
        "labels_applied",
        "outcome",
    ),
)
RADAR_NUMBER_BOUNDS = _const(
    _ET,
    "RADAR_NUMBER_BOUNDS",
    {
        "number": (1, 1_000_000_000),
        "pr_number": (1, 1_000_000_000),
        "claim_comment_id": (1, 10**18),
    },
)


# ── the auto-approve grant: the App Kit's worker auto-approve seam ──────────

#: A grant name, as the seam accepts it (``ctx.auto_approve``).
_GRANT_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")


class _WorkerGrants:
    """The crews' handle on ``ctx.auto_approve``, the App Kit worker auto-approve seam.

    The same four members as the seam's ``WorkerAutoApprove`` (``source``,
    ``scope``, ``hold``, ``release``, ``release_slot``), each forwarded to the seam
    on the context :func:`bind` installed, read on every call so a re-enable's new
    context is the one used. The seam decides every grant: it re-reads the
    declaration, the owner's approval and ``enabled``, attaches only to this app's
    own slots under this app's own scope keys, and audits fail-closed.

    Without the seam (no context yet, a gateway older than the seam, or a context
    built without ``permissions.workerAutoApprove`` because the owner has not
    approved it) nothing is granted: ``hold`` answers ``False`` and takes this
    app's scope off the slot. ``release`` and ``release_slot`` still take a grant
    off the slot, because a revocation can only remove access. A seam that raises
    on a grant fails closed the same way; a malformed name or TTL is the caller's
    bug and raises ``ValueError``, as the seam does.
    """

    @property
    def source(self) -> str:
        """The ``source`` every grant of this app is audited under."""
        return f"app:{APP_NAME}"

    @staticmethod
    def _seam() -> Any | None:
        seam = getattr(bound(), "auto_approve", None)
        return seam if callable(getattr(seam, "hold", None)) else None

    def scope(self, name: str) -> str:
        """The scope key of grant *name*: the seam's, inside this app's namespace."""
        seam = self._seam()
        if seam is not None:
            return str(seam.scope(name))
        if not isinstance(name, str) or not _GRANT_NAME_RE.fullmatch(name):
            raise ValueError(f"a grant name is 1-128 letters, digits, '_', '.' or '-', not {name!r}")
        return f"app:{APP_NAME}:grant:{name}:autoapprove"

    @staticmethod
    def _clear(slot: Any, scope: str) -> bool:
        if slot is not None and str(getattr(slot, "_trust_scope", "") or "") == scope:
            slot._trust_scope = ""
            return True
        return False

    def hold(self, slot: Any, name: str, *, ttl_secs: float) -> bool:
        """Mint or slide grant *name* on *slot* through the seam. ``False``: no grant."""
        seam = self._seam()
        if seam is None:
            self._clear(slot, self.scope(name))
            logger.info(
                "issue-radar: auto-approve grant %s not held: the gateway offers no "
                "ctx.auto_approve (permissions.workerAutoApprove not approved, or an "
                "older Kiro Crew)",
                name,
            )
            return False
        try:
            return bool(seam.hold(slot, name, ttl_secs=ttl_secs))
        except ValueError:
            raise
        except Exception:  # noqa: BLE001 - a broken seam grants nothing
            logger.warning("issue-radar: the auto-approve seam failed on %s", name, exc_info=True)
            self._clear(slot, self.scope(name))
            return False

    def release(self, name: str, slot: Any = None) -> bool:
        """End grant *name* and clear it from *slot*. Whether anything was live or cleared."""
        seam = self._seam()
        if seam is not None:
            try:
                return bool(seam.release(name, slot))
            except ValueError:
                raise
            except Exception:  # noqa: BLE001 - a revocation must not break the caller
                logger.warning("issue-radar: could not release grant %s", name, exc_info=True)
        return self._clear(slot, self.scope(name))

    def release_slot(self, slot: Any) -> bool:
        """Clear whatever grant this app's own crew *slot* carries. Whether any was."""
        seam = self._seam()
        if seam is not None:
            try:
                return bool(seam.release_slot(slot))
            except Exception:  # noqa: BLE001 - a revocation must not break the caller
                logger.warning("issue-radar: could not release a slot's grant", exc_info=True)
        if str(getattr(slot, "_app", "") or "") != APP_NAME:
            return False
        if not str(getattr(slot, "_trust_scope", "") or ""):
            return False
        slot._trust_scope = ""
        return True


_WORKER_GRANTS = _WorkerGrants()


def worker_grants() -> _WorkerGrants:
    """The crew modules' handle on the worker auto-approve seam (see above)."""
    return _WORKER_GRANTS


# ── small host reads with a fallback ────────────────────────────────────────

#: The crew log's cap on one ``radar/recorded`` text field.
RADAR_TEXT_LIMIT = _const("kiro_crew.crew_log.projection_radar", "RADAR_TEXT_LIMIT", 5000)
GATEWAY_NOTICE_CREW_TURN_NO_PERMIT = _const(
    "kiro_crew.dashboard.gateway_notice",
    "GATEWAY_NOTICE_CREW_TURN_NO_PERMIT",
    "crew_turn_no_permit",
)


def gateway_notice_meta(token: str, **args: Any) -> dict[str, object]:
    """The host's ``gateway_notice_meta``: the localization token a status row carries.

    Without it the row keeps its English text and carries no token.
    """
    fn = _host_attr("kiro_crew.dashboard.gateway_notice", "gateway_notice_meta")
    if not callable(fn):
        return {}
    return fn(token, **args)


def revoke_slot_trust(state: Any, slot: Any) -> None:
    """Clear a slot's interactive trust the way the host does, or at least the flag.

    The host's ``chat_utils_slots.revoke_slot_trust`` also clears the sibling slots
    sharing the session and the cached ``approval_policy`` turn admission. A
    gateway without it gets the flag cleared, which only removes access.
    """
    fn = _host_attr("kiro_crew.dashboard.chat_utils_slots", "revoke_slot_trust")
    if callable(fn):
        fn(state, slot)
        return
    slot._trust = False
