"""What the backend takes from Kiro Crew, pinned.

The gateway's public surface for an app is the ``AppContext`` its hooks get and
the structural route records the registry accepts. A ``kiro_crew`` import pins
the app to one wheel's private module layout, and the first release that moves
that module breaks every installed copy at load time.

This app still needs gateway services that have no App Kit seam yet (PORTING.md,
"Remaining gaps"). So the rule here is narrower than "never": no backend module
imports ``kiro_crew``, and the one module that names it, ``backend/_host.py``,
does so only through its ``HOST_SURFACE`` table, resolved name by name at call
time. A new reach into the host therefore changes the table pinned below, in
review, with the gap it creates.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

from backend import _host

BACKEND = Path(__file__).resolve().parents[1] / "backend"

PINNED = {
    "github_runner": ("kiro_crew.github_runner", ("*",)),
    "github_runner.names": ("kiro_crew.github_runner", ("RepoUrlError", "apply_session_bus_address")),
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
    "safety_override": ("kiro_crew.safety_override", ("safety_override",)),
    "security": ("kiro_crew.security", ("redact_local_paths",)),
    "sel": ("kiro_crew.sel", ("sel",)),
    "shared_crew": ("kiro_crew.shared_crew.admission_gate", ("actor_budget",)),
    "shared_crew.turn_gate": ("kiro_crew.shared_crew.turn_gate", ("run_admitted_or_raise",)),
    "validation": ("kiro_crew.validation", ("MODEL_PICKER_HIDDEN_MODEL_ID_RE",)),
    "dashboard_handlers": ("kiro_crew.dashboard.handlers", ("api_models",)),
    "agent_catalog": ("kiro_crew.dashboard.handlers.agent_catalog", ("api_agent_catalog",)),
}


def _kiro_crew_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [a.name for a in node.names if a.name.split(".")[0] == "kiro_crew"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "kiro_crew":
                found.append(node.module)
    return found


class TestNoBackendModuleImportsKiroCrew(unittest.TestCase):
    def test_no_import_statement_names_kiro_crew(self) -> None:
        offenders = {
            str(path.relative_to(BACKEND)): names
            for path in sorted(BACKEND.rglob("*.py"))
            if (names := _kiro_crew_imports(path))
        }
        self.assertEqual(offenders, {})

    def test_no_module_resolves_a_host_name_outside_host_py(self) -> None:
        """``importlib`` on a ``kiro_crew`` name anywhere else would bypass the table."""
        pattern = re.compile(r"""import_module\(\s*["']kiro_crew""")
        offenders = [
            str(path.relative_to(BACKEND))
            for path in sorted(BACKEND.rglob("*.py"))
            if path.name != "_host.py" and pattern.search(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(offenders, [])


class TestTheHostSurfaceIsPinned(unittest.TestCase):
    def test_the_table_is_the_pinned_one(self) -> None:
        self.assertEqual(_host.HOST_SURFACE, PINNED)

    def test_every_name_host_py_resolves_is_in_the_table(self) -> None:
        """Each ``("kiro_crew.x", "name")`` literal pair ``_host.py`` resolves is listed."""
        text = (BACKEND / "_host.py").read_text(encoding="utf-8")
        pairs = set(re.findall(r"""\(\s*["'](kiro_crew[\w.]*)["'],\s*["'](\w+)["']""", text))
        listed = {(module, name) for module, names in PINNED.values() for name in names}
        listed |= {(module, "*") for module, names in PINNED.values()}
        modules = {module for module, _ in PINNED.values()}
        unlisted = sorted(
            (m, n) for m, n in pairs if (m, n) not in listed and not (m in modules and n == "*")
        )
        self.assertEqual(unlisted, [])
        lone = set(re.findall(r"""_HostModule\(\s*["'](kiro_crew[\w.]*)["']\s*\)""", text))
        self.assertLessEqual(lone - {"kiro_crew.crew_log.projection"}, modules)

    def test_the_pinned_host_provides_every_listed_name(self) -> None:
        """The pinned Kiro Crew (tests/requirements.txt) has all of it: health is clean."""
        self.assertEqual(_host.capability_issues(), [])


if __name__ == "__main__":
    unittest.main()
