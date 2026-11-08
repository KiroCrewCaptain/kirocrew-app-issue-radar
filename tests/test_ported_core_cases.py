"""Issue Radar's cases from Kiro Crew test files that also cover core.

Each block below is copied from the named Kiro Crew file (``test/<file>`` at the
commit ``PORTING.md`` names), where it exercised this app beside core code. The
core cases of those files stay in Kiro Crew. Only the import of the app moved
(``backend`` is ``backend`` here).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import stat
import threading
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from chat_test_helpers import _make_state
from windows_sim import read_sharing_violation

from kiro_crew import atomic_write as atomic_write_module
from kiro_crew import atomic_write as aw
from kiro_crew import autonudge, github_runner, platform_compat
from kiro_crew import github_runner as runner
from kiro_crew.autonudge import AutoNudgeService, NudgeAdmissionRefused
from kiro_crew.config.paths import config_dir
from kiro_crew.dashboard import chat_handlers as handlers

from backend import crew_runtime
from backend import gitlab_client as gl


# ── test/test_github_runner.py (TestOneHome) ──────────────────────────────────


class TestOneHome:
    def test_github_client_url_parser_is_the_shared_function(self):
        from backend import github_client

        assert github_client.parse_github_repo_url is runner.parse_github_repo_url

    def test_repo_url_error_is_one_class_across_layers(self):
        from backend import errors, github_client

        assert errors.RepoUrlError is runner.RepoUrlError
        assert github_client.RepoUrlError is runner.RepoUrlError
        with pytest.raises(errors.RepoUrlError):
            runner.parse_github_repo_url("https://evil.example/o/r")


# ── src/kiro_crew/apps/builtins/issue_radar/tests/test_core_parity.py ──────────
#
# This app's three agent tools are declared in its ``app.json`` and served by its own
# ``agent-tools`` route; the host reads them from the manifest under the app's id, and
# no core table keys them.

_AGENT_TOOLS = frozenset(
    {"issue_radar_crew_read", "issue_radar_crew_record", "issue_radar_record_investigation"}
)


def test_the_manifest_declares_the_tools_this_app_serves_under_its_own_id():
    from issue_radar_agent_tools_helpers import declared_here
    from kiro_crew.mcp_tools import apps as apps_tools

    from backend import agent_tools, store

    declared = {t.name: t for t in declared_here()}
    assert set(declared) == _AGENT_TOOLS == set(agent_tools.TOOLS)
    assert {t.app for t in declared.values()} == {store.APP_NAME}
    assert {t.route for t in declared.values()} == {"agent-tools"}
    assert _AGENT_TOOLS.isdisjoint(apps_tools.TOOL_APPS)


# ── test/test_link_screen_hold_pin.py ─────────────────────────────────────────


def test_an_ordinary_link_layout_is_not_broken_by_the_hold(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A write whose own chain carries no link still works on a host that HAS links.

    The passing control for this gate. A hold that refused any host where a reparse
    point exists would read as correct against the refusal direction alone, while
    breaking every machine whose config tree is placed by a dotfile manager: a
    supported layout, not an attack. What the hold owes is that the screen and the
    use reach the same object, NOT that no junction exists here.

    Both branches are exercised on every platform, because one of them is otherwise
    unreachable and a control that never runs the code it names proves nothing.
    Where a parent descriptor can carry the rename, the write takes the pinned
    parent and returns before the chain is ever walked -- so the hold is also driven
    with that capability forced off, which is the only branch Windows has.

    The link is made with the product's own :func:`platform_compat.symlink_or_junction`,
    so the layout is the shape the product itself creates: a symlink where the
    privilege allows one, a directory junction on an unelevated Windows host.
    """
    from backend import crew_store

    real = tmp_path / "real"
    (real / "crew").mkdir(parents=True)
    platform_compat.symlink_or_junction(real, tmp_path / "linked")
    assert (tmp_path / "linked" / "crew").is_dir(), "the link layout was not created"

    def write_under(root: Path, *, force_hold: bool) -> None:
        (root / "crew").mkdir(parents=True)
        target = root / "crew" / "unit-order.txt"
        with monkeypatch.context() as patched:
            if force_hold:
                patched.setattr(
                    atomic_write_module, "pinned_parent_replace_supported", lambda: False
                )
            walks_the_chain = not atomic_write_module.pinned_parent_replace_supported()
            if walks_the_chain and platform_compat.first_linked_ancestor(target) is not None:
                # MEASURED, not assumed, and it still asserts rather than passing
                # silently. A host can place its own temp tree under a link -- macOS
                # ``/tmp`` is one -- so a chain with no link on it is not expressible
                # under ``tmp_path`` there, and the write refuses for the host's link
                # rather than for anything this gate is about.
                with pytest.raises(OSError):
                    crew_store._write_unit_order(
                        target, ("alpha", "beta"), max_depth=len(target.parts) + 32
                    )
                return
            crew_store._write_unit_order(
                target, ("alpha", "beta"), max_depth=len(target.parts) + 32
            )
        assert target.read_text(encoding="utf-8") == "alpha\nbeta\n"

    write_under(tmp_path / "platform", force_hold=False)
    write_under(tmp_path / "held", force_hold=True)


