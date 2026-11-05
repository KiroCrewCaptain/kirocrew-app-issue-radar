#!/usr/bin/env python3
"""Writes `repo.json`: the fictional repository the capture's fake `gh` serves.

Every name, login and body here is made up for the README. Avatars are empty, so
no real account's picture can appear. Run it after editing the data below.
"""
import json
from pathlib import Path

OWNER, REPO = "example-outfitters", "trail-planner"
FULL = f"{OWNER}/{REPO}"
WEB = f"https://github.com/{FULL}"
VIEWER = "maya-example"

LABELS = [
    ("bug", "d73a4a", "Something is not working"),
    ("enhancement", "a2eeef", "New feature or request"),
    ("good first issue", "7057ff", "Good for newcomers"),
    ("help wanted", "008672", "Extra attention is needed"),
    ("documentation", "0075ca", "Improvements or additions to documentation"),
    ("performance", "fbca04", "Speed, memory or battery"),
    ("offline", "bfd4f2", "Works without a connection"),
    ("i18n", "c5def5", "Translations and locale formats"),
    ("ui", "e99695", "Look and feel"),
]


def user(login):
    return {"login": login, "id": sum(map(ord, login)) * 97, "avatar_url": "", "html_url": f"https://github.com/{login}", "type": "User"}


def label(name):
    for n, c, d in LABELS:
        if n == name:
            return {"name": n, "color": c, "description": d}
    raise KeyError(name)


ISSUES = [
    (142, "Elevation profile is flat for routes that cross the antimeridian", ["bug"], "jun-example", "MEMBER", 3, "2026-11-03T16:20:00Z", "2026-11-01T09:12:00Z",
     "Planning the Kamchatka coast route (it crosses 180° longitude twice), the elevation chart shows a flat line at 0 m for every day after the first crossing.\n\n**Steps**\n1. Import `kamchatka-coast.gpx` (attached)\n2. Open the Elevation tab\n\n**Expected** the real profile.\n**Actual** a flat line after day 2.\n\nI suspect the segment splitter: longitudes jump from 179.9 to -179.9 and the distance comes out as almost the whole planet.", ["ada-example"]),
    (141, "Export a planned route as GPX", ["enhancement"], "priya-example", "CONTRIBUTOR", 5, "2026-11-03T11:02:00Z", "2026-10-30T14:40:00Z",
     "Most watches and phone apps read GPX. Right now the only way out of the planner is a screenshot.\n\nA first version could export the track and the campsites as waypoints. Elevation can come later.", []),
    (139, "Offline map tiles are downloaded again on every start", [], "leo-example", "NONE", 2, "2026-11-02T19:45:00Z", "2026-11-02T08:30:00Z",
     "With the region `Sierra High Route` saved for offline use, the app still fetches every tile again when I open it with a connection. On a metered plan that is 180 MB each time.\n\nThe cache folder is there and full, so it looks like the cache key changes between runs.", []),
    (137, "Water source markers sit on top of the trail line at high zoom", ["ui"], "sam-example", "NONE", 1, "2026-11-01T21:10:00Z", "2026-10-31T17:05:00Z",
     "At zoom 15 and above the blue water-drop markers cover the trail, so you can't see which side of the stream the path is on.", []),
    (135, "Translate the packing checklist into Spanish", ["i18n", "help wanted"], "maya-example", "OWNER", 4, "2026-10-31T10:00:00Z", "2026-10-25T09:00:00Z",
     "The checklist is the most-used screen with no translation yet. Strings live in `locales/en/checklist.json`.", []),
    (133, "Crash when importing a route with an empty name", ["bug"], "noor-example", "NONE", 2, "2026-10-30T13:22:00Z", "2026-10-29T08:51:00Z",
     "Importing a GPX file whose `<name>` element is empty closes the app. Renaming the track in the file first works around it.", []),
    (130, "Docs: explain how the daily distance estimate is calculated", ["documentation", "good first issue"], "ada-example", "MEMBER", 0, "2026-10-28T15:35:00Z", "2026-10-27T12:00:00Z",
     "People keep asking why a 14 km day is shown as 6 hours. The estimate uses Naismith's rule plus a pack-weight factor; we should say so on the Plan screen's help page.", []),
    (128, "Campsite icons are hard to read in dark mode", [], "kai-example", "NONE", 1, "2026-10-27T18:40:00Z", "2026-10-26T20:15:00Z",
     "The tent icon is dark grey on the dark map style. A light outline would fix it.", []),
]


