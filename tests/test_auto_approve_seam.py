"""Issue Radar holds its unattended crews' grant through ``ctx.auto_approve``, and only it.

The built-in once minted the crews' auto-approve grant with its own call into the
core's private ``SafetyOverride``. The wheel copy now goes through the App Kit's
worker auto-approve seam, and this copy reaches the same seam as ``ctx.auto_approve``
(``backend._host.worker_grants``). These pin that:

- the manifest declares ``permissions.workerAutoApprove``, the row the seam reads on
  every grant, exactly as the wheel built-in does;
- no backend module names the host's ``SafetyOverride``, so nothing reaches the grant
  store around the seam;
- the crew scope key is the seam's own, inside this app's namespace;
- the handle forwards to the context's seam, and without one nothing is granted and
  the app's scope is taken off the slot;
- with the host's real seam (declared, approved, enabled), a crew grant lands on the
  crew's own slot and the shared approval path reads the slot as trusted.
"""

from __future__ import annotations

import ast
import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from harness import make_ctx

from backend import _host, crew_runtime

APP_ROOT = Path(__file__).resolve().parents[1]
BACKEND = APP_ROOT / "backend"


def _slot(app: str = crew_runtime.APP_NAME, scope: str = "") -> SimpleNamespace:
    return SimpleNamespace(key="crew-c_1", _app=app, _trust=False, _trust_scope=scope)


class TestTheDeclaration(unittest.TestCase):
    def test_the_manifest_declares_the_grant(self) -> None:
        manifest = json.loads((APP_ROOT / "app.json").read_text(encoding="utf-8"))
        self.assertIs(manifest["permissions"].get("workerAutoApprove"), True)

    def test_no_backend_module_names_the_hosts_grant_store(self) -> None:
        offenders = []
        for path in sorted(BACKEND.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            tree = ast.parse(text)
            for node in ast.walk(tree):
                names: list[str] = []
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module]
                if any(n.startswith("kiro_crew.safety_override") for n in names):
                    offenders.append(f"{path.name}:{node.lineno}")
            if re.search(r"[\"']kiro_crew\.safety_override", text):
                offenders.append(path.name)
        self.assertEqual(offenders, [])

    def test_every_crew_module_holds_the_one_handle(self) -> None:
        self.assertIs(crew_runtime._GRANTS, _host.worker_grants())


class TestTheHandle(unittest.TestCase):
    def test_the_crew_scope_is_the_seams_key_in_this_apps_namespace(self) -> None:
        from kiro_crew.apps import worker_auto_approve

        self.assertEqual(
            crew_runtime.autoapprove_scope("c_1"),
            worker_auto_approve.grant_scope(crew_runtime.APP_NAME, "crew-c_1"),
        )
        self.assertEqual(crew_runtime.GRANT_SOURCE, f"app:{crew_runtime.APP_NAME}")

    def test_without_a_seam_the_scope_key_is_the_same(self) -> None:
        expected = crew_runtime.autoapprove_scope("c_1")
        _host.bind(make_ctx(auto_approve=None))
        self.assertEqual(crew_runtime.autoapprove_scope("c_1"), expected)
        with self.assertRaises(ValueError):
            crew_runtime.autoapprove_scope("bad id")

    def test_the_handle_forwards_to_the_contexts_seam(self) -> None:
        seam = mock.Mock()
        seam.hold.return_value = True
        seam.release.return_value = True
        seam.release_slot.return_value = True
        _host.bind(make_ctx(auto_approve=seam))
        slot = _slot()
        grants = _host.worker_grants()
        self.assertTrue(grants.hold(slot, "crew-c_1", ttl_secs=900))
        seam.hold.assert_called_once_with(slot, "crew-c_1", ttl_secs=900)
        self.assertTrue(grants.release("crew-c_1", slot))
        seam.release.assert_called_once_with("crew-c_1", slot)
        self.assertTrue(grants.release_slot(slot))
        seam.release_slot.assert_called_once_with(slot)

    def test_without_a_seam_nothing_is_granted_and_the_slot_is_cleared(self) -> None:
        _host.bind(make_ctx(auto_approve=None))
        grants = _host.worker_grants()
        scope = grants.scope("crew-c_1")
        slot = _slot(scope=scope)
        self.assertFalse(grants.hold(slot, "crew-c_1", ttl_secs=900))
        self.assertEqual(slot._trust_scope, "")

    def test_without_a_context_nothing_is_granted(self) -> None:
        _host.unbind()
        self.assertFalse(_host.worker_grants().hold(_slot(), "crew-c_1", ttl_secs=900))

    def test_without_a_seam_a_revocation_still_clears_the_slot(self) -> None:
        _host.bind(make_ctx(auto_approve=None))
        grants = _host.worker_grants()
        slot = _slot(scope=grants.scope("crew-c_1"))
        self.assertTrue(grants.release("crew-c_1", slot))
        self.assertEqual(slot._trust_scope, "")
        slot = _slot(scope="app:issue-radar:grant:crew-c_2:autoapprove")
        self.assertTrue(grants.release_slot(slot))
        self.assertEqual(slot._trust_scope, "")
        # A slot another owner holds is left alone.
        other = _slot(app="someone-else", scope="taskrunner:t:autoapprove")
        self.assertFalse(grants.release_slot(other))
        self.assertEqual(other._trust_scope, "taskrunner:t:autoapprove")

    def test_a_seam_that_raises_grants_nothing(self) -> None:
        seam = mock.Mock()
        seam.scope.side_effect = lambda name: f"app:issue-radar:grant:{name}:autoapprove"
        seam.hold.side_effect = RuntimeError("broken")
        _host.bind(make_ctx(auto_approve=seam))
        slot = _slot(scope="app:issue-radar:grant:crew-c_1:autoapprove")
        self.assertFalse(_host.worker_grants().hold(slot, "crew-c_1", ttl_secs=900))
        self.assertEqual(slot._trust_scope, "")

    def test_misuse_still_raises(self) -> None:
        seam = mock.Mock()
        seam.hold.side_effect = ValueError("bad ttl")
        _host.bind(make_ctx(auto_approve=seam))
        with self.assertRaises(ValueError):
            _host.worker_grants().hold(_slot(), "crew-c_1", ttl_secs=0)


class TestTheHostsSeam(unittest.TestCase):
    """The host's real ``WorkerAutoApprove`` and ``SafetyOverride``, with the installed
    record's three reads (declared, approved, enabled) answered for this app alone."""

    def setUp(self) -> None:
        from kiro_crew import safety_override as so_mod
        from kiro_crew.apps import worker_auto_approve

        self.so_mod = so_mod
        self.waa = worker_auto_approve
        so_mod.reset_singleton()
        patcher = mock.patch.object(
            worker_auto_approve,
            "app_holds_worker_auto_approve",
            side_effect=lambda app: app == crew_runtime.APP_NAME,
        )
        self.holds = patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(so_mod.reset_singleton)
        self.addCleanup(worker_auto_approve.revoke_app, crew_runtime.APP_NAME)

    def test_a_crew_grant_lands_on_its_own_slot_and_is_read_as_trusted(self) -> None:
        from kiro_crew.dashboard import chat_runner

        slot = _slot()
        crew = {"id": "c_1", "enabled": True, "unattended": True, "name": "Lyra"}
        self.assertTrue(crew_runtime.sync_trust(slot, crew))
        self.assertEqual(slot._trust_scope, crew_runtime.autoapprove_scope("c_1"))
        self.assertTrue(self.so_mod.safety_override().is_scope_active(slot._trust_scope))
        self.assertTrue(chat_runner._slot_is_trusted(slot))

        crew["unattended"] = False
        self.assertFalse(crew_runtime.sync_trust(slot, crew))
        self.assertEqual(slot._trust_scope, "")
        self.assertFalse(
            self.so_mod.safety_override().is_scope_active(crew_runtime.autoapprove_scope("c_1"))
        )

    def test_the_seam_refuses_a_slot_this_app_does_not_own(self) -> None:
        slot = _slot(app="someone-else")
        crew = {"id": "c_1", "enabled": True, "unattended": True, "name": "Lyra"}
        self.assertFalse(crew_runtime.sync_trust(slot, crew))
        self.assertEqual(slot._trust_scope, "")

    def test_an_app_the_owner_has_not_approved_gets_no_grant(self) -> None:
        self.holds.side_effect = lambda app: False
        slot = _slot()
        crew = {"id": "c_1", "enabled": True, "unattended": True, "name": "Lyra"}
        self.assertFalse(crew_runtime.sync_trust(slot, crew))
        self.assertEqual(slot._trust_scope, "")


if __name__ == "__main__":
    unittest.main()
