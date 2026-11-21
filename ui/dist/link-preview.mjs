// src/linkPreview/refCard.ts
/** The same ceiling the backend puts on a number it will look up. */
var MAX_NUMBER = 1e9;
var GITHUB_KIND = {
	issues: "issue",
	pull: "pull",
	pulls: "pull"
};
var GITLAB_KIND = {
	issues: "issue",
	merge_requests: "pull"
};
function refNumber(segment) {
	if (!segment || !/^\d{1,10}$/.test(segment)) return null;
	const n = Number(segment);
	return n >= 1 && n <= MAX_NUMBER ? n : null;
}
/**
* The reference a hovered URL names, or null for any other URL on the claimed
* hosts (a repo page, a file, a discussion, a user). Hosts match exactly:
* `www.github.com` folds onto `github.com` as the page's own parser does, and
* nothing else is folded, so a lookalike (`github.com.example.test`) never
* parses. Query and fragment are ignored: they address the same item.
*/
function parseForgeUrl(href) {
	let url;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
	const host = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (host === "github.com" || host === "www.github.com") {
		if (segments.length !== 4) return null;
		const kind = GITHUB_KIND[segments[2]];
		const number = refNumber(segments[3]);
		if (!kind || number === null) return null;
		return {
			provider: "github",
			host: "github.com",
			owner: segments[0],
			repo: segments[1],
			number,
			kind
		};
	}
	if (host === "gitlab.com") {
		const dash = segments.indexOf("-");
		if (dash < 2 || segments.length !== dash + 3) return null;
		const kind = GITLAB_KIND[segments[dash + 1]];
		const number = refNumber(segments[dash + 2]);
		if (!kind || number === null) return null;
		return {
			provider: "gitlab",
			host,
			owner: segments.slice(0, dash - 1).join("/"),
			repo: segments[dash - 1],
			number,
			kind
		};
	}
	return null;
}
/** The reference as a human writes it: `owner/repo#12`, `group/project!7`. */
function refLabel(ref) {
	const sigil = ref.provider === "gitlab" && ref.kind === "pull" ? "!" : "#";
	return `${ref.owner}/${ref.repo}${sigil}${ref.number}`;
}
/** `/ref`'s query for a reference. `provider` and `host` ride along so a GitLab
*  reference is looked up on GitLab; the route defaults both to GitHub. */
function refQuery(ref) {
	return `ref?${new URLSearchParams({
		owner: ref.owner,
		repo: ref.repo,
		number: String(ref.number),
		provider: ref.provider,
		host: ref.host
	}).toString()}`;
}
/** One cache key per item, so the same reference hovered twice costs one read. */
function refKey(ref) {
	return `${ref.provider}:${ref.host}:${ref.owner}/${ref.repo}#${ref.number}`;
}
/** The repo half of the key: `/ref` refuses a whole repo, not one number. */
function repoKey(ref) {
	return `${ref.provider}:${ref.host}:${ref.owner}/${ref.repo}`;
}
/** Lifecycle of a referenced item, mirroring the page's `RefLink` card: a change
*  request splits merged / closed-unmerged / draft, an issue splits completed /
*  not planned. */
function lifecycle(s) {
	if (s.is_pr) {
		if (s.merged_at) return "merged";
		if (s.state === "closed") return "closed";
		if (s.draft) return "draft";
		return "open";
	}
	if (s.state === "closed") return s.state_reason === "not_planned" ? "not_planned" : "closed";
	return "open";
}
/** The shape of a `/ref` answer this module accepts; anything else is a failed read. */
function readSummary(body) {
	if (!body || typeof body !== "object") return null;
	const s = body.summary;
	if (!s || typeof s !== "object") return null;
	const r = s;
	if (typeof r.title !== "string" || typeof r.state !== "string") return null;
	return {
		number: typeof r.number === "number" ? r.number : 0,
		title: r.title,
		state: r.state,
		state_reason: typeof r.state_reason === "string" ? r.state_reason : null,
		author: typeof r.author === "string" ? r.author : null,
		created_at: typeof r.created_at === "string" ? r.created_at : "",
		updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
		comments: typeof r.comments === "number" ? r.comments : 0,
		is_pr: r.is_pr === true,
		draft: r.draft === true,
		merged_at: typeof r.merged_at === "string" ? r.merged_at : null,
		labels: Array.isArray(r.labels) ? r.labels.filter((l) => !!l && typeof l === "object" && typeof l.name === "string").map((l) => ({
			name: l.name,
			color: typeof l.color === "string" ? l.color : ""
		})) : []
	};
}
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
/**
* `3 days ago`, or the date past a month. The frame is told no locale (the
* dashboard sends it only the URL, the rect and the theme), so this is the one
* place the card formats a date, in English, with the browser's own date form as
* the fallback.
*/
function relativeTime(iso, now = Date.now()) {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const diff = now - then;
	if (diff < MINUTE) return "just now";
	if (diff < HOUR) {
		const m = Math.floor(diff / MINUTE);
		return `${m} minute${m === 1 ? "" : "s"} ago`;
	}
	if (diff < DAY) {
		const h = Math.floor(diff / HOUR);
		return `${h} hour${h === 1 ? "" : "s"} ago`;
	}
	if (diff < 30 * DAY) {
		const d = Math.floor(diff / DAY);
		return `${d} day${d === 1 ? "" : "s"} ago`;
	}
	return new Date(then).toLocaleDateString(void 0, {
		year: "numeric",
		month: "short",
		day: "numeric"
	});
}
// src/linkPreview/main.ts
/** The card's width, the page's `RefLink` card width. */
var CARD_WIDTH = 340;
/** How long a pointer that left the link may take to cross into the card. */
var LEAVE_GRACE_MS = 200;
/** How long a summary is reused across hovers; the server keeps its own, shorter TTL. */
var SUMMARY_TTL_MS = 3e5;
/** How long a repo `/ref` refused stays address-only, so one unconnected repo is
*  not asked about on every hover. */
var REFUSED_TTL_MS = 6e5;
/** How long any other failed read is remembered. */
var FAILED_TTL_MS = 6e4;
/** How many `/ref` reads may be in flight at once. Each is a provider call under
*  the owner's credential, so a sweep across many references in one message is
*  bounded here as well as by the host's hover delay; a hover past the cap shows
*  the address alone and asks again next time. */
var MAX_INFLIGHT = 4;
/** Labels shown before the rest fold into a count. */
var LABELS_SHOWN = 4;
var LIFECYCLE_WORDS = {
	merged: "Merged",
	closed: "Closed",
	draft: "Draft",
	open: "Open",
	not_planned: "Closed as not planned"
};
/** Lucide's glyphs for the lifecycle row, as path data: the frame has no icon
*  module. `tint` names a CSS variable of the card's own palette. */
var LIFECYCLE_GLYPH = {
	merged: {
		tint: "aim",
		parts: [
			["circle", {
				cx: "18",
				cy: "18",
				r: "3"
			}],
			["circle", {
				cx: "6",
				cy: "6",
				r: "3"
			}],
			["path", { d: "M6 21V9a9 9 0 0 0 9 9" }]
		]
	},
	open: {
		tint: "ok",
		parts: [["circle", {
			cx: "12",
			cy: "12",
			r: "10"
		}], ["circle", {
			cx: "12",
			cy: "12",
			r: "1"
		}]]
	},
	closed: {
		tint: "muted",
		parts: [["circle", {
			cx: "12",
			cy: "12",
			r: "10"
		}], ["line", {
			x1: "9",
			x2: "15",
			y1: "15",
			y2: "9"
		}]]
	},
	not_planned: {
		tint: "muted",
		parts: [["circle", {
			cx: "12",
			cy: "12",
			r: "10"
		}], ["line", {
			x1: "9",
			x2: "15",
			y1: "15",
			y2: "9"
		}]]
	},
	draft: {
		tint: "muted",
		parts: [
			["circle", {
				cx: "18",
				cy: "18",
				r: "3"
			}],
			["circle", {
				cx: "6",
				cy: "6",
				r: "3"
			}],
			["path", { d: "M18 6V5" }],
			["path", { d: "M18 11v-1" }],
			["line", {
				x1: "6",
				x2: "6",
				y1: "9",
				y2: "21"
			}]
		]
	}
};
var OPEN_PR_GLYPH = [
	["circle", {
		cx: "18",
		cy: "18",
		r: "3"
	}],
	["circle", {
		cx: "6",
		cy: "6",
		r: "3"
	}],
	["path", { d: "M13 6h3a2 2 0 0 1 2 2v7" }],
	["line", {
		x1: "6",
		x2: "6",
		y1: "9",
		y2: "21"
	}]
];
var CHECK_GLYPH = [["circle", {
	cx: "12",
	cy: "12",
	r: "10"
}], ["path", { d: "m9 12 2 2 4-4" }]];
var COMMENT_GLYPH = [["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }]];
var STYLE = `
.rc, .rc * { box-sizing: border-box; }
.rc {
  --bg: #ffffff; --fg: #1f2328; --strong: #0b0f14; --muted: #6b7280; --border: #d0d7de;
  --ok: #1a7f37; --aim: #8250df; --code: #f3f4f6; --shimmer: rgba(107,114,128,.18); --sweep: rgba(130,80,223,.18);
  width: 340px; max-width: 100vw; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg);
  font: 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow: hidden;
}
.rc[data-theme="dark"] {
  --bg: #171b22; --fg: #d1d7e0; --strong: #f0f3f6; --muted: #8b949e; --border: #30363d;
  --ok: #3fb950; --aim: #a371f7; --code: #0f1217; --shimmer: rgba(139,148,158,.18); --sweep: rgba(163,113,247,.22);
}
.rc-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-weight: 600; color: var(--strong); }
.rc-head .rc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-body { padding: 8px 10px; }
.rc-body:empty { display: none; }
.rc-row { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.rc-row svg, .rc-meta svg { width: 14px; height: 14px; flex: none; }
.rc-tint-ok { color: var(--ok); } .rc-tint-aim { color: var(--aim); } .rc-tint-muted { color: var(--muted); }
.rc-item-title { margin-top: 4px; font-weight: 500; line-height: 1.35; color: var(--strong); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rc-by { margin-top: 6px; color: var(--muted); } .rc-by b { font-weight: 500; color: var(--fg); }
.rc-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.rc-label { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; font-size: 11px; line-height: 16px; color: var(--muted); }
.rc-label i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.rc-meta { display: flex; gap: 12px; margin-top: 6px; color: var(--muted); }
.rc-meta span { display: inline-flex; align-items: center; gap: 4px; }
.rc-foot { padding: 6px 10px; border-top: 1px solid var(--border); font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); overflow-wrap: anywhere; }
.rc-shimmer { height: 12px; border-radius: 4px; background: var(--shimmer); position: relative; overflow: hidden; margin: 4px 0; }
.rc-shimmer::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--sweep), transparent); background-size: 200% 100%; animation: rc-sweep 1.4s linear infinite; }
@keyframes rc-sweep { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .rc-shimmer::after { animation: none; } }
`;
function el(tag, cls, text) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== void 0) node.textContent = text;
	return node;
}
function glyph(parts, cls) {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", cls);
	for (const [name, attrs] of parts) {
		const part = document.createElementNS(NS, name);
		for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
		svg.appendChild(part);
	}
	return svg;
}
/** The lifecycle row's glyph: the open change request has its own, and a closed
*  issue that was completed shows the check. */
function lifecycleGlyph(life, s) {
	const { tint, parts } = LIFECYCLE_GLYPH[life];
	if (s.is_pr && life === "open") return glyph(OPEN_PR_GLYPH, `rc-tint-${tint}`);
	if (!s.is_pr && life === "closed") return glyph(CHECK_GLYPH, "rc-tint-aim");
	return glyph(parts, `rc-tint-${tint}`);
}
/** The summary body, the page's `RefLink` card body in plain DOM. */
function summaryBody(s) {
	const life = lifecycle(s);
	const row = el("div", "rc-row");
	row.appendChild(lifecycleGlyph(life, s));
	const word = el("span", `rc-tint-${LIFECYCLE_GLYPH[life].tint}`, LIFECYCLE_WORDS[life]);
	if (!s.is_pr && life === "closed") word.className = "rc-tint-aim";
	row.appendChild(word);
	row.appendChild(el("span", void 0, s.is_pr ? "Pull request" : "Issue"));
	const out = [row, el("div", "rc-item-title", s.title)];
	const by = el("div", "rc-by");
	if (s.author) {
		by.appendChild(el("b", void 0, s.author));
		by.appendChild(document.createTextNode(" · "));
	}
	by.appendChild(document.createTextNode(`opened ${relativeTime(s.created_at)}`));
	out.push(by);
	if (s.labels.length) {
		const labels = el("div", "rc-labels");
		for (const l of s.labels.slice(0, LABELS_SHOWN)) {
			const chip = el("span", "rc-label");
			const dot = el("i");
			if (/^[0-9a-f]{6}$/i.test(l.color)) dot.style.background = `#${l.color}`;
			chip.appendChild(dot);
			chip.appendChild(document.createTextNode(l.name));
			labels.appendChild(chip);
		}
		const more = s.labels.length - LABELS_SHOWN;
		if (more > 0) labels.appendChild(el("span", "rc-label", `+${more}`));
		out.push(labels);
	}
	const meta = el("div", "rc-meta");
	const comments = el("span");
	comments.appendChild(glyph(COMMENT_GLYPH, ""));
	comments.appendChild(document.createTextNode(String(s.comments)));
	comments.setAttribute("aria-label", `${s.comments} comments`);
	meta.appendChild(comments);
	if (s.updated_at) meta.appendChild(el("span", void 0, `updated ${relativeTime(s.updated_at)}`));
	out.push(meta);
	return out;
}
function shimmerBody() {
	return [
		"42%",
		"88%",
		"56%"
	].map((w) => {
		const bar = el("div", "rc-shimmer");
		bar.style.width = w;
		return bar;
	});
}
/** One card: the DOM it owns and the show it is answering. */
var RefCard = class {
	ctx;
	now;
	root = el("div", "rc");
	head = el("div", "rc-head");
	title = el("span", "rc-title");
	body = el("div", "rc-body");
	foot = el("div", "rc-foot");
	current = null;
	seq = 0;
	closeTimer;
	overCard = false;
	cache = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	constructor(ctx, now = Date.now) {
		this.ctx = ctx;
		this.now = now;
		const style = el("style");
		style.textContent = STYLE;
		this.root.appendChild(style);
		this.head.appendChild(this.title);
		this.root.appendChild(this.head);
		this.root.appendChild(this.body);
		this.root.appendChild(this.foot);
		this.root.dataset.theme = ctx.theme();
		this.root.addEventListener("mouseenter", () => {
			this.overCard = true;
			this.cancelClose();
		});
		this.root.addEventListener("mouseleave", () => {
			this.overCard = false;
			this.close();
		});
	}
	setTheme(theme) {
		this.root.dataset.theme = theme;
	}
	show(link) {
		this.cancelClose();
		const seq = ++this.seq;
		this.current = {
			card: link.card,
			seq
		};
		this.root.dataset.theme = link.theme;
		const url = link.url;
		if (!url) {
			link.card.close();
			this.current = null;
			return;
		}
		const ref = parseForgeUrl(url);
		this.foot.textContent = url;
		this.body.replaceChildren();
		if (!ref) {
			this.title.textContent = hostOf(url);
			this.publish(link.card);
			return;
		}
		this.title.textContent = refLabel(ref);
		const cached = this.fresh(refKey(ref)) ?? this.fresh(repoKey(ref));
		if (cached) {
			this.fill(cached);
			this.publish(link.card);
			return;
		}
		this.body.replaceChildren(...shimmerBody());
		this.publish(link.card);
		this.load(ref).then((result) => {
			if (this.current?.seq !== seq) return;
			this.fill(result);
			this.publish(link.card);
		});
	}
	leave() {
		if (this.overCard) return;
		this.cancelClose();
		this.closeTimer = setTimeout(() => this.close(), 200);
	}
	hide() {
		this.cancelClose();
		this.close();
	}
	close() {
		this.cancelClose();
		const cur = this.current;
		this.current = null;
		cur?.card.close();
	}
	cancelClose() {
		if (this.closeTimer !== void 0) {
			clearTimeout(this.closeTimer);
			this.closeTimer = void 0;
		}
	}
	/** Report the card's size and open it; after the body changes, report again. */
	publish(card) {
		card.resize({
			width: 340,
			height: this.root.offsetHeight || this.root.getBoundingClientRect().height
		});
		card.open();
	}
	fill(result) {
		this.body.replaceChildren(...result.kind === "summary" ? summaryBody(result.summary) : []);
	}
	fresh(key) {
		const hit = this.cache.get(key);
		if (!hit) return null;
		if (hit.until <= this.now()) {
			this.cache.delete(key);
			return null;
		}
		return hit;
	}
	/** One request per item, shared by concurrent hovers of the same reference,
	*  and at most `MAX_INFLIGHT` items at once. */
	load(ref) {
		const key = refKey(ref);
		let p = this.inflight.get(key);
		if (!p) {
			if (this.inflight.size >= 4) return Promise.resolve({
				kind: "failed",
				until: this.now()
			});
			p = this.fetchSummary(ref).finally(() => this.inflight.delete(key));
			this.inflight.set(key, p);
		}
		return p;
	}
	async fetchSummary(ref) {
		const now = this.now();
		try {
			const res = await this.ctx.fetch(refQuery(ref));
			if (res.status === 404) {
				const refused = {
					kind: "failed",
					until: now + REFUSED_TTL_MS
				};
				this.cache.set(repoKey(ref), refused);
				return refused;
			}
			if (!res.ok) throw new Error(`ref ${res.status}`);
			const summary = readSummary(await res.json());
			if (!summary) throw new Error("ref: unexpected body");
			const hit = {
				kind: "summary",
				summary,
				until: now + SUMMARY_TTL_MS
			};
			this.cache.set(refKey(ref), hit);
			return hit;
		} catch {
			const failed = {
				kind: "failed",
				until: now + FAILED_TTL_MS
			};
			this.cache.set(refKey(ref), failed);
			return failed;
		}
	}
};
function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
/** The frame's entry: called once by the dashboard's link-preview bootstrap. */
function activate(ctx) {
	const card = new RefCard(ctx);
	document.body.appendChild(card.root);
	return {
		show: (link) => card.show(link),
		leave: () => card.leave(),
		hide: () => card.hide(),
		theme: (theme) => card.setTheme(theme),
		dispose: () => card.root.remove()
	};
}
globalThis.kirocrew?.register?.(activate);
export { CARD_WIDTH, FAILED_TTL_MS, LEAVE_GRACE_MS, MAX_INFLIGHT, REFUSED_TTL_MS, SUMMARY_TTL_MS, activate, summaryBody };
