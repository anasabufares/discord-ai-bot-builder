import crypto from "node:crypto";

// Bot tokens are stored encrypted (AES-256-GCM) with a key derived from SECRET_KEY.
export function createCipher(secret) {
  const key = crypto.createHash("sha256").update(`token-encryption:${secret}`).digest();

  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
    },
    decrypt(stored) {
      const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}

// Dashboard sessions: "<expiry>.<hmac>" in an httpOnly cookie. No server-side session table needed.
export function createSessions(secret, ttlMs = 7 * 24 * 3600 * 1000) {
  const key = crypto.createHash("sha256").update(`session:${secret}`).digest();
  const sign = (payload) => crypto.createHmac("sha256", key).update(payload).digest("base64url");

  return {
    ttlMs,
    issue() {
      const payload = `${Date.now() + ttlMs}.${crypto.randomBytes(8).toString("hex")}`;
      return `${payload}.${sign(payload)}`;
    },
    verify(token) {
      if (typeof token !== "string") return false;
      const i = token.lastIndexOf(".");
      if (i < 0) return false;
      const payload = token.slice(0, i);
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(token.slice(i + 1));
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
      return Number(payload.split(".")[0]) > Date.now();
    },
  };
}

export function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
