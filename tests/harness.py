"""Serve the backend the way the gateway's RouteRegistry and lifecycle do.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches the
remainder against each route record and calls ``handler(request, ctx)``; the
lifecycle dispatcher calls ``on_startup(ctx)`` and ``on_shutdown(ctx)``.
:func:`mount` does the same on a test's own ``web.Application``, under the same
prefix, so a test request uses the URL a dashboard request uses and
``ctx.http_app`` is that application, as the gateway's is.

:func:`make_ctx` builds the context at App Kit level 1 with the host's real
``ScrubSDK`` and ``AuditSDK`` and an owner gate that is the host's own
(Kiro Crew is a pinned test dependency). Its ``data_dir`` follows the data home
the way the built-in's ``app_data_dir`` did: resolved when read, so a test that
moves ``KIROCREW_HOME`` moves the app's data with it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiohttp import web

APP_NAME = "issue-radar"
PREFIX = f"/api/apps/{APP_NAME}"


class FakeHealth:
    def __init__(self) -> None:
        self.status = "healthy"
        self.issues: list[str] = []

    def mark_degraded(self, issue: str) -> None:
        self.status = "degraded"
        self.issues.append(issue)

    def mark_error(self, issue: str) -> None:
        self.status = "error"
        self.issues.append(issue)


class FakeCtx:
    """The parts of ``kiro_crew.apps.context.AppContext`` this app reads."""

    name = APP_NAME

    def __init__(self, *, data_dir: Path | None = None, sdk_level: int = 1, **seams: Any) -> None:
        from kiro_crew.apps.audit_sdk import AuditSDK
        from kiro_crew.apps.scrub_sdk import ScrubSDK

        self._data_dir = data_dir
        self.sdk_level = sdk_level
        self.scrub = seams.pop("scrub", ScrubSDK())
        self.audit = seams.pop("audit", AuditSDK(APP_NAME))
        self.http_app = seams.pop("http_app", None)
        self.health = seams.pop("health", FakeHealth())
        self.logger = seams.pop("logger", None)
        owner_gate = seams.pop("require_owner", _host_owner_gate)
        if owner_gate is not None:
            self.require_owner = owner_gate
        for key, value in seams.items():
            setattr(self, key, value)

    @property
    def data_dir(self) -> Path:
        if self._data_dir is not None:
            return self._data_dir
        from kiro_crew.config.paths import data_home

        return data_home() / "apps" / APP_NAME / "data"

    @data_dir.setter
    def data_dir(self, value: Path) -> None:
        self._data_dir = value


async def _host_owner_gate(request: Any, operation: str) -> Any | None:
    """``AppContext.require_owner``: the host's gate, audited as ``issue-radar.<op>``."""
    from kiro_crew.apps.context import AppContext

    probe = AppContext(name=APP_NAME, data_dir=Path("."))
    return await probe.require_owner(request, operation)


def make_ctx(home: Path | None = None, **overrides: Any) -> FakeCtx:
    """A level-1 context. *home* is accepted for symmetry and ignored: ``data_dir``
    follows ``KIROCREW_HOME`` unless an override pins it."""
    return FakeCtx(**overrides)


def register(ctx: Any | None = None) -> list[Any]:
    """``register_routes(ctx)`` the way the registry calls it."""
    from backend import _host, app_hooks

    if ctx is None:
        ctx = _host.bound()
    return app_hooks.register_routes(ctx)


def mount(app: web.Application, ctx: Any = None, *, lifecycle: bool = False) -> Any:
    """Register the app's routes on *app*, as the gateway's catch-all would serve them.

    Returns the context, whose ``http_app`` is *app*. With *lifecycle*, the
    ``on_startup`` / ``on_shutdown`` hooks run on *app*'s own signals.
    """
    from backend import _host, app_hooks

    if ctx is None:
        ctx = _host.bound()
    ctx.http_app = app
    for route in app_hooks.register_routes(ctx):

        async def _dispatch(request: web.Request, _route: Any = route) -> web.StreamResponse:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)

    if lifecycle:

        async def _start(_app: web.Application) -> None:
            await app_hooks.on_startup(ctx)

        async def _stop(_app: web.Application) -> None:
            await app_hooks.on_shutdown(ctx)

        app.on_startup.append(_start)
        app.on_cleanup.append(_stop)
    return ctx