def test_write_through_a_link_reaches_the_object_the_screen_inspected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Addressed THROUGH a link, the write lands in the screened object or refuses.

    Which of the two happens is the platform's answer, not this gate's: where a
    parent descriptor can carry the rename, the write goes through the pinned parent
    and lands in the real directory; where the chain is walked and held instead, a
    link on that chain is refused outright. Both are asserted here on every
    platform, the second by forcing the descriptor capability off, so the refusal is
    measured everywhere rather than only where it is the default.

    That refusal is the reason this gate converts nothing. On the held branch --
    which is the only branch the platform with junctions has -- this function does
    not write through an ordinary dotfile-manager layout at all: it already refuses
    every link on its parent chain, so extending the hold to further call sites buys
    no privilege and costs supported layouts. Which is why :data:`HELD_SITES` names
    the sites that vet a target and continue, and leaves the refusing ones alone.
    """
    from backend import crew_store

    real = tmp_path / "real"
    (real / "crew").mkdir(parents=True)
    link = tmp_path / "linked"
    platform_compat.symlink_or_junction(real, link)
    settled = real / "crew" / "unit-order.txt"
    settled.write_text("alpha\nbeta\n", encoding="utf-8")
    through_link = link / "crew" / "unit-order.txt"

    if atomic_write_module.pinned_parent_replace_supported():
        crew_store._write_unit_order(
            through_link, ("gamma",), max_depth=len(through_link.parts) + 32
        )
        assert settled.read_text(encoding="utf-8") == "gamma\n"
        settled.write_text("alpha\nbeta\n", encoding="utf-8")

    with monkeypatch.context() as patched:
        patched.setattr(atomic_write_module, "pinned_parent_replace_supported", lambda: False)
        with pytest.raises(OSError):
            crew_store._write_unit_order(
                through_link, ("gamma",), max_depth=len(through_link.parts) + 32
            )
    assert settled.read_text(encoding="utf-8") == "alpha\nbeta\n"

    # Either way nothing was created outside the object the screen inspected.
    assert sorted(p.name for p in (real / "crew").iterdir()) == ["unit-order.txt"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["linked", "real"]


# ── test/test_read_json_or_signal.py ──────────────────────────────────────────


@pytest.fixture
def _read_degrade_fresh(monkeypatch):
    monkeypatch.setattr(aw, "_REPLACE_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(aw, "_READ_DEGRADE_SEEN", aw.OrderedDict())


@pytest.mark.usefixtures("_read_degrade_fresh")
def test_converted_site_read_signals_emits_the_degrade(tmp_path, monkeypatch, caplog):
    """issue_radar ``read_signals`` (site 14) now signals a read-degrade.

    Before this change its ``except (OSError, json.JSONDecodeError): return {}``
    folded the Windows sharing-violation window into the same silent ``{}`` a
    genuinely absent cache returns.
    """
    from backend import crew_runtime

    monkeypatch.setattr(platform_compat, "IS_WINDOWS", True)
    monkeypatch.setattr(aw, "on_event_loop", lambda: True)
    path = crew_runtime.signals_path("o", "r", tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema": crew_runtime.SIGNALS_SCHEMA, "items": {}}), "utf-8")

    with caplog.at_level(logging.WARNING, logger=crew_runtime.logger.name):
        with read_sharing_violation(match=path.name, times=10_000):
            result = crew_runtime.read_signals("o", "r", tmp_path)

    assert result == {}  # unchanged fallback
    recs = [r for r in caplog.records if r.name == crew_runtime.logger.name]
    assert len(recs) == 1
    assert "outcome=default_returned" in recs[0].getMessage()


# ── test/test_owner_only_files.py ─────────────────────────────────────────────


def _mode(path: Path | str) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def _readable_by_others(root: Path) -> list[str]:
    """Every file or directory under *root* with a group/other bit, links excluded."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(dirpath, name)
            st = os.lstat(path)
            if stat.S_ISLNK(st.st_mode):
                continue
            if stat.S_IMODE(st.st_mode) & 0o077:
                found.append(f"{oct(stat.S_IMODE(st.st_mode))} {path.relative_to(root)}")
    return found


