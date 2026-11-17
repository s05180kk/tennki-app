// 気象予報士 一問一答 — 配信と学習記録の同期を行う Worker
//
// すべてのリクエストで Cloudflare Access の JWT を検証し、
// 通過したユーザーにだけ静的ファイル・問題データ・/api/stats を返す。
// Access の設定（KV の config:access）が無い場合は何も返さない（フェイルクローズ）。

interface Env {
	ASSETS: Fetcher;
	KV: KVNamespace;
	DEV_BYPASS_EMAIL?: string; // ローカル開発専用（.dev.vars でのみ設定）
}

type AccessConfig = { teamDomain: string; aud: string };

type Entry = { c: number; w: number; last?: number; t?: number };
type Store = { entries: Record<string, Entry>; resetAt: number };

const MAX_BODY = 1_000_000;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const email = await authenticate(request, env);
		if (!email) return text("このページを表示する権限がありません。", 403);

		const url = new URL(request.url);
		if (url.pathname === "/data.js") {
			const data = await env.KV.get("data:data.js", { type: "stream", cacheTtl: 3600 });
			if (!data) return text("問題データがまだアップロードされていません。", 404);
			return new Response(data, {
				headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex, nofollow" },
			});
		}
		if (url.pathname === "/api/stats") {
			try {
				if (request.method === "GET") return json(await loadStore(env, email));
				if (request.method === "PUT") return json(await mergeAndSave(request, env, email));
				return text("Method Not Allowed", 405);
			} catch (e) {
				return text(e instanceof HttpError ? e.message : "Internal Error", e instanceof HttpError ? e.status : 500);
			}
		}

		const res = await env.ASSETS.fetch(request);
		const out = new Response(res.body, res);
		out.headers.set("X-Robots-Tag", "noindex, nofollow");
		out.headers.set("Cache-Control", "private, no-cache");
		return out;
	},
} satisfies ExportedHandler<Env>;

// ---------- 学習記録 ----------

const keyOf = (email: string) => `stats:${email.toLowerCase()}`;

async function loadStore(env: Env, email: string): Promise<Store> {
	const s = await env.KV.get<Store>(keyOf(email), "json");
	return s && typeof s === "object" ? { entries: s.entries ?? {}, resetAt: s.resetAt ?? 0 } : { entries: {}, resetAt: 0 };
}

async function mergeAndSave(request: Request, env: Env, email: string): Promise<Store> {
	const raw = await request.text();
	if (raw.length > MAX_BODY) throw new HttpError(413, "Payload Too Large");
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw new HttpError(400, "Invalid JSON");
	}
	const incoming = sanitize(body);
	const cur = await loadStore(env, email);
	const resetAt = Math.max(cur.resetAt, incoming.resetAt);
	const entries: Record<string, Entry> = {};
	for (const src of [cur.entries, incoming.entries]) {
		for (const [k, v] of Object.entries(src)) {
			if ((v.t ?? 0) <= resetAt) continue;
			if (!entries[k] || (v.t ?? 0) > (entries[k].t ?? 0)) entries[k] = v;
		}
	}
	const merged = { entries, resetAt };
	await env.KV.put(keyOf(email), JSON.stringify(merged));
	return merged;
}

function sanitize(body: unknown): Store {
	if (!body || typeof body !== "object") throw new HttpError(400, "Invalid body");
	const b = body as { entries?: unknown; resetAt?: unknown };
	const entries: Record<string, Entry> = {};
	if (b.entries && typeof b.entries === "object") {
		for (const [k, v] of Object.entries(b.entries as Record<string, unknown>)) {
			if (k.length > 40 || !v || typeof v !== "object") continue;
			const e = v as Record<string, unknown>;
			const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
			entries[k] = { c: n(e.c), w: n(e.w), last: e.last === 1 ? 1 : 0, t: n(e.t) };
		}
	}
	const resetAt = typeof b.resetAt === "number" && Number.isFinite(b.resetAt) ? b.resetAt : 0;
	return { entries, resetAt };
}

// ---------- Cloudflare Access の JWT 検証 ----------

type Jwk = JsonWebKey & { kid: string };
let certCache: { at: number; domain: string; keys: Jwk[] } | null = null;

let configCache: { at: number; cfg: AccessConfig | null } | null = null;

async function accessConfig(env: Env): Promise<AccessConfig | null> {
	if (configCache && Date.now() - configCache.at < 60_000) return configCache.cfg;
	const c = await env.KV.get<AccessConfig>("config:access", "json");
	const cfg = c && typeof c.teamDomain === "string" && typeof c.aud === "string" && c.teamDomain && c.aud ? c : null;
	configCache = { at: Date.now(), cfg };
	return cfg;
}

async function authenticate(request: Request, env: Env): Promise<string | null> {
	const cfg = await accessConfig(env);
	if (!cfg) {
		// 本番では Access の設定値が必須。ローカル開発時のみバイパスを許可する。
		const host = new URL(request.url).hostname;
		if (env.DEV_BYPASS_EMAIL && (host === "localhost" || host === "127.0.0.1")) return env.DEV_BYPASS_EMAIL;
		return null;
	}
	const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? cookie(request, "CF_Authorization");
	if (!token) return null;
	try {
		const payload = await verifyJwt(token, cfg.teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, ""), cfg.aud);
		return typeof payload.email === "string" ? payload.email : null;
	} catch {
		return null;
	}
}

async function verifyJwt(token: string, domain: string, aud: string): Promise<Record<string, unknown>> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("malformed");
	const [h, p, s] = parts;
	const header = JSON.parse(b64urlText(h)) as { kid?: string; alg?: string };
	if (header.alg !== "RS256") throw new Error("alg");

	const keys = await getCerts(domain);
	const jwk = keys.find((k) => k.kid === header.kid);
	if (!jwk) throw new Error("kid");
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
	if (!ok) throw new Error("signature");

	const payload = JSON.parse(b64urlText(p)) as Record<string, unknown>;
	const now = Math.floor(Date.now() / 1000);
	const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!auds.includes(aud)) throw new Error("aud");
	if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("exp");
	if (typeof payload.nbf === "number" && payload.nbf > now + 60) throw new Error("nbf");
	if (payload.iss !== `https://${domain}`) throw new Error("iss");
	return payload;
}

async function getCerts(domain: string): Promise<Jwk[]> {
	if (certCache && certCache.domain === domain && Date.now() - certCache.at < 3600_000) return certCache.keys;
	const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error("certs");
	const { keys } = (await res.json()) as { keys: Jwk[] };
	certCache = { at: Date.now(), domain, keys };
	return keys;
}

// ---------- helpers ----------

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function b64urlBytes(s: string): Uint8Array {
	const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
	return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64urlText = (s: string) => new TextDecoder().decode(b64urlBytes(s));

function cookie(request: Request, name: string): string | null {
	const m = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
	return m ? decodeURIComponent(m[1]) : null;
}

const json = (data: unknown) =>
	new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const text = (s: string, status: number) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
