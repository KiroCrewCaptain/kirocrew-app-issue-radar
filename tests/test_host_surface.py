"""``backend/_host.py``: the public seams fail closed, and the host names resolve.

Every reach into the gateway is either a public App Kit seam read off the bound
context, or a host service resolved by name at call time. Each fallback is never
MORE permissive than the host: no owner gate refuses everyone, no scrubber masks
the whole string, no enabled flag reads as disabled, no local-path redactor masks.
"""

from __future__ import annotations

import asyncio
import os
import stat
import unittest
from pathlib import Path
from unittest import mock

import pytest
from aiohttp.test_utils import make_mocked_request

from backend import _host
from harness import make_ctx


def _json(resp):
    import json

    return resp.status, json.loads(resp.body.decode("utf-8"))


class TestTheOwnerGate(unittest.TestCase):
    def test_without_the_seam_every_caller_is_refused(self) -> None:
        _host.bind(make_ctx(require_owner=None))
        resp = asyncio.run(_host.require_owner_dashboard_request(make_mocked_request("POST", "/x"), "issue_radar.connect"))
        self.assertEqual(_json(resp), (403, {"error": "owner authorization required", "code": "owner_only"}))

    def test_the_seam_gets_the_bare_verb(self) -> None:
        seen = []

        async def gate(request, operation):
            seen.append(operation)
            return None

        _host.bind(make_ctx(require_owner=gate))
        self.assertIsNone(asyncio.run(_host.require_owner_dashboard_request(make_mocked_request("GET", "/x"), "issue_radar.pull_merge")))
        self.assertEqual(seen, ["pull_merge"])

    def test_the_hosts_refusal_is_returned_unchanged(self) -> None:
        sentinel = object()

        async def gate(request, operation):
            return sentinel

        _host.bind(make_ctx(require_owner=gate))
        self.assertIs(asyncio.run(_host.require_owner_dashboard_request(make_mocked_request("GET", "/x"), "connect")), sentinel)


class TestOutboundScrub(unittest.TestCase):
    def test_the_hosts_scrubber_masks_a_credential(self) -> None:
        secret = "ghp_" + "a" * 36
        out = _host.scrub_text(f"token {secret} here")
        self.assertNotIn(secret, out)

    def test_no_scrubber_masks_the_whole_string(self) -> None:
        _host.bind(make_ctx(scrub=None))
        self.assertEqual(_host.scrub_text("anything at all"), "[REDACTED]")

    def test_a_scrubber_that_raises_masks_the_whole_string(self) -> None:
        broken = mock.MagicMock()
        broken.outbound.side_effect = RuntimeError("policy load failed")
        _host.bind(make_ctx(scrub=broken))
        with self.assertLogs("kirocrew.app.issue-radar", "WARNING"):
            self.assertEqual(_host.scrub_text("anything"), "[REDACTED]")

    def test_a_scrubber_with_no_text_masks_the_whole_string(self) -> None:
        odd = mock.MagicMock()
        odd.outbound.return_value = object()
        _host.bind(make_ctx(scrub=odd))
        self.assertEqual(_host.scrub_text("anything"), "[REDACTED]")

    def test_the_tuple_forms_keep_the_built_ins_call_shape(self) -> None:
        self.assertEqual(_host.redact_credentials("plain"), ("plain", []))
        self.assertEqual(_host.redact_exfiltration_urls("plain"), ("plain", []))
        self.assertEqual(_host.redact(""), "")


class TestHostNamesFailClosed(unittest.TestCase):
    def test_a_missing_function_refuses_the_operation(self) -> None:
        with mock.patch.object(_host, "_host_attr", return_value=None):
            with self.assertRaises(_host.HostCapabilityMissing):
                _host.minimal_env()

    def test_a_missing_module_attribute_is_an_attribute_error_too(self) -> None:
        with self.assertRaises(AttributeError):
            _host.platform_compat.no_such_name_anywhere
        self.assertFalse(hasattr(_host.platform_compat, "no_such_name_anywhere"))

    def test_without_the_hosts_flag_the_app_reads_as_disabled(self) -> None:
        with mock.patch.object(_host, "_host_attr", return_value=None):
            self.assertFalse(_host.is_app_enabled("issue-radar"))

    def test_without_the_hosts_path_redactor_the_whole_string_is_masked(self) -> None:
        with mock.patch.object(_host, "_host_attr", return_value=None):
            self.assertEqual(_host.redact_local_paths("/home/someone/x"), ("[REDACTED]", []))
            self.assertEqual(_host.redact_local_paths(""), ("", []))

    def test_capability_issues_name_what_a_stripped_gateway_lacks(self) -> None:
        with mock.patch.object(_host, "_host_module", return_value=None):
            issues = _host.capability_issues()
        self.assertTrue(any(i.startswith("github_runner:") for i in issues))

    def test_an_absent_exception_type_never_matches(self) -> None:
        try:
            raise ValueError("x")
        except _host._AbsentHostError:  # pragma: no cover - must not match
            self.fail("matched")
        except ValueError:
            pass


