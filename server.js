const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Config (from environment, per api-contract.md §环境变量)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (console.warn("[warn] SESSION_SECRET not set, using insecure dev fallback"),
  "dev-only-insecure-secret-do-not-use-in-prod");

const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false"; // default true
const SESSION_TTL_REMEMBER = Number(process.env.SESSION_TTL_REMEMBER) || 2592000; // 30d
const SESSION_TTL_SESSION = Number(process.env.SESSION_TTL_SESSION) || 86400; // 24h
const RATE_LIMIT_MAX_FAILURES = Number(process.env.RATE_LIMIT_MAX_FAILURES) || 5;
const RATE_LIMIT_LOCK_MINUTES = Number(process.env.RATE_LIMIT_LOCK_MINUTES) || 15;

const BCRYPT_COST = 12;

// ---------------------------------------------------------------------------
// UserRepository — in-memory Map (data-model.md §1)
// ---------------------------------------------------------------------------
/** @typedef {{id:string,email:string,passwordHash:string,createdAt:number}} User */

class UserRepository {
  constructor() {
    /** @type {Map<string, User>} key = email lowercased */
    this._map = new Map();
  }

  /**
   * Pre-seed a demo user with a bcrypt hash (computed once at startup).
   * @param {string} email
   * @param {string} password
   */
  seedDemoUser(email, password) {
    const lower = email.toLowerCase();
    this._map.set(lower, {
      id: crypto.randomUUID(),
      email: lower,
      passwordHash: bcrypt.hashSync(password, BCRYPT_COST),
      createdAt: Date.now(),
    });
  }

  /**
   * Case-insensitive lookup by email.
   * @param {string} email
   * @returns {User | null}
   */
  findByEmail(email) {
    return this._map.get(email.toLowerCase()) || null;
  }
}

// ---------------------------------------------------------------------------
// SessionStore — in-memory Map with lazy expiry (data-model.md §2)
// ---------------------------------------------------------------------------
/** @typedef {{sid:string,userId:string,email:string,expiresAt:number,createdAt:number}} Session */

class SessionStore {
  constructor() {
    /** @type {Map<string, Session>} key = sid (uuid) */
    this._map = new Map();
  }

  /**
   * @param {string} userId
   * @param {string} email
   * @param {number} ttlSeconds
   * @returns {Session}
   */
  create(userId, email, ttlSeconds) {
    const now = Date.now();
    const session = {
      sid: crypto.randomUUID(),
      userId,
      email,
      expiresAt: now + ttlSeconds * 1000,
      createdAt: now,
    };
    this._map.set(session.sid, session);
    return session;
  }

  /**
   * Lazy-expiry lookup.
   * @param {string} sid
   * @returns {Session | null}
   */
  findBySid(sid) {
    const session = this._map.get(sid);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this._map.delete(sid);
      return null;
    }
    return session;
  }

  /** @param {string} sid */
  delete(sid) {
    this._map.delete(sid);
  }
}

// ---------------------------------------------------------------------------
// RateLimitStore — in-memory Map (data-model.md §3)
// ---------------------------------------------------------------------------
/** @typedef {{failCount:number,lockedUntil:number|null,lastFailureAt:number}} RateLimitEntry */

class RateLimitStore {
  constructor() {
    /** @type {Map<string, RateLimitEntry>} key = email lowercased */
    this._map = new Map();
  }

  /**
   * Check whether the email is currently locked.
   * @param {string} email
   * @returns {{locked:boolean, retryAfterMs?:number}}
   */
  check(email) {
    const key = email.toLowerCase();
    const entry = this._map.get(key);
    if (!entry || !entry.lockedUntil) return { locked: false };
    if (entry.lockedUntil > Date.now()) {
      return { locked: true, retryAfterMs: entry.lockedUntil - Date.now() };
    }
    // Lock expired — not locked; failCount already reset at lock time.
    return { locked: false };
  }

  /**
   * Record a failure, return updated status (including whether just locked).
   * @param {string} email
   * @returns {{locked:boolean, retryAfterMs?:number}}
   */
  recordFailure(email) {
    const key = email.toLowerCase();
    const now = Date.now();
    let entry = this._map.get(key);
    if (!entry) {
      entry = { failCount: 0, lockedUntil: null, lastFailureAt: now };
      this._map.set(key, entry);
    }
    entry.failCount += 1;
    entry.lastFailureAt = now;
    if (entry.failCount >= RATE_LIMIT_MAX_FAILURES) {
      entry.lockedUntil = now + RATE_LIMIT_LOCK_MINUTES * 60 * 1000;
      entry.failCount = 0; // reset count at lock time
      return { locked: true, retryAfterMs: entry.lockedUntil - now };
    }
    return { locked: false };
  }

