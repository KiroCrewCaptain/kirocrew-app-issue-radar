"""SECURITY: this copy never mints a ``SafetyOverride`` auto-approve grant.

The built-in minted a scoped auto-approve grant for an unattended crew's session
(``crew_runtime_session.sync_trust`` -> ``safety_override().activate_scoped``) and
slid it forward every watchdog cycle. An external app has no reviewed, bounded
seam for that capability, and this port does not create one: ``backend/_host.py``
binds the crew modules to a stand-in whose grants are never active, so
``sync_trust`` returns ``False``, the slot carries no ``_trust_scope``, and an
unattended crew takes no turn (the built-in's fail-closed branch). Revocation
still reaches the host. PORTING.md lists this first, as needing a maintainer
security ruling before adoption.

The built-in's own grant suites run the kept code path against the host's real
``SafetyOverride`` through the ``host_grants`` fixture (tests/conftest.py); these
tests pin what ships.
"""

from __future__ import annotations

import ast
import asyncio
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from backend import _host, crew_runtime, crew_runtime_session, crew_runtime_supervision

BACKEND = Path(__file__).resolve().parents[1] / "backend"


def _crew(**over):
    base = {"id": "c_sec", "enabled": True, "unattended": True, "name": "Lyra"}
    base.update(over)
    return base


class TestTheShippedBindingNeverGrants(unittest.TestCase):
    def test_every_crew_module_holds_the_disabled_stand_in(self) -> None:
        for module in (crew_runtime, crew_runtime_session, crew_runtime_supervision):
            with self.subTest(module=module.__name__):
                self.assertIs(module.safety_override, _host.safety_override)
                self.assertIsInstance(module.safety_override(), _host._DisabledSafetyOverride)

    def test_the_switch_is_off_and_nothing_sets_it(self) -> None:
        self.assertIs(_host.AUTO_APPROVE_GRANTS_ENABLED, False)
        writes = [
            str(path.relative_to(BACKEND))
            for path in BACKEND.rglob("*.py")
            if re.search(r"AUTO_APPROVE_GRANTS_ENABLED\s*=(?!=)", path.read_text(encoding="utf-8"))
            and path.name != "_host.py"
        ]
        self.assertEqual(writes, [])

    def test_activate_and_renew_never_reach_the_host(self) -> None:
        host_factory = mock.MagicMock()
        with mock.patch.object(_host, "_host_attr", return_value=host_factory):
            so = _host.safety_override()
            self.assertFalse(so.activate_scoped("crew:c_sec:autoapprove", source="x", ttl=60).active)
            self.assertFalse(so.renew_scoped("crew:c_sec:autoapprove", source="x", ttl=60).renewed)
            self.assertFalse(so.is_scope_active("crew:c_sec:autoapprove"))
            self.assertEqual(so.scope_remaining_secs("crew:c_sec:autoapprove"), 0.0)
        host_factory.assert_not_called()

    def test_revocation_still_reaches_the_host(self) -> None:
        host_so = mock.MagicMock()
        with mock.patch.object(_host, "_host_attr", return_value=lambda: host_so):
            _host.safety_override().deactivate_scope("crew:c_sec:autoapprove")
        host_so.deactivate_scope.assert_called_once_with("crew:c_sec:autoapprove")

    def test_a_revocation_failure_does_not_break_the_caller(self) -> None:
        host_so = mock.MagicMock()
        host_so.deactivate_scope.side_effect = RuntimeError("audit down")
        with mock.patch.object(_host, "_host_attr", return_value=lambda: host_so), self.assertLogs(
            "kirocrew.app.issue-radar", "WARNING"
        ):
            self.assertIsNone(_host.safety_override().deactivate_scope("s"))


class TestAnUnattendedCrewGetsNoGrant(unittest.TestCase):
    def test_sync_trust_refuses_and_leaves_no_scope_on_the_slot(self) -> None:
        slot = SimpleNamespace(_trust_scope="", _trust=False)
        self.assertFalse(crew_runtime.sync_trust(slot, _crew()))
        self.assertEqual(slot._trust_scope, "")
        self.assertFalse(slot._trust)

    def test_the_refusal_is_logged_as_the_configured_behaviour(self) -> None:
        slot = SimpleNamespace(_trust_scope="")
        with self.assertLogs("kirocrew.app.issue-radar", "INFO") as logs:
            crew_runtime.sync_trust(slot, _crew())
        self.assertTrue(any("does not mint" in r.getMessage() for r in logs.records))
        self.assertFalse(any(r.levelname == "ERROR" for r in logs.records))

    def test_the_host_registry_never_holds_this_crews_scope(self) -> None:
        from kiro_crew.safety_override import safety_override as host_safety_override

        slot = SimpleNamespace(_trust_scope="")
        crew_runtime.sync_trust(slot, _crew())
        scope = crew_runtime.autoapprove_scope("c_sec")
        self.assertFalse(host_safety_override().is_scope_active(scope))

    def test_a_wake_of_an_unattended_crew_dispatches_no_turn(self) -> None:
        """``_reconcile_trust`` answers untrusted, and the dispatch gate stands down."""

        async def _run() -> bool:
            slot = SimpleNamespace(_trust_scope="", _trust=False, busy=False)
            with mock.patch.object(crew_runtime_supervision, "is_app_enabled", return_value=True):
                return await crew_runtime_supervision._reconcile_trust(None, slot, _crew())

        self.assertFalse(asyncio.run(_run()))


class TestNoOtherMechanismGrants(unittest.TestCase):
    def test_no_backend_code_sets_an_interactive_trust_flag(self) -> None:
        """Only revocations write ``slot._trust``: never to a truthy value."""
        offenders = []
        for path in sorted(BACKEND.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Attribute) and target.attr == "_trust":
                            if not (isinstance(node.value, ast.Constant) and node.value.value is False):
                                offenders.append(f"{path.name}:{node.lineno}")
        self.assertEqual(offenders, [])

    def test_only_host_py_reaches_the_host_safety_override(self) -> None:
        """No other module names it; the one kept caller of ``activate_scoped`` /
        ``renew_scoped`` (the built-in's ``_hold_grant``) reaches only the
        ``safety_override`` its module holds, which is the stand-in."""
        offenders = [
            str(path.relative_to(BACKEND))
            for path in sorted(BACKEND.rglob("*.py"))
            if path.name != "_host.py"
            and re.search(r"[\"']kiro_crew\.safety_override", path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(offenders, [])
        callers = [
            str(path.relative_to(BACKEND))
            for path in sorted(BACKEND.rglob("*.py"))
            if path.name != "_host.py"
            and re.search(r"\.(activate_scoped|renew_scoped)\(", path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(callers, ["crew_runtime_session.py"])


if __name__ == "__main__":
    unittest.main()