@pytest.fixture
def home():
    """The test's (isolated) data home, created the way production creates it, umask 022."""
    previous = os.umask(0o022)
    try:
        yield config_dir()
    finally:
        os.umask(previous)


@pytest.mark.skipif(not platform_compat.IS_POSIX, reason="POSIX mode bits")
def test_the_issue_radar_config_lock_is_owner_only(home: Path) -> None:
    from backend import store_repos

    with store_repos._config_lock():
        pass

    assert _mode(store_repos.data_dir() / "config.json.lock") == 0o600
    assert _readable_by_others(home) == []


# ── test/test_crew_log_routes_dispatch_fence.py ───────────────────────────────


@pytest.mark.parametrize(
    "refusal",
    [
        "work_ledger",
        "crew_store",
        "mcp_ledger",
    ],
)
def test_every_crew_log_off_refusal_names_the_env_file_the_gateway_reads(
    monkeypatch, tmp_path, refusal
):
    """The same file, spelled once, in every place that tells an operator to edit it."""
    import importlib
    import inspect

    from kiro_crew import session_ledger
    from backend import crew_store
    from kiro_crew.dashboard.handlers import work_ledger
    from kiro_crew.mcp_tools import ledger as mcp_ledger

    module = {
        "session_ledger": session_ledger,
        "work_ledger": work_ledger,
        "crew_store": crew_store,
        "mcp_ledger": mcp_ledger,
    }[refusal]
    source = inspect.getsource(module)
    if refusal in ("crew_store", "work_ledger"):  # mirror facades: code is in their owners
        source += "".join(inspect.getsource(importlib.import_module(o)) for o in module._OWNERS)
    assert "~/.kiro/crew/.env" not in source
    assert "env_file_display()" in source


# ── test/test_slot_close_nudge_race.py ────────────────────────────────────────

NAME = "chat-1-1785"


class _Req:
    """Minimal stand-in for the aiohttp request the delete handler reads.

    The race tests drive the handler directly rather than through a client: the
    interleaving has to be scheduled deterministically, and the client's own
    awaits would let the expiring timer run before the handler even started.
    """

    def __init__(self, state, slot: str) -> None:
        self.app = {"state": state}
        self.match_info = {"slot": slot}

    def get(self, key: str, default: str = "") -> str:
        del key
        return default


def _state_with_slot(tmp_path, name: str = NAME):
    state = _make_state(tmp_path)
    slot = state.get_or_create_slot(name)
    slot.append("user", "watch the PR")
    slot.append("assistant", "watching")
    slot.drain()
    return state


async def _service(tmp_path, monkeypatch, on_fire=None) -> AutoNudgeService:
    """A real AutoNudgeService registered as the process-wide instance.

    Real, not a mock: the ordering this suite asserts lives in the service's own
    remove/timer bookkeeping, and a mock would assert nothing about it.
    """
    svc = AutoNudgeService(base_dir=tmp_path, on_fire=on_fire)
    monkeypatch.setattr(autonudge, "_INSTANCE", svc)
    return svc


