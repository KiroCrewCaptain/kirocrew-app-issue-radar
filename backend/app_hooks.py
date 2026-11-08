"""The three ``backend.hooks`` entries: ``routes``, ``on_startup``, ``on_shutdown``.

The gateway executes this file once per hook entry, so it holds no state of its
own; everything the three share lives in the sibling modules (``routes``,
``watch``, ``_host``), which are imported once.
"""

from __future__ import annotations

import logging
from typing import Any

from . import _host, agent_tools, routes

logger = logging.getLogger("kirocrew.app.issue-radar")


def register_routes(ctx: Any) -> list[_host.Route]:
    """``hooks.routes``: the route records (see :func:`routes.register_routes`), and the
    ``agentTools`` route the manifest declares (:mod:`agent_tools`)."""
    return [*routes.register_routes(ctx), agent_tools.agent_tool_route()]


async def on_startup(ctx: Any) -> None:
    """Start the background watcher on the gateway's application.

    The watcher reads the dashboard state (``ctx.http_app["state"]``, the object
    every route handler already reaches as ``request.app``) to drive crews and
    to push notifications. ``ctx.http_app`` is granted because the manifest
    declares routes; without it nothing is watched, and health says so.
    """
    _host.bind(ctx)
    app = getattr(ctx, "http_app", None)
    if app is None:
        health = getattr(ctx, "health", None)
        mark = getattr(health, "mark_degraded", None)
        if callable(mark):
            mark("no gateway application on the context: the watcher and crews are off")
        logger.warning("issue-radar: ctx.http_app is missing; the watcher is not started")
        return
    for callback in routes._lifecycle["startup"]:
        try:
            await callback(app)
        except Exception:  # noqa: BLE001 - one callback must not stop the others
            logger.warning("issue-radar: startup callback %r failed", callback, exc_info=True)


async def on_shutdown(ctx: Any) -> None:
    """Stop the watcher and cancel in-flight refreshes (disable, reload or exit)."""
    app = getattr(ctx, "http_app", None)
    for callback in routes._lifecycle["cleanup"]:
        try:
            await callback(app)
        except Exception:  # noqa: BLE001 - one callback must not stop the others
            logger.warning("issue-radar: shutdown callback %r failed", callback, exc_info=True)
