/**
 * 登录失败限流（Web 登录与 SFTP 密码认证共用），防止口令暴力破解。
 * key 通常为 `${ip}|${username}`，同时按 IP 维度做一个更宽松的总量限制。
 */
class LoginLimiter {
  constructor({ maxPerUser = 5, maxPerIp = 30, windowMs = 15 * 60 * 1000 } = {}) {
    this.maxPerUser = maxPerUser;
    this.maxPerIp = maxPerIp;
    this.windowMs = windowMs;
    this.failures = new Map(); // key -> { count, firstAt }
  }

  _get(key) {
    const rec = this.failures.get(key);
    if (rec && Date.now() - rec.firstAt > this.windowMs) {
      this.failures.delete(key);
      return null;
    }
    return rec;
  }

  _bump(key) {
    const rec = this._get(key);
    if (rec) rec.count++;
    else this.failures.set(key, { count: 1, firstAt: Date.now() });
  }

  isBlocked(ip, username) {
    const u = this._get(`${ip}|${username}`);
    const i = this._get(ip);
    return (u && u.count >= this.maxPerUser) || (i && i.count >= this.maxPerIp);
  }

  fail(ip, username) {
    this._bump(`${ip}|${username}`);
    this._bump(ip);
    this._prune();
  }

  succeed(ip, username) {
    this.failures.delete(`${ip}|${username}`);
  }

  _prune() {
    if (this.failures.size < 10000) return;
    for (const key of this.failures.keys()) this._get(key);
  }
}

module.exports = new LoginLimiter();