@pytest.mark.asyncio
async def test_issue_radar_arm_queued_behind_final_retirement_is_refused(
    tmp_path, monkeypatch
) -> None:
    state = _state_with_slot(tmp_path)
    slot = state._slots[NAME]
    slot._app = "issue-radar"
    svc = await _service(tmp_path, monkeypatch)
    hook_entered = asyncio.Event()
    release_hook = asyncio.Event()

    async def _hook(_app: str, _slot_key: str) -> bool:
        hook_entered.set()
        await release_hook.wait()
        return True

    monkeypatch.setattr("kiro_crew.apps.teardown.notify_slot_closed", _hook)
    monkeypatch.setattr(crew_runtime, "ensure_crew_session", AsyncMock(return_value=slot))
    monkeypatch.setattr(
        crew_runtime,
        "compose_turn_prompt_async",
        AsyncMock(return_value="replacement arm"),
    )
    write_entered = threading.Event()
    release_write = threading.Event()
    original_write = svc._write_state

    def _stall_empty_write(payload: dict[str, object]) -> None:
        if not payload["loops"]:
            write_entered.set()
            assert release_write.wait(timeout=5)
        original_write(payload)

    monkeypatch.setattr(svc, "_write_state", _stall_empty_write)
    close = asyncio.create_task(handlers.api_chat_slot_delete(_Req(state, NAME)))
    await hook_entered.wait()
    await svc.add(NAME, "mid-hook arm", idle_secs=300)
    release_hook.set()
    assert await asyncio.to_thread(write_entered.wait, 5)
    launch = asyncio.create_task(
        crew_runtime.launch_crew(
            state,
            "owner",
            "repo",
            {"id": "crew-1"},
            tmp_path,
        )
    )
    try:
        for _ in range(10):
            await asyncio.sleep(0)
            if svc._inflight_adds:
                break
        assert svc._inflight_adds
        assert not launch.done()
        release_write.set()
        response = await close
        launch_result = await asyncio.gather(launch, return_exceptions=True)

        assert response.status == 200
        assert NAME not in state._slots
        assert isinstance(launch_result[0], NudgeAdmissionRefused)
        assert svc.get_by_slot(NAME) is None
    finally:
        release_hook.set()
        release_write.set()
        for task in (launch, close):
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        svc.stop()


# ── test/test_provider_cli_invoked_name.py ────────────────────────────────────

# bash where it exists: a `/bin/sh` that is a launcher for another shell may not
# hand the name it was called by on to that shell.
_SHELL = Path("/bin/bash") if Path("/bin/bash").exists() else Path("/bin/sh")
_needs_a_plain_shell = pytest.mark.skipif(
    _SHELL.resolve().name == "busybox",
    reason="a busybox shell dispatches on the link name itself",
)

# The command name as a multicall binary derives it: the basename of argv[0].
_REPORT_NAME = 'printf "%s\\n" "${0##*/}"'
_REPORT_NAME_JSON = 'printf \'{"tool": "%s"}\' "${0##*/}"'


@pytest.fixture(autouse=True)
def _hermetic_resolution(_floor_monkeypatch):
    for name in (
        github_runner.GH_BIN_ENV,
        github_runner.GH_PREVALIDATED_ENV,
        github_runner.STRICT_PROVIDER_BIN_ENV,
        "KIROCREW_GLAB_BIN",
        "KIROCREW_ISSUE_RADAR_GLAB",
    ):
        _floor_monkeypatch.delenv(name, raising=False)
    _floor_monkeypatch.setattr(github_runner, "_RESOLVE_CACHE", {})
    _floor_monkeypatch.setattr(github_runner, "_REPORTED_RESOLVED_LAUNCHES", set())
    _floor_monkeypatch.setattr(github_runner, "agent_writable_roots", lambda: ())
    # The rule applies where an ACL's write shows in the mode bits. Pinning that
    # answer runs these layouts the same on every POSIX host;
    # TestWhereAnACLCanHideAWriter covers the other answer.
    _floor_monkeypatch.setattr(github_runner, "_acl_writes_show_in_mode_bits", lambda: True)


