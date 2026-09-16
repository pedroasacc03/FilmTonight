// Minimal, hand-rolled auth using only Node's built-in `crypto` module.
//
// Why not a library like bcrypt/NextAuth? For this MVP we deliberately kept
// the dependency list tiny and every step visible, so it's easy to read top
// to bottom and easy for Claude Code (or you) to swap out later - e.g. for
// NextAuth.js with Google/Apple sign-in, exactly as described as a Phase 2
// item in the planning doc. The two things auth needs to do are:
//   1. Turn a password into something safe to store (hashPassword/verifyPassword)
//   2. Prove "this browser is logged in as user X" via a signed cookie (createSessionToken/verifySessionToken)

import crypto from "crypto";

const SESSION_COOKIE_NAME = "filmtonight_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail loudly rather than silently signing tokens with an empty/weak secret.
    throw new Error(
      "AUTH_SECRET is not set. Copy .env.example to .env and set a random AUTH_SECRET value."
    );
  }
  return secret;
}

// --- Password hashing (scrypt) ---
// scrypt is a built-in Node algorithm designed for password hashing (slow on
// purpose, so brute-forcing stolen hashes is expensive). We store the random
// salt alongside the hash as "salt:hash", both hex-encoded, in a single string
// so User.passwordHash is just one column.

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  const candidateHash = crypto.scryptSync(password, salt, 64).toString("hex");
  // timingSafeEqual avoids leaking info via how-long-the-comparison-took
  const a = Buffer.from(originalHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Session tokens ---
// A session token is just: base64url(payload JSON) + "." + HMAC signature of that payload.
// Anyone can read the payload (it's not encrypted, just signed), but only
// someone who knows AUTH_SECRET can produce a signature that matches - so a
// tampered payload (e.g. changing the userId) is detectable.

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function createSessionToken(userId) {
  const payload = JSON.stringify({ userId, issuedAt: Date.now() });
  const encodedPayload = base64url(payload);
  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");

  const expectedSignature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(encodedPayload)
    .digest("base64url");

  const a = Buffer.from(signature || "");
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null; // signature doesn't match - tampered or forged token
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const ageSeconds = (Date.now() - payload.issuedAt) / 1000;
    if (ageSeconds > SESSION_MAX_AGE_SECONDS) return null; // expired
    return payload; // { userId, issuedAt }
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };
