"""Every bad-body 400 of the Issue Radar routes carries a code.

A body that does not parse answers ``invalid_json`` and one that parses to
something other than an object answers ``body_not_object``, the codes the host's
shared body reader gives, so a client can tell the two apart without reading the
message. The message itself is unchanged. Kiro Crew kirodotdev/KiroCrew#32503.

Each handler is driven as the dashboard owner, so the request reaches the body
parse rather than the owner gate. Nothing here runs a provider CLI or a model.
"""

from __future__ import annotations

import pytest
from dashboard_owner_helpers import NoConfiguredOwner
from issue_radar_routes_ai_coverage_helpers import _body, _json_request

from backend import routes

#: (handler name on ``routes``, method, path) for every route that parses its
#: own body and answers a bad one itself.
_ROUTES = [
    ("_handle_connect", "POST", "connect"),
    ("_handle_put_settings", "PUT", "settings"),
    ("_handle_add_settings_label", "POST", "settings/role"),
    ("_handle_labels_apply", "POST", "labels/apply"),
    ("_handle_issue_state", "POST", "issue/state"),
    ("_handle_generate_recommendations", "POST", "recommendations"),
    ("_handle_create_label", "POST", "labels/create"),
    ("_handle_generate_tagging", "POST", "tagging"),
    ("_handle_labels_apply_bulk", "POST", "labels/apply-bulk"),
    ("_handle_put_investigation", "PUT", "investigation"),
]

_IDS = [name for name, _method, _path in _ROUTES]

#: ``_json_request`` makes ``request.json()`` raise for ``None``: a body that
#: does not parse.
_MALFORMED = None

_NON_OBJECTS = [[1, 2], [], "text", 7]


async def _call(name: str, method: str, path: str, body: object):
    request = _json_request(method, path, body, state=NoConfiguredOwner())
    return await getattr(routes, name)(request)


@pytest.mark.asyncio
@pytest.mark.parametrize("name,method,path", _ROUTES, ids=_IDS)
async def test_a_malformed_body_is_a_coded_400(name: str, method: str, path: str) -> None:
    response = await _call(name, method, path, _MALFORMED)
    assert response.status == 400
    payload = _body(response)
    assert payload["code"] == "invalid_json"
    assert payload["error"] == "request body must be JSON"


@pytest.mark.asyncio
@pytest.mark.parametrize("name,method,path", _ROUTES, ids=_IDS)
@pytest.mark.parametrize("body", _NON_OBJECTS, ids=repr)
async def test_a_non_object_body_is_a_coded_400(
    name: str, method: str, path: str, body: object
) -> None:
    response = await _call(name, method, path, body)
    assert response.status == 400
    payload = _body(response)
    assert payload["code"] == "body_not_object"
    assert payload["error"] == "request body must be a JSON object"