def issue_obj(n, title, labels, author, assoc, comments, updated, created, body, assignees):
    return {
        "number": n, "title": title, "html_url": f"{WEB}/issues/{n}", "state": "open", "state_reason": None,
        "labels": [label(x) for x in labels], "comments": comments, "user": user(author), "author_association": assoc,
        "assignees": [user(a) for a in assignees], "assignee": user(assignees[0]) if assignees else None,
        "created_at": created, "updated_at": updated, "closed_at": None, "body": body, "locked": False,
        "milestone": None, "reactions": {"total_count": 2 if n in (141, 139) else 0, "+1": 2 if n in (141, 139) else 0},
        "pull_request": None, "id": 900000 + n, "node_id": f"I_kwFake{n}",
    }


PULLS = [
    (143, "Split route segments at the antimeridian before computing elevation", "ada-example", "MEMBER", False, "2026-11-03T18:05:00Z", "2026-11-03T09:40:00Z", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "fix/antimeridian-elevation", ["bug"],
     "Fixes #142.\n\nLongitudes are unwrapped before the haversine distance is taken, so a crossing no longer reads as a 40,000 km segment. Adds a test with the Kamchatka coast route."),
    (140, "Key the offline tile cache by tile hash, not by download time", "leo-example", "CONTRIBUTOR", True, "2026-11-02T20:10:00Z", "2026-11-02T19:50:00Z", "b2c3d4e5f60718293a4b5c6d7e8f901234567891", "offline-cache-key", ["performance"],
     "Draft for #139. The cache key included the request timestamp, so every start missed. Still needs a migration for caches already on disk."),
    (138, "Spanish packing checklist", "priya-example", "CONTRIBUTOR", False, "2026-10-31T12:30:00Z", "2026-10-30T10:00:00Z", "c3d4e5f60718293a4b5c6d7e8f9012345678912a", "i18n/es-checklist", ["i18n"],
     "Adds `locales/es/checklist.json` for #135. A native speaker reviewed the camping terms."),
]


def pull_obj(n, title, author, assoc, draft, updated, created, sha, ref, labels, body):
    return {
        "number": n, "title": title, "html_url": f"{WEB}/pull/{n}", "state": "open", "draft": draft,
        "user": user(author), "author_association": assoc, "labels": [label(x) for x in labels],
        "created_at": created, "updated_at": updated, "closed_at": None, "merged_at": None, "body": body,
        "head": {"sha": sha, "ref": ref, "repo": {"full_name": FULL}}, "base": {"ref": "main", "sha": "0" * 40, "repo": {"full_name": FULL}},
        "requested_reviewers": [user(VIEWER)] if n == 143 else [], "assignees": [], "comments": 1, "review_comments": 0,
        "commits": 2, "additions": 84, "deletions": 9, "changed_files": 3, "mergeable": True, "mergeable_state": "clean",
        "id": 800000 + n, "node_id": f"PR_kwFake{n}", "auto_merge": None, "milestone": None,
    }


def timeline(n):
    if n == 142:
        return [
            {"event": "labeled", "actor": user("ada-example"), "created_at": "2026-11-01T10:00:00Z", "label": label("bug")},
            {"event": "commented", "actor": user("ada-example"), "user": user("ada-example"), "created_at": "2026-11-01T10:05:00Z", "body": "Reproduced with the attached file. The day 3 segment comes out at 39,800 km.", "author_association": "MEMBER", "html_url": f"{WEB}/issues/142#c1", "id": 1},
            {"event": "assigned", "actor": user("ada-example"), "assignee": user("ada-example"), "created_at": "2026-11-01T10:06:00Z"},
            {"event": "commented", "actor": user("jun-example"), "user": user("jun-example"), "created_at": "2026-11-02T08:40:00Z", "body": "Same thing on the Fiji island-hopping route.", "author_association": "MEMBER", "html_url": f"{WEB}/issues/142#c2", "id": 2},
            {"event": "cross-referenced", "actor": user("ada-example"), "created_at": "2026-11-03T09:41:00Z", "source": {"issue": {"number": 143, "title": PULLS[0][1], "html_url": f"{WEB}/pull/143", "state": "open", "pull_request": {"url": "x"}, "repository": {"full_name": FULL}}}},
            {"event": "commented", "actor": user("maya-example"), "user": user("maya-example"), "created_at": "2026-11-03T16:20:00Z", "body": "Thanks both. #143 looks like the fix.", "author_association": "OWNER", "html_url": f"{WEB}/issues/142#c3", "id": 3},
        ]
    if n == 139:
        return [
            {"event": "commented", "actor": user("leo-example"), "user": user("leo-example"), "created_at": "2026-11-02T09:10:00Z", "body": "The cache folder name has the date in it. That would explain it.", "author_association": "NONE", "html_url": f"{WEB}/issues/139#c1", "id": 11},
            {"event": "commented", "actor": user("maya-example"), "user": user("maya-example"), "created_at": "2026-11-02T19:45:00Z", "body": "Good catch. A PR is welcome.", "author_association": "OWNER", "html_url": f"{WEB}/issues/139#c2", "id": 12},
        ]
    return []


