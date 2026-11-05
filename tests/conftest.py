"""Test floor: the app root on ``sys.path``, an isolated data home, a bound context.

* The gateway loads hook files into a synthetic package named after the app, so
  the backend never needs to be on ``sys.path`` there. A plain pytest run has no
  such loader, so the app root is put on the path and ``backend`` imports as a
  package.
* Kiro Crew (a pinned test dependency, ``tests/requirements.txt``) is the host
  the backend resolves through ``backend/_host.py``. Its data home is pinned to a
  throwaway directory BEFORE anything imports it, and again per test, so no test
  reads or writes the operator's real ``~/.kiro/crew``.
* The pieces of Kiro Crew's own test floor these suites relied on, restated:
  the crew log is off unless a test turns it on (``KIROCREW_CREW_LOG=0``), the
  security event log writes to a session directory (``sel_private_root`` gives a
  test its own), and the crew log's fold worker is retired after each test,
  while that test's data-home pin still holds.
* Every test runs with a context bound the way ``register_routes`` binds the
  gateway's: the host's own scrubber and audit sink, an owner gate with the
  host's predicate, and a data directory under the test's data home. A test
  that models a gateway without one of them replaces it.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
for entry in (str(APP_ROOT), str(TESTS)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

_SESSION_HOME = Path(tempfile.mkdtemp(prefix="kca-issue-radar-home-"))
os.environ["KIROCREW_HOME"] = str(_SESSION_HOME / "crew")
os.environ["KIROCREW_WORKSPACE"] = str(_SESSION_HOME / "workspace")
os.environ["KIROCREW_CREW_LOG"] = "0"
for _leak in ("KIROCREW_STRICT_ON_LOOP_PERSIST", "GH_HOST", "GH_TOKEN", "GITHUB_TOKEN"):
    os.environ.pop(_leak, None)

# Kiro Crew's own test helper, re-exported under the name its suites import.
from kiro_crew.testing.links import make_dir_link  # noqa: E402,F401


def pytest_unconfigure(config: pytest.Config) -> None:
    shutil.rmtree(_SESSION_HOME, ignore_errors=True)


@pytest.fixture
def _floor_monkeypatch():
    """The floor's OWN ``MonkeyPatch``, undone after the test's ``monkeypatch``.

    As in Kiro Crew's suite: a test that calls ``monkeypatch.undo()`` part-way
    must not also drop the data-home pin, so the floor patches through this
    separate instance.
    """
    mp = pytest.MonkeyPatch()
    try:
        yield mp
    finally:
        mp.undo()


@pytest.fixture
def monkeypatch(_floor_monkeypatch):
    """pytest's ``monkeypatch``, ordered after :func:`_floor_monkeypatch`."""
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


@pytest.fixture(autouse=True, scope="session")
def _isolate_sel_default_dir(tmp_path_factory):
    """The security event log's default directory, for the whole session.

    SEL is a process singleton whose writer is a daemon thread bound to the
    directory it first resolved; a per-test directory would be deleted under it.
    """
    from kiro_crew import sel as _sel

    original_default = _sel._default_dir
    original_instance = _sel.SecurityEventLog._instance
    sel_dir = tmp_path_factory.mktemp("sel")
    _sel._default_dir = lambda: sel_dir
    _sel.SecurityEventLog._instance = None
    try:
        yield
    finally:
        _sel._default_dir = original_default
        _sel.SecurityEventLog._instance = original_instance


@pytest.fixture
def sel_private_root(tmp_path_factory):
    """Bind the SEL singleton to a directory private to the requesting test (sync writes)."""
    from kiro_crew.sel import SecurityEventLog

    root = tmp_path_factory.mktemp("sel-private")
    prior_instance = SecurityEventLog._instance
    SecurityEventLog._instance = None
    SecurityEventLog._initialized = False
    try:
        SecurityEventLog(base_dir=root, sync=True)
        yield root
    finally:
        SecurityEventLog._instance = prior_instance
        SecurityEventLog._initialized = False


def _retire_crew_log_workers() -> None:
    mod = sys.modules.get("kiro_crew.crew_log.eager")
    retire = getattr(mod, "retire_for_tests", None)
    if retire is not None:
        retire()
    resume = getattr(mod, "resume_for_tests", None)
    if resume is not None:
        resume()
    tree = sys.modules.get("kiro_crew.crew_log.session_tree_projection")
    reset = getattr(tree, "reset_for_tests", None)
    if reset is not None:
        try:
            reset()
        except Exception:  # noqa: BLE001 - teardown must not mask the test result
            pass


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path: Path, _floor_monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / "kirocrew-home"
    _floor_monkeypatch.setenv("KIROCREW_HOME", str(home))
    _floor_monkeypatch.setenv("KIROCREW_WORKSPACE", str(tmp_path / "kirocrew-workspace"))
    yield home
    _retire_crew_log_workers()


@pytest.fixture(autouse=True)
def bound_ctx(_isolated_home: Path):
    """The context ``register_routes`` would bind, for every test."""
    from backend import _host
    from harness import make_ctx

    ctx = make_ctx(_isolated_home)
    _host.bind(ctx)
    yield ctx
    _host.unbind()


@pytest.fixture
def host_grants(monkeypatch: pytest.MonkeyPatch):
    """Run the crew grant code path against the HOST's real ``SafetyOverride``.

    The shipped app never mints an auto-approve grant: ``backend._host.safety_override``
    is a stand-in whose grants are never active (``tests/test_auto_approve_disabled.py``
    pins that). The crew code that would mint, renew and revoke a grant is kept,
    and these suites -- the built-in's own -- exercise it the way the built-in's
    suite did, by binding the crew modules to the host's grant registry for the
    test alone. Nothing in ``backend/`` can reach this binding.
    """
    from kiro_crew.safety_override import safety_override as host_safety_override

    from backend import crew_runtime

    monkeypatch.setattr(crew_runtime, "safety_override", host_safety_override)
    yield host_safety_override
