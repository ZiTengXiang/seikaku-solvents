/* 性格そるべんつ ― 画面の組み立て(ハッシュでページを切り替える1ページのアプリ)。
 *   #/            トップ
 *   #/quiz        30問の回答
 *   #/result/<30桁の回答>   結果(URLに回答が入るので、そのまま共有・再表示できる。サーバーには送られない)
 *   #/gods        三十二柱の一覧     #/gods/<コード>  一柱の詳細
 *   #/about       判定基準と診断のしくみ
 */
(function () {
  "use strict";

  var DATA = window.SITE_DATA;
  var D = window.SolventDiagnosis;
  var app = document.getElementById("app");
  var N_Q = DATA.questions.length;
  var LO = DATA.scale.min, HI = DATA.scale.max;
  var STORE_KEY = "seikaku-solvents-progress";
  var THEME_KEY = "seikaku-solvents-theme";
  var TRAIT_CHAR = { E: "外", A: "協", O: "開", C: "誠", N: "神" };
  var traitsByKey = {};
  DATA.traits.forEach(function (t) { traitsByKey[t.key] = t; });
  var godsByCode = {};
  DATA.gods.forEach(function (g) { godsByCode[g.code] = g; });
  var criteriaByTrait = {};
  (DATA.criteria || []).forEach(function (c) { criteriaByTrait[c.trait] = c; });
  var PROFILE_LABELS = [["personality", "性格"], ["appearance", "外見"], ["attire", "装束"], ["accessories", "装飾品・持ち物"]];

  // ---- 小物 ----
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pct(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function store(key, val) {
    try { if (val === undefined) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function render(html, title) {
    stopClip();
    app.innerHTML = '<div class="fade-in">' + html + "</div>";
    document.title = title ? title + " ― 性格そるべんつ" : "性格そるべんつ";
    wirePortraits();
    wireAudio();
  }
  function setNav(name) {
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function rankLabel(r) {
    return '<span class="rank-badge">' + r.rank + "位" + (r.tied ? '<span class="tie">(同率)</span>' : "") + "</span>";
  }

  function nameRuby(g) {
    return "<ruby>" + esc(g.god) + "<rt>" + esc(g.reading) + "</rt></ruby>";
  }

  function codeChips(g) {
    return '<span class="codechips" aria-label="コード ' + g.code + '">' + D.TRAIT_ORDER.map(function (k, i) {
      var bit = g.code[i], t = traitsByKey[k];
      var bl = g.borderline && g.borderline[i];
      return '<span class="chip' + (bit === "1" ? " on" : "") + '" title="' + esc(t.name + "(" + t.solvent_property + ")" + ": " + bit + (bl ? " ⚠ 境界的な判定" : "")) + '">' +
        "<b>" + bit + "</b>" + esc(TRAIT_CHAR[k]) + (bl ? '<span class="bl">⚠</span>' : "") + "</span>";
    }).join("") + "</span>";
  }

  // 画像があれば <img>、無ければ(または読み込みに失敗したら)プレースホルダー
  function portrait(g, eager) {
    var ph = '<div class="portrait placeholder" role="img" aria-label="' + esc(g.god) + 'の絵姿(準備中)">' +
      '<span class="ph-char">' + esc(g.god.charAt(0)) + '</span><span class="ph-note">絵姿 準備中</span></div>';
    if (!g.image) return ph;
    return '<img class="portrait" src="' + esc(g.image) + '" width="600" height="877" alt="' +
      esc(g.god + "(" + g.solvent + "の神様)の絵姿") + '"' + (eager ? "" : ' loading="lazy"') +
      ' data-placeholder="' + esc(ph) + '">';
  }
  function wirePortraits() {
    app.querySelectorAll("img.portrait[data-placeholder]").forEach(function (img) {
      img.addEventListener("error", function () { img.outerHTML = img.getAttribute("data-placeholder"); }, { once: true });
    });
  }
  // 同時に鳴るのは1曲だけ
  function wireAudio() {
    app.querySelectorAll("audio").forEach(function (a) {
      a.addEventListener("play", function () {
        stopClip();
        document.querySelectorAll("audio").forEach(function (o) { if (o !== a) o.pause(); });
      });
    });
  }

  // 「〇〇の言寄さし」: 神からの助言のセリフと、テーマ曲
  function songBlock(g) {
    var s = g.song || {};
    return '<div class="song"><p class="song-head">' + esc(g.god) + "の言寄さし</p>" +
      (g.kotoyosashi ? '<blockquote class="oracle">' + esc(g.kotoyosashi) + "</blockquote>" : "") +
      (g.music
        ? '<p class="song-title">♪ ' + esc(s.title || g.god + "のテーマ") + "</p>" +
          '<audio controls preload="none" src="' + esc(g.music) + '">お使いのブラウザでは再生できません。</audio>'
        : '<p class="song-title muted">♪ 楽曲は準備中です。</p>') +
      "</div>";
  }

  // 2位以下のカードの試聴: 曲の頭から CLIP_SEC 秒だけ鳴らし、最後は音量を絞って止める
  var CLIP_SEC = 20, FADE_SEC = 2;
  var clip = { audio: null, btn: null, timer: null };
  function stopClip() {
    if (clip.timer) clearInterval(clip.timer);
    if (clip.audio) { clip.audio.pause(); clip.audio.removeAttribute("src"); clip.audio.load(); }
    if (clip.btn) { clip.btn.classList.remove("playing"); clip.btn.innerHTML = clip.btn.getAttribute("data-label"); }
    clip = { audio: null, btn: null, timer: null };
  }
  function playClip(btn) {
    var same = clip.btn === btn;
    stopClip();
    if (same) return;
    document.querySelectorAll("audio").forEach(function (o) { o.pause(); });
    var a = new Audio(btn.getAttribute("data-music"));
    a.volume = 1;
    clip = { audio: a, btn: btn, timer: null };
    btn.classList.add("playing");
    btn.innerHTML = "■ 止める";
    a.addEventListener("ended", stopClip);
    a.play().catch(stopClip);
    clip.timer = setInterval(function () {
      var t = a.currentTime;
      if (t >= CLIP_SEC) stopClip();
      else if (t > CLIP_SEC - FADE_SEC) { try { a.volume = Math.max(0, (CLIP_SEC - t) / FADE_SEC); } catch (e) {} }
    }, 100);
  }
  function clipButton(g) {
    if (!g.music) return "";
    var label = "♪ 試聴(" + CLIP_SEC + "秒)";
    return '<button type="button" class="clip" data-music="' + esc(g.music) + '" data-label="' + esc(label) + '" aria-label="' +
      esc(g.god + "のテーマ曲を" + CLIP_SEC + "秒試聴") + '">' + label + "</button>";
  }

  function profileBlock(g) {
    return '<dl class="profile">' + PROFILE_LABELS.map(function (p) {
      return g.profile[p[0]] ? "<dt>" + p[1] + "</dt><dd>" + esc(g.profile[p[0]]) + "</dd>" : "";
    }).join("") + "</dl>";
  }

  // ---- トップ ----
  function viewHome() {
    setNav("");
    var progress = load(STORE_KEY);
    var answered = progress && progress.answers ? progress.answers.filter(function (a) { return a != null; }).length : 0;
    var sample = ["11111", "11110", "11101", "11100"].map(function (c) { return godsByCode[c]; })
      .filter(function (g) { return g && g.image; });
    var mapping = DATA.traits.map(function (t) {
      var c = criteriaByTrait[t.name];
      return '<div class="card"><div class="trait">' + esc(t.name) + '</div><div class="arrow">↓</div><div class="prop">' +
        esc(t.solvent_property) + "</div>" + (c ? '<div class="desc">1:' + esc(shorten(c.one)) + "</div>" : "") + "</div>";
    }).join("");
    render(
      '<section class="hero">' +
      '<p class="eyebrow">性格診断 × 溶媒 × 神社</p>' +
      "<h1>性格そるべんつ</h1>" +
      '<p class="lead">三十の問いに答えると、あなたの性格に近い<strong>溶媒の神様</strong>を五柱、ご縁の深い順にお示しします。' +
      "ビッグファイブの五つの特性を、溶媒の五つの性質に読み替えました。</p>" +
      '<div class="btn-row"><a class="btn" href="#/quiz" data-start>診断をはじめる</a>' +
      (answered > 0 && answered < N_Q ? '<a class="btn ghost" href="#/quiz">続きから(' + answered + "/" + N_Q + ")</a>" : "") +
      '<a class="btn ghost" href="#/gods">三十二柱を見る</a></div>' +
      (sample.length ? '<div class="hero-gallery">' + sample.map(function (g) {
        return '<figure><a href="#/gods/' + g.code + '">' + portrait(g, true) + "</a></figure>";
      }).join("") + "</div>" : "") +
      "</section>" +
      '<div class="shide" aria-hidden="true"></div>' +
      "<h2>五つの特性と、溶媒の性質</h2>" +
      '<div class="mapping">' + mapping + "</div>" +
      '<p class="small muted">それぞれの性質が「ある(1)/ない(0)」の組み合わせで 2<sup>5</sup> = 32 通り。そのすべてに実在の溶媒を割り当て、社に祀られる神様として擬人化しました。<a href="#/about">判定基準を見る</a></p>' +
      "<h2>遊び方</h2>" +
      '<ol class="steps">' +
      '<li class="card">30の文が、自分にどのくらい当てはまるかを4段階で選びます(5分ほど)。</li>' +
      '<li class="card">回答から5つの特性を0〜1の値で出し、32柱の神様との近さ(親和度)を計算します。</li>' +
      '<li class="card">ご縁の深い神様が5柱示されます。1位の神様の絵姿・設定・テーマ曲(雅楽風)をどうぞ。</li>' +
      "</ol>" +
      '<p class="notice small">娯楽用の診断で、心理検査ではありません。回答はお使いのブラウザの中だけで計算し、どこにも送信しません(アクセス解析も入れていません)。</p>',
      "");
    var start = app.querySelector("[data-start]");
    if (start) start.addEventListener("click", function () { store(STORE_KEY, undefined); });
  }
  function shorten(s) {
    s = s.replace(/\*\*/g, "");
    return s.length > 34 ? s.slice(0, 33) + "…" : s;
  }

  // ---- 質問 ----
  var quiz = null;
  function viewQuiz() {
    setNav("quiz");
    var saved = load(STORE_KEY);
    if (!quiz) {
      quiz = { answers: new Array(N_Q).fill(null), index: 0 };
      if (saved && Array.isArray(saved.answers) && saved.answers.length === N_Q) {
        quiz.answers = saved.answers.map(function (a) { return Number.isInteger(a) && a >= LO && a <= HI ? a : null; });
        var first = quiz.answers.indexOf(null);
        quiz.index = first < 0 ? N_Q - 1 : first;
      }
    }
    drawQuestion();
  }
  function drawQuestion() {
    var i = quiz.index, q = DATA.questions[i];
    var done = quiz.answers.filter(function (a) { return a != null; }).length;
    var labels = DATA.scale.labels;
    var choices = labels.map(function (label, k) {
      var v = LO + k;
      return '<button type="button" class="choice" data-v="' + v + '" aria-pressed="' + (quiz.answers[i] === v) + '">' +
        '<span class="dot" aria-hidden="true"></span><span>' + esc(label) + '</span><span class="key" aria-hidden="true">' + (k + 1) + "</span></button>";
    }).join("");
    render(
      '<section class="quiz">' +
      '<div class="progress"><div class="progress-bar" role="progressbar" aria-label="回答の進み具合" aria-valuemin="0" aria-valuemax="' + N_Q +
      '" aria-valuenow="' + done + '"><span style="width:' + (done / N_Q * 100) + '%"></span></div><span>' + done + " / " + N_Q + "</span></div>" +
      '<div class="card question-card">' +
      '<p class="question-no">第 ' + (i + 1) + " 問</p>" +
      '<p class="question-text" id="qtext">' + esc(q.text) + "</p>" +
      '<div class="choices" role="group" aria-labelledby="qtext">' + choices + "</div>" +
      "</div>" +
      '<div class="quiz-nav"><button type="button" class="linkish" data-prev' + (i === 0 ? " disabled" : "") + ">← ひとつ前へ</button>" +
      (quiz.answers[i] != null && i < N_Q - 1 ? '<button type="button" class="linkish" data-next>次へ →</button>' : "") +
      (done === N_Q ? '<button type="button" class="btn small" data-finish>結果を見る</button>' : "") +
      "</div>" +
      '<p class="small muted" style="text-align:center;margin-top:22px">考えこまず、ふだんの自分に近いものを選んでください。</p>' +
      "</section>",
      "診断 第" + (i + 1) + "問");
    app.querySelectorAll(".choice").forEach(function (b) {
      b.addEventListener("click", function () { answer(Number(b.getAttribute("data-v"))); });
    });
    var prev = app.querySelector("[data-prev]");
    prev.addEventListener("click", function () { if (quiz.index > 0) { quiz.index--; drawQuestion(); } });
    var next = app.querySelector("[data-next]");
    if (next) next.addEventListener("click", function () { quiz.index++; drawQuestion(); });
    var fin = app.querySelector("[data-finish]");
    if (fin) fin.addEventListener("click", finish);
    var focus = app.querySelector('.choice[aria-pressed="true"]') || app.querySelector(".choice");
    if (focus && document.activeElement && document.activeElement !== document.body) focus.focus({ preventScroll: true });
  }
  var answering = false;
  function answer(v) {
    if (answering) return;
    quiz.answers[quiz.index] = v;
    store(STORE_KEY, { answers: quiz.answers });
    app.querySelectorAll(".choice").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-v")) === v));
    });
    answering = true;
    var mine = quiz;
    setTimeout(function () {
      answering = false;
      if (quiz !== mine || !app.querySelector(".quiz")) return; // その間に別の画面へ移った
      var nextEmpty = quiz.answers.indexOf(null, quiz.index + 1);
      if (nextEmpty < 0) nextEmpty = quiz.answers.indexOf(null);
      if (nextEmpty < 0) { finish(); return; }
      quiz.index = quiz.index + 1 < N_Q && quiz.answers[quiz.index + 1] == null ? quiz.index + 1 : nextEmpty;
      drawQuestion();
      window.scrollTo({ top: 0 });
    }, 200);
  }
  function finish() {
    var a = quiz.answers.slice();
    if (a.some(function (x) { return x == null; })) return;
    store(STORE_KEY, undefined);
    quiz = null;
    location.hash = "#/result/" + a.join("");
  }
  document.addEventListener("keydown", function (e) {
    if (!quiz || !app.querySelector(".quiz") || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = Number(e.key);
    if (k >= 1 && k <= HI - LO + 1) { e.preventDefault(); answer(LO + k - 1); }
    else if (e.key === "Backspace" || e.key === "ArrowLeft") {
      if (quiz.index > 0) { e.preventDefault(); quiz.index--; drawQuestion(); }
    } else if (e.key === "ArrowRight" && quiz.answers[quiz.index] != null && quiz.index < N_Q - 1) {
      quiz.index++; drawQuestion();
    }
  });

  // ---- 結果 ----
  function radarSvg(scores, god) {
    var cx = 180, cy = 172, R = 112, n = scores.length;
    function pt(i, r) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    function poly(vals) { return vals.map(function (v, i) { return pt(i, R * v).map(function (x) { return x.toFixed(1); }).join(","); }).join(" "); }
    var grid = [0.25, 0.5, 0.75, 1].map(function (f) {
      return '<polygon class="grid" points="' + poly(scores.map(function () { return f; })) + '"/>';
    }).join("");
    var axes = scores.map(function (s, i) { var p = pt(i, R); return '<line class="axis" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; }).join("");
    var labels = scores.map(function (s, i) {
      var p = pt(i, R + 26), anchor = Math.abs(p[0] - cx) < 4 ? "middle" : p[0] > cx ? "start" : "end";
      var dy = i === 0 ? -6 : 0;
      return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(s.name) +
        '</text><text class="prop" x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy + 14).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(s.solvent_property) + "</text>";
    }).join("");
    var godVals = god.code.split("").map(Number);
    var you = scores.map(function (s) { return s.value; });
    var pts = you.map(function (v, i) { var p = pt(i, R * v); return '<circle class="pt" r="3.5" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '"/>'; }).join("");
    return '<svg class="radar" viewBox="0 0 360 330" role="img" aria-label="5特性のレーダーチャート">' + grid + axes +
      '<polygon class="god" points="' + poly(godVals) + '"/>' +
      '<polygon class="you" points="' + poly(you) + '"/>' + pts + labels + "</svg>" +
      '<div class="legend"><span><i></i>あなた</span><span><i class="g"></i>' + esc(god.god) + "(" + god.code + ")</span></div>";
  }

  function barsHtml(scores) {
    return '<div class="bars">' + scores.map(function (s) {
      return '<div class="bar-row"><div class="bar-label"><span><b>' + esc(s.name) + '</b> <span class="muted small">(' + esc(s.solvent_property) +
        ')</span></span><span class="v">' + s.value.toFixed(2) + '</span></div>' +
        '<div class="bar" role="meter" aria-label="' + esc(s.name) + '" aria-valuemin="0" aria-valuemax="1" aria-valuenow="' + s.value.toFixed(3) + '"><span style="width:' + (s.value * 100).toFixed(1) + '%"></span></div>' +
        '<div class="bar-ends"><span>0 ' + esc(s.solvent_property) + "が低い</span><span>" + esc(s.solvent_property) + "が高い 1</span></div></div>";
    }).join("") + "</div>";
  }

  function viewResult(code) {
    setNav("");
    var answers = code.split("").map(Number);
    var valid = answers.length === N_Q && answers.every(function (a) { return Number.isInteger(a) && a >= LO && a <= HI; });
    if (!valid) {
      render('<h1>結果を表示できません</h1><p>URLの回答が正しくありません(' + N_Q + "桁・各" + LO + "〜" + HI + 'の数字が必要です)。</p><p><a class="btn" href="#/quiz">診断をはじめる</a></p>', "結果");
      return;
    }
    var r = D.diagnose(answers, DATA, 5);
    var top = r.ranking[0], g = top.god;
    var tiedTop = r.ranking.filter(function (x) { return x.rank === 1; }).length;
    var others = r.ranking.slice(1).map(function (x) {
      return '<div class="card mini"><a class="mini-link" href="#/gods/' + x.code + '">' + portrait(x.god) +
        '<div class="mini-body"><div class="mini-rank">' + x.rank + "位" + (x.tied ? "(同率)" : "") + "</div>" +
        '<p class="mini-name">' + esc(x.god.god) + "<small>" + esc(x.god.reading) + "</small></p>" +
        '<p class="mini-solvent">' + esc(x.god.solvent) + " · " + x.code + "</p>" +
        '<div class="mini-aff">親和度 <b>' + pct(x.affinity_pct) + '%</b><span class="err">誤差率 ' + pct(x.error_pct) + "%</span></div></div></a>" +
        (x.god.music ? '<div class="mini-foot">' + clipButton(x.god) + "</div>" : "") + "</div>";
    }).join("");
    render(
      '<section class="result-head"><p class="eyebrow">診断結果</p><h1>ご縁の深い神様</h1></section>' +
      '<article class="card feature">' +
      '<div class="portrait-wrap">' + portrait(g, true) + "</div>" +
      '<div class="feature-body">' + rankLabel(top) +
      '<h2 class="god-name">' + nameRuby(g) + "</h2>" +
      '<p class="solvent-name"><strong>' + esc(g.solvent) + "</strong> の神様 · " + esc(g.gender) + "</p>" +
      codeChips(g) +
      '<div class="scoreline"><span class="affinity">親和度 <b>' + pct(top.affinity_pct) + '%</b></span><span class="err">誤差率 ' + pct(top.error_pct) + "%(距離 " + top.distance.toFixed(4) + ")</span></div>" +
      (tiedTop > 1 ? '<p class="small notice">同じ近さの神様が ' + tiedTop + " 柱いらっしゃいます。並びは回答から決まる順です。</p>" : "") +
      profileBlock(g) +
      (g.solvent_note ? '<p class="solvent-note">⚗ ' + esc(g.solvent_note) + "</p>" : "") +
      songBlock(g) +
      '<p class="small" style="margin-top:12px"><a href="#/gods/' + g.code + '">この神様のくわしい設定 →</a></p>' +
      "</div></article>" +
      "<h2>あなたの五つの特性</h2>" +
      '<div class="card traits"><div>' + radarSvg(r.scores, g) + "</div>" + barsHtml(r.scores) + "</div>" +
      "<h2>二位から五位の神様</h2>" +
      '<div class="others">' + others + "</div>" +
      '<p class="small muted" style="margin-top:14px">親和度 = 100 − 誤差率。誤差率は、あなたの5特性と神様のコード(0/1)とのずれの二乗平均平方根を百分率にしたものです。<a href="#/about#how">くわしく</a></p>' +
      '<div class="btn-row"><a class="btn" href="#/quiz" data-restart>もう一度診断する</a>' +
      '<button type="button" class="btn ghost" data-copy>結果のURLをコピー</button>' +
      '<a class="btn ghost" href="#/gods">三十二柱を見る</a></div>' +
      '<p class="small muted">結果のURLには回答が入っています(サーバーには送られません)。URLを開けば同じ結果を表示できます。</p>',
      "結果: " + g.god);
    app.querySelectorAll("button.clip").forEach(function (b) {
      b.addEventListener("click", function () { playClip(b); });
    });
    app.querySelector("[data-restart]").addEventListener("click", function () { store(STORE_KEY, undefined); quiz = null; });
    var copy = app.querySelector("[data-copy]");
    copy.addEventListener("click", function () {
      var url = location.href;
      var done = function () { copy.textContent = "コピーしました"; setTimeout(function () { copy.textContent = "結果のURLをコピー"; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt("このURLをコピーしてください", url); });
      else prompt("このURLをコピーしてください", url);
    });
    window.scrollTo({ top: 0 });
  }

  // ---- 三十二柱 ----
  var godFilter = { trait: null, bit: null };
  function viewGods() {
    setNav("gods");
    var buttons = '<button type="button" data-f="" aria-pressed="' + (godFilter.trait == null) + '">すべて</button>' +
      DATA.traits.map(function (t, i) {
        return ["1", "0"].map(function (b) {
          var on = godFilter.trait === i && godFilter.bit === b;
          return '<button type="button" data-f="' + i + ":" + b + '" aria-pressed="' + on + '">' + esc(t.solvent_property) + (b === "1" ? "が高い" : "が低い") + "</button>";
        }).join("");
      }).join("");
    var list = DATA.gods.filter(function (g) {
      return godFilter.trait == null || g.code[godFilter.trait] === godFilter.bit;
    });
    var cards = list.map(function (g) {
      return '<a class="card mini" href="#/gods/' + g.code + '">' + portrait(g) +
        '<div class="mini-body"><p class="mini-name">' + esc(g.god) + "<small>" + esc(g.reading) + "</small></p>" +
        '<p class="mini-solvent">' + esc(g.solvent) + "</p>" + codeChips(g) + "</div></a>";
    }).join("");
    var nImg = DATA.gods.filter(function (g) { return g.image; }).length;
    render(
      '<p class="eyebrow" style="padding-top:26px">三十二柱</p><h1>溶媒の神様たち</h1>' +
      '<p>' + esc((DATA.character_intro && DATA.character_intro.lead) || "") + "コードは左から 外向性・協調性・開放性・誠実性・神経症傾向 の順で、1 が朱、0 が藍です。⚠ は化学的に議論の余地がある境界的な判定です。</p>" +
      (nImg < DATA.gods.length ? '<p class="small muted">絵姿は ' + nImg + " / " + DATA.gods.length + " 柱ぶん公開中です。残りは順次追加します。</p>" : "") +
      '<div class="filters" role="group" aria-label="しぼりこみ">' + buttons + "</div>" +
      '<p class="small muted">' + list.length + " 柱</p>" +
      '<div class="gods-grid">' + cards + "</div>",
      "三十二柱");
    app.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-f");
        if (!f) godFilter = { trait: null, bit: null };
        else { var p = f.split(":"); godFilter = { trait: Number(p[0]), bit: p[1] }; }
        viewGods();
      });
    });
  }

  function viewGod(code) {
    setNav("gods");
    var g = godsByCode[code];
    if (!g) { render('<h1>見つかりません</h1><p><a href="#/gods">三十二柱の一覧へ</a></p>', "見つかりません"); return; }
    var idx = DATA.gods.indexOf(g);
    var prev = DATA.gods[(idx + DATA.gods.length - 1) % DATA.gods.length], next = DATA.gods[(idx + 1) % DATA.gods.length];
    var axisRows = D.TRAIT_ORDER.map(function (k, i) {
      var t = traitsByKey[k], c = criteriaByTrait[t.name], bit = g.code[i];
      return "<tr><th>" + esc(t.name) + '<br><span class="muted small">' + esc(t.solvent_property) + '</span></th><td class="bit' + (bit === "1" ? " on" : "") + '">' + bit +
        (g.borderline[i] ? " ⚠" : "") + "</td><td>" + (c ? esc((bit === "1" ? c.one : c.zero).replace(/\*\*/g, "")) : "") + "</td></tr>";
    }).join("");
    render(
      '<div class="detail"><div class="portrait-wrap">' + portrait(g, true) + "</div>" +
      "<div>" +
      '<p class="eyebrow" style="margin-top:6px">コード ' + g.code + "</p>" +
      '<h1 class="god-name">' + nameRuby(g) + "</h1>" +
      '<p class="solvent-name"><strong>' + esc(g.solvent_full || g.solvent) + "</strong> の神様 · " + esc(g.gender) + "</p>" +
      codeChips(g) + profileBlock(g) +
      (g.solvent_note ? '<p class="solvent-note">⚗ ' + esc(g.solvent_note) + "</p>" : "") +
      songBlock(g) +
      "<h3>溶媒としての性質</h3>" +
      '<table class="axis-table"><tbody>' + axisRows + "</tbody></table>" +
      (g.borderline.some(Boolean) ? '<p class="small muted">⚠ は境界的な判定(化学的に議論の余地がある)です。</p>' : "") +
      "</div></div>" +
      '<nav class="pager" aria-label="前後の神様"><a href="#/gods/' + prev.code + '">← ' + esc(prev.god) + '</a><a href="#/gods">一覧へ</a><a href="#/gods/' + next.code + '">' + esc(next.god) + " →</a></nav>",
      g.god + "(" + g.solvent + ")");
    window.scrollTo({ top: 0 });
  }

  // ---- しくみ ----
  function viewAbout() {
    setNav("about");
    var rows = (DATA.criteria || []).map(function (c) {
      return "<tr><td>" + esc(c.trait) + "</td><td>" + esc(c.property) + "</td><td>" + esc(c.one.replace(/\*\*/g, "")) + "</td><td>" + esc(c.zero.replace(/\*\*/g, "")) + "</td></tr>";
    }).join("");
    var intro = DATA.character_intro || { common: [], axes: [] };
    var labels = DATA.scale.labels.map(function (l, i) { return (LO + i) + "=" + esc(l); }).join("、");
    render(
      '<div class="prose"><p class="eyebrow" style="padding-top:26px">しくみ</p><h1>判定基準と診断のしくみ</h1>' +
      "<h2>五つの特性と溶媒の性質</h2>" +
      "<p>心理学で広く使われる性格の5因子モデル(ビッグファイブ)の各特性を、溶媒の性質に読み替えています。それぞれ「1(高い)/0(低い)」の二択で、32通りの組み合わせに実在の溶媒を1つずつ割り当てました。</p>" +
      "</div>" +
      '<div class="table-scroll"><table class="criteria"><thead><tr><th>ビッグファイブ</th><th>溶媒の性質</th><th>1</th><th>0</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="prose"><ul class="small">' + (DATA.criteria_notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" +
      '<h2 id="how">診断のしくみ</h2>' +
      "<ol>" +
      "<li>30の文(各特性6問、うち3問は逆向きの質問)に、4段階(" + labels + ")で答えます。中間の選択肢はありません。</li>" +
      "<li>各問の得点を0〜1にします。ふつうの質問は (回答−1)/3、逆向きの質問は (4−回答)/3。</li>" +
      "<li>特性ごとに6問の得点を平均して、5特性の値(0〜1)を出します。質問ごとに、その特性をどれだけよく測れそうかで少し重み(0.86〜1.12)を付けています。重みの合計を調整してあるので、値がちょうど0.5になることはありません。</li>" +
      "<li>あなたの5特性と、各神様のコード(例:アセトン 11110 → 1,1,1,1,0)との<b>距離</b> = 差の二乗の和 を求め、近い順に5柱を選びます。計算は分数で厳密に行います。</li>" +
      "</ol>" +
      '<p class="formula">誤差率(%) = √(距離 ÷ 5) × 100<br>親和度(%) = 100 − 誤差率</p>' +
      "<p>コードどおりに答えると親和度100%、1つの特性だけ正反対なら約55%、すべて正反対なら0%です。距離がまったく同じ神様は同じ順位で「◯位(同率)」と表示し、その並びは回答から決まるハッシュ値(SHA-256)の順にしています(同じ回答なら毎回同じ順)。</p>" +
      "<h2>神様の設定について</h2>" +
      "<ul>" + intro.common.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" +
      "<h3>性格5軸の読み替え(絵姿)</h3>" +
      "<ul>" + intro.axes.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" +
      "<h3>テーマ曲</h3>" +
      '<p>32柱それぞれに、<a href="https://github.com/ZiTengXiang/gagaku-player">雅楽譜プレイヤー</a>で作曲した雅楽風のテーマ曲があります。外向性はテンポと調子(呂・律)、協調性は楽器の数、開放性は音域と装飾、誠実性は打楽器の拍の整い方、神経症傾向はテンポの揺らぎに表れます。</p>' +
      "<h2>ご注意とクレジット</h2>" +
      "<ul>" +
      "<li>ビッグファイブに着想を得た<b>娯楽用</b>の診断です。質問文は自作で、標準化された心理検査ではありません。結果を人の評価や判断に使わないでください。</li>" +
      "<li>回答はお使いのブラウザの中だけで計算し、どこにも送信しません。アクセス解析やCookieは使っていません(途中の回答と配色の設定だけ、ブラウザ内に保存します)。</li>" +
      "<li>神様の絵姿は画像生成モデル <b>Animagine XL 4.0</b>(CreativeML Open RAIL++-M ライセンス)による AI 生成です。</li>" +
      '<li>楽曲は<a href="https://github.com/ZiTengXiang/gagaku-player">雅楽譜プレイヤー</a>で作曲・合成しました。</li>' +
      "<li>溶媒の性質の判定は、32溶媒の中での相対評価を含む遊びのための単純化です。実験の参考にはしないでください。</li>" +
      '<li>ソースコード: <a href="https://github.com/ZiTengXiang/seikaku-solvents">github.com/ZiTengXiang/seikaku-solvents</a>(コードは MIT ライセンス)</li>' +
      "</ul></div>",
      "しくみ");
    if (location.hash.indexOf("#how") > 0) {
      var el = document.getElementById("how");
      if (el) el.scrollIntoView();
    } else window.scrollTo({ top: 0 });
  }

  // ---- ルーティング ----
  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("#")[0].split("/");
    if (parts[0] !== "quiz") quiz = null;
    if (parts[0] === "quiz") viewQuiz();
    else if (parts[0] === "result" && parts[1]) viewResult(parts[1]);
    else if (parts[0] === "gods" && parts[1]) viewGod(parts[1]);
    else if (parts[0] === "gods") viewGods();
    else if (parts[0] === "about") viewAbout();
    else viewHome();
  }
  window.addEventListener("hashchange", route);

  // ---- 配色の切り替え(自動 → ライト → ダーク) ----
  var themeBtn = document.querySelector(".theme-toggle");
  var THEMES = ["", "light", "dark"], THEME_NAMES = { "": "自動", light: "ライト", dark: "ダーク" };
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    themeBtn.title = "配色: " + THEME_NAMES[t] + "(クリックで切り替え)";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  applyTheme(document.documentElement.dataset.theme || "");
  themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme || "";
    var t = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    applyTheme(t);
    try { if (t) localStorage.setItem(THEME_KEY, t); else localStorage.removeItem(THEME_KEY); } catch (e) {}
  });

  route();
})();
