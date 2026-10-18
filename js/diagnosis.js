/* 性格そるべんつ診断のロジック(Python版 reference/core.py の移植)。
 *
 * 回答30個 → 5特性スコア(0〜1) → 32柱との距離 → 近い順に上位N柱と親和度。
 * 同点判定に浮動小数点の誤差が入らないよう、内部は BigInt の分数で計算する。
 * ブラウザの中だけで完結し、回答はどこにも送らない。
 */
(function (global) {
  "use strict";

  var TRAIT_ORDER = ["E", "A", "O", "C", "N"]; // コードの桁順

  // ---- BigInt の分数 ----
  function gcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  function frac(n, d) {
    if (d === undefined) d = 1n;
    if (d < 0n) { n = -n; d = -d; }
    var g = gcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  function add(x, y) { return frac(x.n * y.d + y.n * x.d, x.d * y.d); }
  function sub(x, y) { return frac(x.n * y.d - y.n * x.d, x.d * y.d); }
  function mul(x, y) { return frac(x.n * y.n, x.d * y.d); }
  function div(x, y) { return frac(x.n * y.d, x.d * y.n); }
  function cmp(x, y) { var l = x.n * y.d, r = y.n * x.d; return l < r ? -1 : l > r ? 1 : 0; }

  // 分数 → 最も近い double(Python の float(Fraction) と同じく正しく丸める)
  function toFloat(x) {
    var neg = x.n < 0n, n = neg ? -x.n : x.n, d = x.d;
    if (n === 0n) return 0;
    var LIM = 9007199254740992n; // 2^53
    if (n <= LIM && d <= LIM) return (neg ? -1 : 1) * (Number(n) / Number(d));
    // 商 q が 2^55 以上になるよう 2^s 倍してから割り、余りがあれば最下位ビットを立てる
    // (sticky bit)。Number(BigInt) は最近接偶数に丸めるので、これで正しく丸まる。
    var s = Math.max(0, 56 - (n.toString(2).length - d.toString(2).length));
    var scaled = n << BigInt(s), q = scaled / d;
    if (scaled % d) q |= 1n;
    return (neg ? -1 : 1) * Number(q) / Math.pow(2, s);
  }

  // JSON の数値(例 1.12)を、表記どおりの10進分数にする。Python の Fraction(str(w)) と同じ
  function decimalFrac(v) {
    var s = String(v);
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("重みの表記が想定外: " + s);
    var parts = s.replace("-", "").split(".");
    var digits = parts[1] || "";
    var n = BigInt(parts[0] + digits);
    return frac(s[0] === "-" ? -n : n, 10n ** BigInt(digits.length));
  }

  function itemValue(answer, reverse, lo, hi) {
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < lo || answer > hi) {
      throw new Error("回答は" + lo + "〜" + hi + "の整数: " + answer);
    }
    var span = BigInt(hi - lo);
    return reverse ? frac(BigInt(hi - answer), span) : frac(BigInt(answer - lo), span);
  }

  /** 回答(質問順)→ {E: 分数, ...}。各特性は6問の重み付き平均。 */
  function scoreTraits(answers, data) {
    var qs = data.questions, lo = data.scale.min, hi = data.scale.max;
    if (answers.length !== qs.length) throw new Error("回答数は" + qs.length + "個必要");
    var num = {}, den = {};
    TRAIT_ORDER.forEach(function (k) { num[k] = frac(0n); den[k] = frac(0n); });
    qs.forEach(function (q, i) {
      var w = decimalFrac(q.weight === undefined ? 1 : q.weight);
      num[q.trait] = add(num[q.trait], mul(w, itemValue(answers[i], q.reverse, lo, hi)));
      den[q.trait] = add(den[q.trait], w);
    });
    var out = {};
    TRAIT_ORDER.forEach(function (k) { out[k] = div(num[k], den[k]); });
    return out;
  }

  function squaredDistance(user, code) {
    var s = frac(0n);
    for (var i = 0; i < user.length; i++) {
      var diff = sub(user[i], frac(BigInt(code.charCodeAt(i) - 48)));
      s = add(s, mul(diff, diff));
    }
    return s;
  }

  /** RMS誤差 = √(距離/5)、誤差率(%) = RMS×100、親和度(%) = 100 − |誤差率| */
  function affinityFromDistance(distanceFloat, nAxes) {
    var rms = Math.sqrt(distanceFloat / (nAxes || TRAIT_ORDER.length));
    var err = rms * 100;
    return { rms: rms, err: err, aff: 100 - Math.abs(err) };
  }

  // ---- SHA-256(同点の並び順用。crypto.subtle は非同期で file:// でも使えないので自前) ----
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function sha256Hex(str) {
    var msg = utf8(str), len = msg.length;
    var nBlocks = ((len + 9 + 63) >> 6), buf = new Uint8Array(nBlocks * 64);
    buf.set(msg);
    buf[len] = 0x80;
    var bitLen = len * 8, dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(buf.length - 4, bitLen >>> 0);
    var h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Uint32Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var b = 0; b < nBlocks; b++) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(b * 64 + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    var hex = "";
    for (var i = 0; i < 8; i++) hex += ("00000000" + h[i].toString(16)).slice(-8);
    return hex;
  }

  /** 同点の並び順に使うキー: SHA-256(「回答をカンマで連結」+「|」+ コード) */
  function tieKey(seed, code) { return sha256Hex(seed + "|" + code); }

  /** 距離の昇順に上位 topN 柱。同距離は同順位(1,1,3…)、並びは tieKey 順。 */
  function rankGods(user, gods, topN, seed) {
    var scored = gods.map(function (g) {
      return { d: squaredDistance(user, g.code), g: g, key: tieKey(seed || "", g.code) };
    });
    scored.sort(function (x, y) {
      return cmp(x.d, y.d) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    });
    return scored.slice(0, topN).map(function (s) {
      var lower = 0, same = 0;
      scored.forEach(function (o) { var c = cmp(o.d, s.d); if (c < 0) lower++; else if (c === 0) same++; });
      var dist = toFloat(s.d), a = affinityFromDistance(dist);
      return { rank: 1 + lower, tied: same > 1, god: s.g, code: s.g.code, distance: dist,
        rms_error: a.rms, error_pct: a.err, affinity_pct: a.aff };
    });
  }

  /** 回答の配列 → { scores: [{key, name, solvent_property, value}], ranking: [...] } */
  function diagnose(answers, data, topN) {
    var traits = scoreTraits(answers, data);
    var user = TRAIT_ORDER.map(function (k) { return traits[k]; });
    var names = {};
    data.traits.forEach(function (t) { names[t.key] = t; });
    return {
      scores: TRAIT_ORDER.map(function (k) {
        return { key: k, name: names[k].name, solvent_property: names[k].solvent_property,
          value: toFloat(traits[k]) };
      }),
      ranking: rankGods(user, data.gods, topN || 5, answers.join(",")),
    };
  }

  global.SolventDiagnosis = {
    TRAIT_ORDER: TRAIT_ORDER, diagnose: diagnose, scoreTraits: scoreTraits, rankGods: rankGods,
    tieKey: tieKey, sha256Hex: sha256Hex, toFloat: toFloat, frac: frac,
  };
})(typeof window !== "undefined" ? window : globalThis);