  /** @param {string} email */
  reset(email) {
    this._map.delete(email.toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers (api-contract.md §Cookie 约定)
// ---------------------------------------------------------------------------

/**
 * Sign sid with HMAC-SHA256 using SESSION_SECRET.
 * Cookie value format: `<sid>.<hex-hmac>`
 * @param {string} sid
 * @returns {string}
 */
function signSid(sid) {
  const hmac = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sid)
    .digest("hex");
  return `${sid}.${hmac}`;
}

/**
 * Verify a cookie value and return the sid, or null if invalid.
 * @param {string} cookieValue
 * @returns {string | null}
 */
function verifySid(cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return null;
  const sid = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sid)
    .digest("hex");
  // timing-safe comparison
  if (
    sid.length === 0 ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  return sid;
}

/**
 * Build Set-Cookie options per design.
 * @param {boolean} rememberMe
 * @returns {{httpOnly:boolean, secure:boolean, sameSite:string, maxAge?:number, path:string}}
 */
function cookieOptions(rememberMe) {
  const opts = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  };
  if (rememberMe) {
    opts.maxAge = SESSION_TTL_REMEMBER * 1000;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Shared error helper
// ---------------------------------------------------------------------------
/**
 * @param {import("express").Response} res
 * @param {number} status
 * @param {string} error
 * @param {string} message
 */
function sendError(res, status, error, message) {
  return res.status(status).json({ error, message });
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

/**
 * Parse the Cookie header into a plain object.
 * Avoids adding a cookie-parser dependency (out of scope per design).
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

/** Extract parsed cookies from the request. */
function getCookies(req) {
  return parseCookies(req.headers.cookie);
}

// Initialise stores + seed demo user (api-contract.md §Demo 用户)
const userRepo = new UserRepository();
const sessionStore = new SessionStore();
const rateLimitStore = new RateLimitStore();

userRepo.seedDemoUser("demo@example.com", "password123");

// ---------------------------------------------------------------------------
// POST /api/login  (api-contract.md)
// ---------------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body || {};

    // --- Validate request body ---
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.trim() === "" ||
      password === ""
    ) {
      return sendError(res, 400, "bad_request", "邮箱和密码不能为空");
    }

    const remember = rememberMe === true;

    // --- Rate-limit check (before bcrypt, per architecture.md §3.4) ---
    const limitStatus = rateLimitStore.check(email);
    if (limitStatus.locked) {
      return sendError(
        res,
        429,
        "too_many_attempts",
        "登录尝试过多，请 15 分钟后再试"
      );
    }

    // --- Lookup user ---
    const user = userRepo.findByEmail(email);

    // --- bcrypt compare — run even if user is null to equalise timing (anti-enumeration) ---
    const dummyHash = bcrypt.hashSync("dummy", BCRYPT_COST); // constant-cost stand-in
    const hashToCheck = user ? user.passwordHash : dummyHash;
    const match = await bcrypt.compare(password, hashToCheck);

    if (!user || !match) {
      // Record failure (use the email as provided for rate-limiting)
      rateLimitStore.recordFailure(email);
      return sendError(res, 401, "invalid_credentials", "邮箱或密码错误");
    }

    // --- Success: reset rate-limit, create session, set cookie ---
    rateLimitStore.reset(user.email);

    const ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_SESSION;
    const session = sessionStore.create(user.id, user.email, ttl);

    res.cookie("sid", signSid(session.sid), cookieOptions(remember));
    return res.status(200).json({ email: user.email });
  } catch (err) {
    console.error("[error] POST /api/login:", err);
    return sendError(res, 500, "internal_error", "服务器内部错误");
  }
});

// ---------------------------------------------------------------------------
// GET /api/me  (api-contract.md)
// ---------------------------------------------------------------------------
app.get("/api/me", (req, res) => {
  try {
    const rawCookie = getCookies(req).sid;
    const sid = verifySid(rawCookie);
    if (!sid) {
      return sendError(res, 401, "not_authenticated", "未登录");
    }

    const session = sessionStore.findBySid(sid);
    if (!session) {
      return sendError(res, 401, "not_authenticated", "未登录");
    }

    return res.status(200).json({ email: session.email });
  } catch (err) {
    console.error("[error] GET /api/me:", err);
    return sendError(res, 500, "internal_error", "服务器内部错误");
  }
});

// ---------------------------------------------------------------------------
// POST /api/logout  (api-contract.md — idempotent)
// ---------------------------------------------------------------------------
app.post("/api/logout", (req, res) => {
  try {
    const rawCookie = getCookies(req).sid;
    const sid = verifySid(rawCookie);
    if (sid) {
      sessionStore.delete(sid);
    }
    // Always clear the cookie, even if not logged in (idempotent per spec)
    res.clearCookie("sid", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: COOKIE_SECURE,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[error] POST /api/logout:", err);
    return sendError(res, 500, "internal_error", "服务器内部错误");
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