routes = {
    f"repos/{FULL}": {"full_name": FULL, "private": False, "open_issues_count": len(ISSUES) + len(PULLS), "description": "Plan multi-day hikes: routes, water, campsites and daily distances.", "permissions": {"admin": True, "maintain": True, "push": True, "triage": True, "pull": True}, "default_branch": "main", "html_url": WEB, "owner": user(OWNER), "name": REPO},
    "user": user(VIEWER),
    f"repos/{FULL}/labels": [label(n) for n, _, _ in LABELS],
    f"repos/{FULL}/collaborators": [user(VIEWER), user("ada-example"), user("jun-example")],
    f"repos/{FULL}/assignees": [user(VIEWER), user("ada-example"), user("jun-example")],
    f"repos/{FULL}/contributors": [user(VIEWER), user("ada-example"), user("jun-example"), user("priya-example"), user("leo-example")],
    f"repos/{FULL}/issues": {"_by_query": {"state=closed": []}, "_default": [issue_obj(*i) for i in ISSUES]},
    f"repos/{FULL}/pulls": {"_by_query": {"state=closed": []}, "_default": [pull_obj(*p) for p in PULLS]},
    "search/issues": {"total_count": len(ISSUES), "incomplete_results": False, "items": [issue_obj(*ISSUES[0])]},
}
for i in ISSUES:
    routes[f"repos/{FULL}/issues/{i[0]}"] = issue_obj(*i)
    routes[f"repos/{FULL}/issues/{i[0]}/timeline"] = timeline(i[0])
    routes[f"repos/{FULL}/issues/{i[0]}/dependencies/blocked_by"] = []
    routes[f"repos/{FULL}/issues/{i[0]}/dependencies/blocking"] = []
for p in PULLS:
    routes[f"repos/{FULL}/pulls/{p[0]}"] = pull_obj(*p)
    routes[f"repos/{FULL}/issues/{p[0]}"] = {**pull_obj(*p), "pull_request": {"url": "x", "html_url": f"{WEB}/pull/{p[0]}"}}
    routes[f"repos/{FULL}/issues/{p[0]}/timeline"] = [
        {"event": "commented", "actor": user("jun-example"), "user": user("jun-example"), "created_at": p[5], "body": "Tried it on my routes; looks right.", "author_association": "MEMBER", "html_url": f"{WEB}/pull/{p[0]}#c1", "id": 100 + p[0]},
    ]
    routes[f"repos/{FULL}/pulls/{p[0]}/comments"] = []
    routes[f"repos/{FULL}/pulls/{p[0]}/reviews"] = []
    routes[f"repos/{FULL}/pulls/{p[0]}/files"] = []
    sha = p[7]
    ok = p[0] != 140
    routes[f"repos/{FULL}/commits/{sha}/check-runs"] = {"total_count": 2, "check_runs": [
        {"name": "test (ubuntu)", "status": "completed", "conclusion": "success" if ok else None, "html_url": f"{WEB}/actions/runs/{p[0]}1", "app": {"name": "GitHub Actions", "slug": "github-actions"}, "started_at": p[5], "completed_at": p[5], "details_url": f"{WEB}/actions/runs/{p[0]}1", "check_suite": {"app": {"slug": "github-actions"}}},
        {"name": "lint", "status": "completed" if ok else "in_progress", "conclusion": "success" if ok else None, "html_url": f"{WEB}/actions/runs/{p[0]}2", "app": {"name": "GitHub Actions", "slug": "github-actions"}, "started_at": p[5], "completed_at": p[5] if ok else None, "details_url": f"{WEB}/actions/runs/{p[0]}2", "check_suite": {"app": {"slug": "github-actions"}}},
    ]}
    routes[f"repos/{FULL}/commits/{sha}/status"] = {"state": "success", "statuses": []}
    routes[f"repos/{FULL}/actions/runs"] = {"total_count": 0, "workflow_runs": []}

out = {"owner": OWNER, "repo": REPO, "routes": routes, "graphql": {}}
Path(__file__).with_name("repo.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
print(f"{len(routes)} routes")