def _model_ownership(
    monkeypatch,
    *,
    user_owned: tuple[Path, ...],
    shared: tuple[Path, ...] = (),
    sticky: tuple[Path, ...] = (),
    foreign_links: tuple[Path, ...] = (),
) -> None:
    """Answer the ownership walk from a model: anything at or under a
    *user_owned* path is the gateway user's, anything at or under a *shared*
    path is root's but writable by a group the gateway user is not in, each
    *sticky* directory itself is a root-owned temp dir every account may add
    entries to, each of *foreign_links* is a symlink another account owns, and
    everything else is root's alone."""
    owned = tuple(path.resolve() for path in user_owned)
    others = tuple(path.resolve() for path in shared)
    temp_dirs = tuple(path.resolve() for path in sticky)
    foreign = tuple(link.parent.resolve() / link.name for link in foreign_links)

    def under(path: Path, roots: tuple[Path, ...]) -> bool:
        return any(path == root or root in path.parents for root in roots)

    def check(path: Path, *, label: str, uid: int, strict: bool) -> None:
        if strict and under(path, owned):
            raise ValueError(f"{label} is not root-owned")
        if strict and under(path, others):
            raise ValueError(f"{label} is writable by a group")
        if strict and path in temp_dirs:
            raise ValueError(f"{label} is writable by the gateway user")

    def who_can_change(path: Path, *, uid: int) -> tuple[bool, bool]:
        if path in temp_dirs:
            return False, True
        return under(path, owned), under(path, others)

    def symlink_owner(link: Path) -> int:
        return os.geteuid() + 1 if link in foreign else os.geteuid()

    monkeypatch.setattr(github_runner, "check_provider_path_component", check)
    monkeypatch.setattr(github_runner, "_who_can_change", who_can_change)
    monkeypatch.setattr(github_runner, "_symlink_owner", symlink_owner)


def _link(directory: Path, name: str, target: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    link = directory / name
    link.symlink_to(target)
    return link


@pytest.mark.skipif(os.name != "posix", reason="multicall links are a POSIX layout")
@_needs_a_plain_shell
class TestConsumersLaunchTheKeptName:
    """No consumer knows about the rule: each launches the resolver's answer."""

    @pytest.fixture(autouse=True)
    def _hermetic_resolution(self, _floor_monkeypatch):
        for name in (
            github_runner.GH_BIN_ENV,
            github_runner.GH_PREVALIDATED_ENV,
            github_runner.STRICT_PROVIDER_BIN_ENV,
            "KIROCREW_GLAB_BIN",
            "KIROCREW_ISSUE_RADAR_GLAB",
        ):
            _floor_monkeypatch.delenv(name, raising=False)
        _floor_monkeypatch.setattr(github_runner, "_RESOLVE_CACHE", {})
        _floor_monkeypatch.setattr(github_runner, "_REPORTED_RESOLVED_LAUNCHES", set())
        _floor_monkeypatch.setattr(github_runner, "agent_writable_roots", lambda: ())
        _floor_monkeypatch.setattr(github_runner, "_acl_writes_show_in_mode_bits", lambda: True)

    @pytest.fixture
    def installed_as(self, monkeypatch, tmp_path):
        """Install the stand-in behind a user-owned link, as a per-user tool
        distribution does, with the binary behind it the user's too."""

        def install(name: str) -> Path:
            home = tmp_path / "home"
            link = _link(home / "bin", name, _SHELL)
            _model_ownership(monkeypatch, user_owned=(home, _SHELL))
            return link

        return install

    def test_issue_radar_glab(self, monkeypatch, installed_as):
        monkeypatch.setenv("KIROCREW_ISSUE_RADAR_GLAB", str(installed_as("glab")))
        monkeypatch.setattr(gl, "_glab_bin_cache", None)
        monkeypatch.setattr(gl, "_audit", lambda *args, **kwargs: None)

        proc = gl._glab_run(["glab", "-c", _REPORT_NAME], host="gitlab.com", timeout=30.0)

        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.strip() == "glab"
