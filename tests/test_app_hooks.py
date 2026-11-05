"""The App Kit hooks: ``routes``, ``on_startup``, ``on_shutdown`` (``backend/app_hooks.py``).

``register_routes(ctx)`` returns structural route records (relative paths, one
per route the built-in mounted, plus the reads the built-in page took from the
dashboard itself), binds the context, reports what the gateway lacks through
``ctx.health`` and touches no file. Handlers are called ``handler(request, ctx)``
by the registry. The lifecycle hooks start and stop the watcher on
``ctx.http_app`` and cancel in-flight dependency refreshes.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from backend import _host, app_hooks, gitlab_client, routes, watch
from harness import PREFIX, make_ctx, mount


def _records(ctx=None):
    return app_hooks.register_routes(ctx or make_ctx())


def test_records_are_relative_and_match_the_built_in_table():
    built_in = web.Application()
    with mock.patch.object(routes, "watch"):
        routes._register_on(built_in)
    expected = [
        (r.method, r.resource.canonical[len(PREFIX):])
        for r in built_in.router.routes()
        if r.method != "HEAD"
    ]
    got = [(r.method, r.path) for r in _records()]
    assert got == expected
    assert all(p.startswith("/") and not p.startswith("/api/") for _, p in got)
    assert all(callable(r.handler) for r in _records())


def test_registering_binds_the_context_and_writes_nothing(tmp_path):
    ctx = make_ctx(data_dir=tmp_path / "data")
    app_hooks.register_routes(ctx)
    assert _host.bound() is ctx
    assert not (tmp_path / "data").exists()


def test_health_names_an_older_gateway():
    ctx = make_ctx(sdk_level=0)
    app_hooks.register_routes(ctx)
    assert ctx.health.status == "degraded"
    assert any("App Kit level 1" in issue for issue in ctx.health.issues)


def test_health_is_clean_on_the_pinned_host():
    ctx = make_ctx()
    app_hooks.register_routes(ctx)
    assert ctx.health.issues == []


def test_health_names_each_missing_host_service():
    ctx = make_ctx()
    with mock.patch.object(_host, "_host_module", return_value=None):
        app_hooks.register_routes(ctx)
    assert any(i.startswith("sel:") for i in ctx.health.issues)


def test_a_record_dispatches_with_the_registrys_call_shape():
    ctx = make_ctx()
    record = next(r for r in _records(ctx) if r.path == "/repos" and r.method == "GET")
    with mock.patch.object(routes, "is_app_enabled", return_value=True):
        resp = asyncio.run(record.handler(make_mocked_request("GET", PREFIX + "/repos"), ctx))
    assert resp.status == 200
    assert json.loads(resp.body)["repos"] == []


@pytest.mark.asyncio
async def test_the_routes_serve_under_the_registry_prefix():
    app = web.Application()
    mount(app, make_ctx())
    with mock.patch.object(routes, "is_app_enabled", return_value=True):
        async with TestClient(TestServer(app)) as client:
            resp = await client.get(PREFIX + "/repos")
            assert resp.status == 200
            assert (await resp.json())["repos"] == []


def test_a_disabled_app_still_answers_403():
    ctx = make_ctx()
    record = next(r for r in _records(ctx) if r.path == "/repos")
    with mock.patch.object(routes, "is_app_enabled", return_value=False):
        resp = asyncio.run(record.handler(make_mocked_request("GET", PREFIX + "/repos"), ctx))
    assert resp.status == 403


class TestLifecycle:
    def test_startup_without_the_gateway_application_is_degraded_not_fatal(self):
        ctx = make_ctx(http_app=None)
        app_hooks.register_routes(ctx)
        with mock.patch.object(watch, "start_watcher") as start:
            asyncio.run(app_hooks.on_startup(ctx))
        start.assert_not_called()
        assert any("no gateway application" in issue for issue in ctx.health.issues)

    def test_startup_and_shutdown_run_the_watcher_on_the_gateway_application(self):
        gateway = web.Application()
        ctx = make_ctx(http_app=gateway)
        calls = []

        async def _start(app):
            calls.append(("start", app))

        async def _stop(app):
            calls.append(("stop", app))

        with mock.patch.object(watch, "start_watcher", _start), mock.patch.object(watch, "stop_watcher", _stop):
            app_hooks.register_routes(ctx)
            asyncio.run(app_hooks.on_startup(ctx))
            asyncio.run(app_hooks.on_shutdown(ctx))
        assert calls == [("start", gateway), ("stop", gateway)]

    def test_shutdown_cancels_outstanding_deps_refreshes(self):
        gateway = web.Application()
        ctx = make_ctx(http_app=gateway)
        with mock.patch.object(watch, "start_watcher"), mock.patch.object(watch, "stop_watcher", mock.AsyncMock()):
            app_hooks.register_routes(ctx)

        async def _run():
            task = asyncio.ensure_future(asyncio.sleep(3600))
            routes._deps_refresh_registry(gateway)["k"] = task
            await app_hooks.on_shutdown(ctx)
            return task

        task = asyncio.run(_run())
        assert task.cancelled()

    def test_one_failing_callback_does_not_stop_the_others(self):
        ctx = make_ctx(http_app=web.Application())
        app_hooks.register_routes(ctx)
        good = mock.AsyncMock()
        bad = mock.AsyncMock(side_effect=RuntimeError("boom"))
        routes._lifecycle["cleanup"] = [bad, good]
        asyncio.run(app_hooks.on_shutdown(ctx))
        good.assert_awaited_once()

    def test_the_gateway_application_is_never_written(self):
        gateway = web.Application()
        gateway.freeze()
        ctx = make_ctx(http_app=gateway)
        app_hooks.register_routes(ctx)
        routes._deps_refresh_registry(gateway)
        routes._deps_rebuild_lock(gateway, SimpleNamespace(provider="github", host="github.com", owner="o", repo="r"))
        assert dict(gateway) == {}


class TestTheReadsTheBuiltInTookFromTheDashboard:
    def test_gitlab_hosts_is_the_allowlist_connect_enforces(self):
        with mock.patch.object(gitlab_client, "allowed_hosts", return_value=frozenset({"b.example", "a.example"})):
            resp = asyncio.run(routes._handle_gitlab_hosts(make_mocked_request("GET", "/x")))
        assert json.loads(resp.body) == {"gitlab_hosts": ["a.example", "b.example"]}

    @pytest.mark.parametrize("surface,handler", [("models", "_handle_models"), ("agents", "_handle_agents")])
    def test_models_and_agents_are_the_hosts_own_handlers(self, surface, handler):
        request = make_mocked_request("GET", "/x")
        host = mock.AsyncMock(return_value=web.json_response({"ok": surface}))
        with mock.patch.object(_host, "dashboard_handler", return_value=host) as pick:
            resp = asyncio.run(getattr(routes, handler)(request))
        pick.assert_called_once_with(surface)
        host.assert_awaited_once_with(request)
        assert json.loads(resp.body) == {"ok": surface}

    @pytest.mark.parametrize("handler", ["_handle_models", "_handle_agents"])
    def test_without_the_host_handler_the_read_is_refused(self, handler):
        with mock.patch.object(_host, "dashboard_handler", return_value=None):
            resp = asyncio.run(getattr(routes, handler)(make_mocked_request("GET", "/x")))
        assert resp.status == 503
        assert json.loads(resp.body)["code"] == "host_unavailable"

    def test_the_pinned_host_provides_both_handlers(self):
        assert callable(_host.dashboard_handler("models"))
        assert callable(_host.dashboard_handler("agents"))


class TestLiveSlots:
    def _call(self, query, state):
        from backend import pipeline_routes

        app = web.Application()
        app["state"] = state
        request = make_mocked_request("GET", f"/x?{query}", app=app)
        return asyncio.run(pipeline_routes._handle_live_slots(request))

    def test_answers_which_of_the_given_keys_are_live(self):
        state = SimpleNamespace(_slots={"chat:a": object(), "chat:b": object()})
        resp = self._call("key=chat:a&key=chat:gone&key=chat:a", state)
        assert json.loads(resp.body) == {"live": ["chat:a"]}

    def test_reveals_no_slot_the_caller_did_not_name(self):
        state = SimpleNamespace(_slots={"chat:secret": object()})
        resp = self._call("key=chat:mine", state)
        assert json.loads(resp.body) == {"live": []}

    def test_no_session_list_is_unknown_not_retired(self):
        resp = self._call("key=chat:a", None)
        assert resp.status == 503

    def test_too_many_keys_is_a_400(self):
        from backend import pipeline_routes

        query = "&".join(f"key=k{i}" for i in range(pipeline_routes.LIVE_SLOTS_MAX_KEYS + 1))
        resp = self._call(query, SimpleNamespace(_slots={}))
        assert resp.status == 400