class TestTheCrewLedgerVocabulary(unittest.TestCase):
    """Core declares these (it validates every ``radar/recorded`` entry); the
    fallbacks this app carries for a host without them must equal the host's."""

    def test_the_fallbacks_are_the_pinned_hosts_values(self) -> None:
        from kiro_crew.crew_log import entry_types

        for name in (
            "RADAR_ENTRY_TYPE",
            "RADAR_PHASES",
            "RADAR_TERMINAL_PHASES",
            "RADAR_TTL_ACTIVE_PHASES",
            "RADAR_EDITING_PHASES",
            "RADAR_EVENT_KINDS",
            "RADAR_CREW_LEVEL_EVENT_KIND",
            "RADAR_SKIP_SCOPES",
            "RADAR_DEFAULT_SKIP_SCOPE",
            "RADAR_CLEARABLE_FIELDS",
            "RADAR_NUMBER_BOUNDS",
        ):
            with self.subTest(name=name):
                with mock.patch.object(_host, "_host_attr", return_value=None):
                    module = _host._ET
                    fallback = _host._const(module, name, getattr(_host, name))
                self.assertEqual(getattr(entry_types, name), getattr(_host, name))
                self.assertEqual(fallback, getattr(entry_types, name))


class TestTheSmallHostReads(unittest.TestCase):
    """The reads ported with the wheel's fixes since the snapshot, and their fallbacks."""

    def test_the_text_cap_and_the_notice_token_are_the_hosts(self) -> None:
        import inspect

        from kiro_crew.crew_log import projection_radar
        from kiro_crew.dashboard import gateway_notice

        self.assertEqual(_host.RADAR_TEXT_LIMIT, projection_radar.RADAR_TEXT_LIMIT)
        self.assertEqual(
            _host.GATEWAY_NOTICE_CREW_TURN_NO_PERMIT,
            gateway_notice.GATEWAY_NOTICE_CREW_TURN_NO_PERMIT,
        )
        # The literal fallbacks a host without them gets are the host's values too.
        source = inspect.getsource(_host)
        self.assertIn('"RADAR_TEXT_LIMIT", 5000)', source)
        self.assertEqual(projection_radar.RADAR_TEXT_LIMIT, 5000)
        self.assertIn('"crew_turn_no_permit",', source)

    def test_the_notice_meta_is_the_hosts_and_absent_without_it(self) -> None:
        from kiro_crew.dashboard import gateway_notice

        token = _host.GATEWAY_NOTICE_CREW_TURN_NO_PERMIT
        self.assertEqual(
            _host.gateway_notice_meta(token), gateway_notice.gateway_notice_meta(token)
        )
        with mock.patch.object(_host, "_host_attr", return_value=None):
            self.assertEqual(_host.gateway_notice_meta(token), {})

    def test_revoking_a_slots_trust_without_the_host_still_clears_the_flag(self) -> None:
        from types import SimpleNamespace

        slot = SimpleNamespace(key="crew-c_1", _trust=True)
        with mock.patch.object(_host, "_host_attr", return_value=None):
            _host.revoke_slot_trust(SimpleNamespace(), slot)
        self.assertFalse(slot._trust)

    def test_revoking_a_slots_trust_goes_through_the_host(self) -> None:
        from types import SimpleNamespace

        calls = []
        slot = SimpleNamespace(key="crew-c_1", _trust=True)
        state = SimpleNamespace()
        with mock.patch.object(
            _host, "_host_attr", return_value=lambda st, sl: calls.append((st, sl))
        ):
            _host.revoke_slot_trust(state, slot)
        self.assertEqual(calls, [(state, slot)])


class TestTheDataDirectory(unittest.TestCase):
    def test_it_is_the_contexts_and_is_created_owner_only(self) -> None:
        """Under the data home (where the gateway puts ``ctx.data_dir``) the host's
        ``ensure_directory`` makes every new directory ``0700``, as the built-in's
        ``app_data_dir`` did."""
        from kiro_crew.config.paths import data_home

        ctx = make_ctx()
        _host.bind(ctx)
        target = data_home() / "apps" / "issue-radar" / "data"
        self.assertEqual(_host.app_data_dir("issue-radar"), target)
        self.assertTrue(target.is_dir())
        self.assertEqual(_host.app_dir("issue-radar"), target.parent)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)

    def test_the_fallback_creation_is_owner_only_too(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a" / "b"
            with mock.patch.object(_host, "_host_attr", return_value=None):
                _host._ensure_owner_only_directory(target)
            self.assertTrue(target.is_dir())
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)

    def test_another_apps_name_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            _host.app_data_dir("other-app")

    def test_no_context_is_refused_rather_than_guessed(self) -> None:
        _host.unbind()
        with self.assertRaises(_host.HostCapabilityMissing):
            _host.app_data_dir()


@pytest.mark.parametrize(
    "op,expected",
    [("issue_radar.connect", "connect"), ("pull_merge", "pull_merge"), ("issue_radar.", "")],
)
def test_the_legacy_prefix_is_stripped_once(op, expected):
    seen = []

    async def gate(request, operation):
        seen.append(operation)

    _host.bind(make_ctx(require_owner=gate))
    asyncio.run(_host.require_owner_dashboard_request(make_mocked_request("GET", "/x"), op))
    assert seen == [expected]
