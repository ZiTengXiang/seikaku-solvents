/* 性格そるべんつ ― 画面の組み立て(ハッシュでページを切り替える1ページのアプリ)。
 *   #/            トップ
 *   #/quiz        30問の回答
 *   #/result/<30桁の回答>   結果(URLに回答が入るので、そのまま共有・再表示できる。サーバーには送られない)
 *   #/gods        三十二柱の一覧     #/gods/<コード>  一柱の詳細
 *   #/myth        神話(溶媒の神々の誕生)  #/myth/<章id または コード>  その章・柱の位置へ
 *   #/music       楽曲(最初の五柱と三十二柱の曲・調子の解説)  #/music/<primordial|gods|modes|axes>
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
    wireScores();
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
          (s.classical_note ? '<p class="song-note">' + esc(s.classical_note) + "</p>" : "") +
          '<audio controls preload="none" src="' + esc(g.music) + '">お使いのブラウザでは再生できません。</audio>' +
          scoreBlock(s.score, g.god)
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
      '<aside class="disclaimer" role="note" aria-label="ご注意">' +
      '<p class="disclaimer-head">ご注意 ― この物語はフィクションです</p>' +
      "<p>本作に登場する神々・精霊・神話、神名や「言寄さし」の言葉は、すべて創作による<strong>架空のもの</strong>です。" +
      "実在の神社・祭神・宗教団体・宗派・思想信条とは<strong>一切関係ありません</strong>。特定の宗教や信仰を勧めたり、批評したりする意図もありません。</p>" +
      "</aside>" +
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
      (MYTH ? mythOrigin(g) : "") +
      "<h3>溶媒としての性質</h3>" +
      '<table class="axis-table"><tbody>' + axisRows + "</tbody></table>" +
      (g.borderline.some(Boolean) ? '<p class="small muted">⚠ は境界的な判定(化学的に議論の余地がある)です。</p>' : "") +
      "</div></div>" +
      '<nav class="pager" aria-label="前後の神様"><a href="#/gods/' + prev.code + '">← ' + esc(prev.god) + '</a><a href="#/gods">一覧へ</a><a href="#/gods/' + next.code + '">' + esc(next.god) + " →</a></nav>",
      g.god + "(" + g.solvent + ")");
    window.scrollTo({ top: 0 });
  }

  // ---- 神話 ----
  var MYTH = DATA.myth;
  var NON_GOD_NOTE = { "金霊": "金", "大硝主": "硝", "翠灰": "灰", "黄灰": "灰", "白灰": "灰" };
  var ASH = { "翠灰": "塩素", "黄灰": "硫黄", "白灰": "フッ素" };
  var godsByName = {};
  DATA.gods.forEach(function (g) { godsByName[g.god] = g; });
  var lineageByCode = {};
  if (MYTH) MYTH.genealogy.forEach(function (x) { lineageByCode[x.code] = x; });
  var mythNameRe = DATA.gods.length ? new RegExp(DATA.gods.map(function (g) { return g.god; })
    .concat(MYTH ? MYTH.primordials.map(function (p) { return p.name; }) : []).concat(["金霊"])
    .sort(function (a, b) { return b.length - a.length; }).join("|"), "g") : null;
  var primordialNames = {};
  if (MYTH) MYTH.primordials.forEach(function (p) { primordialNames[p.name] = p; });

  // 本文中の神名: 溶媒の神は各段落の最初の1回だけ詳細ページへのリンクに、最初の五柱と金霊は字の色だけ変える
  function mythText(text, self) {
    var seen = {};
    return esc(text).replace(mythNameRe, function (name) {
      var g = godsByName[name];
      if (g) {
        if (g.code === self || seen[name]) return name;
        seen[name] = true;
        return '<a class="kami" href="#/gods/' + g.code + '">' + name + "</a>";
      }
      return '<span class="kami-el">' + name + "</span>";
    }).replace(/\n/g, "<br>");
  }

  function mythBlocks(blocks, self) {
    return blocks.map(function (b) {
      if (b.t === "p") return "<p>" + mythText(b.text, self) + "</p>";
      if (b.t === "list") return '<ul class="decl">' + b.items.map(function (it) { return "<li>" + mythText(it, self) + "</li>"; }).join("") + "</ul>";
      if (b.t === "chem") return '<p class="myth-chem"><span class="myth-tag">⚗ 化学の筋道</span>' + esc(b.text) + "</p>";
      if (b.t === "reason") return '<p class="myth-reason"><span class="myth-tag">✦ 夫婦神に選んだ理由</span>' + esc(b.text) + "</p>";
      if (b.t === "primordials") return primordialsHtml();
      if (b.t === "genealogy") return genealogyHtml();
      if (b.t === "god") return mythGod(b);
      return "";
    }).join("");
  }

  // 最初の五柱(アイコンは assets/icons/ にあれば使う。無ければ頭文字の丸)
  function primordialsHtml() {
    return '<div class="primordials">' + MYTH.primordials.map(function (p, i) {
      var icon = p.icon ? '<img src="' + esc(p.icon) + '" width="72" height="72" alt="" loading="lazy">'
        : '<span class="pm-ph" aria-hidden="true">' + esc(p.name.charAt(0)) + "</span>";
      return '<figure class="pm' + (i === 0 ? " pm-root" : "") + '">' + icon + "<figcaption><ruby>" + esc(p.name) + "<rt>" + esc(p.reading) +
        '</rt></ruby><span class="pm-role">' + esc(p.role) + "</span></figcaption></figure>";
    }).join("") + "</div>";
  }

  function mythGod(b) {
    var g = godsByCode[b.code];
    var thumb = g.image ? '<img src="' + esc(g.image) + '" width="600" height="877" alt="" loading="lazy">'
      : '<span class="mg-ph" aria-hidden="true">' + esc(g.god.charAt(0)) + "</span>";
    return '<section class="myth-god" id="myth-' + b.code + '">' +
      '<a class="mg-head" href="#/gods/' + b.code + '"><span class="mg-thumb">' + thumb + "</span>" +
      '<span class="mg-name"><span class="mg-god">' + nameRuby(g) + "</span>" +
      '<span class="mg-solvent">' + esc(g.solvent) + " · " + esc(g.gender) + " · " + b.code + "</span></span>" +
      '<span class="mg-more">設定を見る →</span></a>' +
      mythBlocks(b.blocks, b.code) + "</section>";
  }

  function viewMyth(target) {
    setNav("myth");
    if (!MYTH) { render("<h1>神話</h1><p>準備中です。</p>", "神話"); return; }
    var toc = MYTH.chapters.map(function (c) {
      var gods = c.blocks.filter(function (b) { return b.t === "god"; }).map(function (b) {
        return '<a href="#/myth/' + b.code + '">' + esc(godsByCode[b.code].god) + "</a>";
      }).join("");
      return '<li class="toc-l' + c.level + '"><a class="toc-ch" href="#/myth/' + c.id + '">' + esc(c.title) + "</a>" +
        (gods ? '<span class="toc-gods">' + gods + "</span>" : "") + "</li>";
    }).join("");
    var body = MYTH.chapters.map(function (c) {
      var h = c.level <= 2 ? "h2" : "h3";
      return '<section class="myth-ch myth-l' + c.level + '" id="myth-' + c.id + '"><' + h + ">" + esc(c.title) + "</" + h + ">" +
        mythBlocks(c.blocks) + "</section>";
    }).join("");
    render(
      '<div class="myth-page">' +
      '<p class="eyebrow" style="padding-top:26px">神話</p><h1>溶媒の神々の誕生</h1>' +
      MYTH.lead.map(function (p) { return '<p class="lead-p">' + esc(p) + "</p>"; }).join("") +
      '<aside class="disclaimer" role="note" aria-label="ご注意"><p>' + esc(MYTH.notice) + "</p></aside>" +
      '<nav class="card myth-toc" id="myth-toc" aria-label="神話の目次"><p class="toc-head">目次</p><ol>' + toc + "</ol></nav>" +
      body +
      '<p class="myth-top"><a href="#/myth/toc">↑ 目次へ</a></p></div>',
      "神話");
    wireTree();
    scrollToMyth(target);
  }
  function scrollToMyth(target) {
    var el = target && document.getElementById("myth-" + target);
    if (el) el.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }

  // ---- 系譜図: 世代(親神の最も深い世代 + 1)ごとに列を立て、親子を線で結ぶ ----
  function shortSolvent(s) { var m = /\(([^)]+)\)$/.exec(s); return m ? m[1] : s; }
  function treeLayout() {
    var codes = MYTH.genealogy.map(function (x) { return x.code; });
    var parentsOf = {}, childrenOf = {};
    codes.forEach(function (c) { parentsOf[c] = []; childrenOf[c] = []; });
    MYTH.genealogy.forEach(function (x) {
      x.parents.forEach(function (p) {
        var g = godsByName[p];
        if (g) { parentsOf[x.code].push(g.code); childrenOf[g.code].push(x.code); }
      });
    });
    var depth = {};
    function d(c) {
      if (depth[c]) return depth[c];
      depth[c] = 1 + parentsOf[c].reduce(function (m, p) { return Math.max(m, d(p)); }, 0);
      return depth[c];
    }
    codes.forEach(d);
    var cols = [];
    codes.forEach(function (c) { (cols[depth[c] - 1] = cols[depth[c] - 1] || []).push(c); });
    var NW = 146, NH = 40, PITCH = 50, COLW = 180, X0 = 30, Y0 = 34;
    var rows = Math.max.apply(null, cols.map(function (c) { return c.length; }));
    var H = rows * PITCH, pos = {};
    // 一列目: 夫婦神を隣り合わせ、ひとりでに現れた神を最後に(系譜表の順)
    cols[0].forEach(function (c, i) { pos[c] = { x: X0, y: Y0 + (i + 0.5) * H / cols[0].length }; });
    for (var k = 1; k < cols.length; k++) {
      var want = {};
      cols[k].forEach(function (c) {
        var ys = parentsOf[c].map(function (p) { return pos[p].y; });
        want[c] = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
      });
      var col = cols[k].slice().sort(function (a, b) { return want[a] - want[b]; });
      var ys = [];
      col.forEach(function (c, i) { ys[i] = Math.max(want[c], i ? ys[i - 1] + PITCH : Y0 + PITCH / 2); });
      var over = ys[ys.length - 1] - (Y0 + H - PITCH / 2);
      for (var i = ys.length - 1; i >= 0 && over > 0; i--) {
        ys[i] -= over;
        if (i > 0 && ys[i - 1] > ys[i] - PITCH) over = ys[i - 1] - (ys[i] - PITCH); else over = 0;
      }
      col.forEach(function (c, i) { pos[c] = { x: X0 + k * COLW, y: ys[i] }; });
    }
    return { codes: codes, parentsOf: parentsOf, childrenOf: childrenOf, depth: depth, pos: pos, cols: cols,
      NW: NW, NH: NH, W: X0 + (cols.length - 1) * COLW + NW + 12, H: Y0 + H + 8, COLW: COLW, X0: X0, Y0: Y0 };
  }

  var KIND_CLASS = { "第一の夫婦神": "k-founder", "第二の夫婦神": "k-founder", "第三の夫婦神": "k-founder", "ひとりでに": "k-self", "星の灰": "k-ash" };
  function genealogyHtml() {
    var L = treeLayout();
    var COL_LABEL = ["元素から現れた神々", "二代目", "三代目", "四代目", "五代目", "六代目"];
    var edges = "", nodes = "", heads = "";
    L.cols.forEach(function (c, k) {
      heads += '<text class="t-colhead" x="' + (L.X0 + k * L.COLW + L.NW / 2) + '" y="16" text-anchor="middle">' + COL_LABEL[k] + "</text>";
    });
    L.codes.forEach(function (c) {
      var b = L.pos[c];
      L.parentsOf[c].forEach(function (p) {
        var a = L.pos[p], x1 = a.x + L.NW, y1 = a.y, x2 = b.x, y2 = b.y, mx = (x1 + x2) / 2;
        edges += '<path class="t-edge" data-from="' + p + '" data-to="' + c + '" d="M' + x1 + " " + y1 + " C" + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2 + '"/>';
      });
    });
    // 夫婦神の契り(一列目の隣り合う二柱を左の括弧で結ぶ)
    [["00010", "10011"], ["11111", "10010"], ["01011", "00001"]].forEach(function (pair) {
      var a = L.pos[pair[0]], b = L.pos[pair[1]];
      if (!a || !b) return;
      var x = a.x - 8;
      edges += '<path class="t-couple" d="M' + a.x + " " + a.y + " H" + x + " V" + b.y + " H" + b.x + '"/>' +
        '<text class="t-couple-l" x="' + (x - 4) + '" y="' + ((a.y + b.y) / 2 + 4) + '" text-anchor="end">契</text>';
    });
    L.codes.forEach(function (c) {
      var g = godsByCode[c], p = L.pos[c], info = lineageByCode[c];
      var marks = [], seen = {};
      info.parents.forEach(function (n) { var m = NON_GOD_NOTE[n]; if (m && !seen[m]) { seen[m] = 1; marks.push(m); } });
      var tip = g.god + "(" + g.solvent + ")― " + info.kind + "\n親神・関わった神: " + info.parents.map(function (n) { return ASH[n] ? n + "(" + ASH[n] + ")" : n; }).join("、") + "\n" + info.chem;
      nodes += '<a class="t-node ' + (KIND_CLASS[info.kind] || "k-child") + '" href="#/gods/' + c + '" data-code="' + c + '">' +
        "<title>" + esc(tip) + "</title>" +
        '<rect x="' + p.x + '" y="' + (p.y - L.NH / 2) + '" width="' + L.NW + '" height="' + L.NH + '" rx="7"/>' +
        '<text class="t-name" x="' + (p.x + 9) + '" y="' + (p.y - 3) + '">' + esc(g.god) + "</text>" +
        '<text class="t-sol" x="' + (p.x + 9) + '" y="' + (p.y + 13) + '">' + esc(shortSolvent(g.solvent)) + "</text>" +
        marks.map(function (m, i) {
          var cx = p.x + L.NW - 11 - i * 17, cy = p.y + 8;
          return '<circle class="t-mark m-' + (m === "金" ? "kin" : m === "硝" ? "sho" : "hai") + '" cx="' + cx + '" cy="' + cy + '" r="7.5"/>' +
            '<text class="t-mark-l" x="' + cx + '" y="' + (cy + 3.6) + '" text-anchor="middle">' + m + "</text>";
        }).join("") + "</a>";
    });
    return '<div class="tree-legend small">' +
      '<span><i class="lg k-founder"></i>三対の夫婦神</span><span><i class="lg k-child"></i>御子神</span>' +
      '<span><i class="lg k-self"></i>ひとりでに現れた神</span><span><i class="lg k-ash"></i>星の灰をまとった神</span>' +
      '<span><b class="lgm m-kin">金</b>金霊のはたらき</span><span><b class="lgm m-sho">硝</b>大硝主の息</span><span><b class="lgm m-hai">灰</b>星の灰</span></div>' +
      '<p class="small muted tree-hint">線は親神から御子神へ。神名にカーソルを合わせると(タップでは長押しで)系統が浮かび、クリックで各柱のページへ移ります。最初の五柱(元素の神々)と金霊は、すべての神々の祖として図の外にいます。</p>' +
      '<div class="tree-scroll"><svg class="tree" width="' + L.W + '" height="' + L.H + '" viewBox="0 0 ' + L.W + " " + L.H + '" role="img" aria-label="三十二柱の系譜図">' +
      heads + '<g class="t-edges">' + edges + "</g>" + nodes + "</svg></div>" +
      '<details class="tree-table"><summary>系譜を表で見る</summary><div class="table-scroll"><table class="criteria"><thead><tr><th>柱</th><th>溶媒</th><th>現れ方</th><th>親神・関わった神</th><th>化学の筋道</th></tr></thead><tbody>' +
      MYTH.genealogy.map(function (x) {
        var g = godsByCode[x.code];
        return '<tr><td><a href="#/myth/' + x.code + '">' + esc(g.god) + "</a></td><td>" + esc(g.solvent) + "</td><td>" + esc(x.kind) + "</td><td>" +
          x.parents.map(function (n) { var p = godsByName[n]; return p ? '<a href="#/gods/' + p.code + '">' + esc(n) + "</a>" : esc(ASH[n] ? n + "(" + ASH[n] + ")" : n); }).join("、") +
          "</td><td>" + esc(x.chem) + "</td></tr>";
      }).join("") + "</tbody></table></div></details>";
  }
  // 選んだ柱の祖先と子孫を浮かび上がらせる
  function wireTree() {
    var svg = app.querySelector("svg.tree");
    if (!svg) return;
    var up = {}, down = {};
    MYTH.genealogy.forEach(function (x) { up[x.code] = []; down[x.code] = down[x.code] || []; });
    MYTH.genealogy.forEach(function (x) {
      x.parents.forEach(function (n) { var g = godsByName[n]; if (g) { up[x.code].push(g.code); (down[g.code] = down[g.code] || []).push(x.code); } });
    });
    function walk(c, map, acc) { (map[c] || []).forEach(function (n) { if (!acc[n]) { acc[n] = true; walk(n, map, acc); } }); return acc; }
    function focus(c) {
      var anc = walk(c, up, {}), des = walk(c, down, {});
      svg.classList.add("focus");
      svg.querySelectorAll(".t-node").forEach(function (n) {
        var k = n.getAttribute("data-code");
        n.classList.toggle("on", !!(k === c || anc[k] || des[k]));
        n.classList.toggle("self", k === c);
      });
      svg.querySelectorAll(".t-edge").forEach(function (e) {
        var f = e.getAttribute("data-from"), t = e.getAttribute("data-to");
        e.classList.toggle("on", !!(((anc[f] || f === c) && (anc[t] || t === c)) || ((des[t] || t === c) && (des[f] || f === c))));
      });
    }
    function clear() { svg.classList.remove("focus"); }
    svg.querySelectorAll(".t-node").forEach(function (n) {
      n.addEventListener("mouseenter", function () { focus(n.getAttribute("data-code")); });
      n.addEventListener("focus", function () { focus(n.getAttribute("data-code")); });
      n.addEventListener("contextmenu", function (e) { e.preventDefault(); focus(n.getAttribute("data-code")); });
      n.addEventListener("mouseleave", clear);
      n.addEventListener("blur", clear);
    });
  }

  // 一柱の詳細ページに添える「誕生の神話」
  function mythOrigin(g) {
    var x = lineageByCode[g.code];
    if (!x) return "";
    var kids = MYTH.genealogy.filter(function (y) { return y.parents.indexOf(g.god) >= 0; }).map(function (y) { return godsByCode[y.code]; });
    function link(n) { var p = godsByName[n]; return p ? '<a href="#/gods/' + p.code + '">' + esc(n) + "</a>" : esc(ASH[n] ? n + "(" + ASH[n] + ")" : n); }
    return '<div class="origin"><p class="song-head">誕生の神話</p>' +
      '<dl class="profile"><dt>現れ方</dt><dd>' + esc(x.kind) + "</dd>" +
      "<dt>親神など</dt><dd>" + x.parents.map(link).join("、") + "</dd>" +
      (kids.length ? "<dt>御子神</dt><dd>" + kids.map(function (k) { return link(k.god); }).join("、") + "</dd>" : "") +
      "<dt>化学</dt><dd>" + esc(x.chem) + "</dd></dl>" +
      '<p class="small" style="margin:10px 0 0"><a href="#/myth/' + g.code + '">神話で読む →</a>(<a href="#/myth/ch10">系譜図</a>)</p></div>';
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

  // ---- 楽曲 ----
  var modesByName = {};
  ((DATA.music_page && DATA.music_page.modes) || []).forEach(function (m) { modesByName[m.name] = m; });
  var musicFilter = null;  // 調子の名前でしぼりこむ(null = すべて)

  // 「壱越調・♩=94・全8楽器・形式 I A A B A A Z・約57秒」→ 調子・テンポ・編成・形式・長さ
  function parseMeta(meta) {
    var out = { mode: "", tempo: "", form: "", length: "", inst: [] };
    String(meta || "").split("・").forEach(function (p, i) {
      p = p.trim();
      if (!p) return;
      if (i === 0 && /調$/.test(p)) out.mode = p;
      else if (/^♩/.test(p)) out.tempo = p;
      else if (/^約/.test(p)) out.length = p.replace(/^約/, "");
      else if (/^形式|小節$/.test(p)) out.form = p.replace(/^形式\s*/, "");
      else if (/^小節ごとに/.test(p)) out.tempo += (out.tempo ? "(" : "") + p + (out.tempo ? ")" : "");
      else out.inst.push(p);
    });
    return out;
  }
  function metaList(meta) {
    var m = parseMeta(meta);
    var rows = [["調子", m.mode], ["テンポ", m.tempo], ["編成", m.inst.join("・")], ["形式", m.form], ["長さ", m.length]];
    return '<dl class="song-meta">' + rows.filter(function (r) { return r[1]; }).map(function (r) {
      return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("") + "</dl>";
  }
  function modeLine(modeName) {
    var md = modesByName[modeName];
    if (!md) return "";
    return '<p class="mode-line"><a href="#/music/modes" class="mode-tag">' + esc(md.name) + "</a>" +
      esc(md.scale + "の調子・主音 " + md.tonic + " ― " + md.character) + "</p>";
  }
  function audioTag(src, label) {
    return src ? '<audio controls preload="none" src="' + esc(src) + '" aria-label="' + esc(label) + '">お使いのブラウザでは再生できません。</audio>'
      : '<p class="small muted">♪ 音源は準備中です。</p>';
  }

  // 楽譜: 開いたときに data/scores/<id>.json を読み、拍ごとのマス目(表)で縦をそろえて描く
  function scoreBlock(score, name) {
    if (!score) return "";
    return '<details class="score" data-score-src="' + esc(score.json) + '"><summary>楽譜を見る(縦をそろえた譜面)</summary>' +
      '<div class="score-body"><p class="small muted">読み込み中…</p></div>' +
      '<p class="small"><a href="' + esc(score.gaku) + '" download>譜面ファイル(.gaku)をダウンロード</a>' +
      '(<a href="https://github.com/ZiTengXiang/gagaku-player">雅楽譜プレイヤー</a>で開くと再生できます)</p></details>';
  }
  function scoreCell(t) {
    var cls = t === "." ? "rest" : t === "-" ? "hold" : "";
    return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(t) + "</td>";
  }
  function renderScore(d) {
    var h = d.head || {};
    var info = [h.mode, h.tempo ? "♩=" + h.tempo : "", h.beats ? "1小節" + h.beats + "拍" : ""].filter(Boolean).join(" ・ ");
    var comments = (d.comments || []).filter(function (c) { return c && c !== h.title; });
    var html = (info ? '<p class="score-info">' + esc(info) + "</p>" : "") +
      (comments.length ? '<div class="score-comments">' + comments.map(function (c) { return "<p>" + esc(c) + "</p>"; }).join("") + "</div>" : "") +
      '<p class="small muted">各列が1拍。「-」は前の音をのばす、「.」は休み、「:3/2」などは音の長さ(拍)です。</p>';
    d.systems.forEach(function (sy) {
      html += '<p class="score-sys">' + esc(sy.label) + "</p>";
      if (!sy.rows) { html += '<pre class="score-raw">' + esc(sy.raw.join("\n")) + "</pre>"; return; }
      var first = parseInt(sy.label, 10) || 1;
      var head = "<tr><th></th>" + sy.rows[0].bars.map(function (b, i) {
        return '<th class="bar-no" colspan="' + b.length + '">' + (first + i) + "</th>";
      }).join("") + "</tr>";
      var body = sy.rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r.part) + "</th>" + r.bars.map(function (b) {
          return b.map(scoreCell).join("").replace(/<td(?: class="([^"]*)")?>([^<]*)<\/td>$/, function (_, c, t) {
            return '<td class="' + ((c ? c + " " : "") + "bar-end") + '">' + t + "</td>";
          });
        }).join("") + "</tr>";
      }).join("");
      html += '<div class="score-scroll"><table class="score-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
    });
    return html;
  }
  function wireScores() {
    app.querySelectorAll("details.score[data-score-src]").forEach(function (det) {
      det.addEventListener("toggle", function () {
        if (!det.open || det.getAttribute("data-loaded")) return;
        det.setAttribute("data-loaded", "1");
        var bodyEl = det.querySelector(".score-body");
        fetch(det.getAttribute("data-score-src")).then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        }).then(function (d) { bodyEl.innerHTML = renderScore(d); })
          .catch(function () { bodyEl.innerHTML = '<p class="small muted">楽譜を読み込めませんでした。</p>'; det.removeAttribute("data-loaded"); });
      });
    });
  }

  function viewMusic(anchor) {
    setNav("music");
    var mp = DATA.music_page || { modes: [], axes: [] };
    var pr = mp.primordial;
    var counts = {};
    DATA.gods.forEach(function (g) { var m = parseMeta(g.song && g.song.meta).mode; if (m) counts[m] = (counts[m] || 0) + 1; });

    var primordial = pr ? pr.songs.map(function (s) {
      var m = parseMeta(s.meta);
      return '<article class="card music-card primordial-card">' +
        '<div class="music-head">' + (s.icon ? '<img class="music-icon" src="' + esc(s.icon) + '" width="72" height="72" alt="">' : "") +
        '<div><p class="music-title">' + "<ruby>" + esc(s.name) + "<rt>" + esc(s.reading) + "</rt></ruby></p>" +
        '<p class="small muted">最初の五柱</p></div></div>' +
        '<h4 class="music-sub">曲のイメージ</h4>' + s.notes.map(function (n) { return "<p>" + esc(n) + "</p>"; }).join("") +
        '<h4 class="music-sub">曲調</h4>' + metaList(s.meta) + modeLine(m.mode) +
        audioTag(s.music, s.name + "の曲") + scoreBlock(s.score, s.name) + "</article>";
    }).join("") : "";

    var modeButtons = '<button type="button" data-mf="" aria-pressed="' + (musicFilter == null) + '">すべて</button>' +
      mp.modes.map(function (md) {
        return '<button type="button" data-mf="' + esc(md.name) + '" aria-pressed="' + (musicFilter === md.name) + '">' +
          esc(md.name) + "(" + (counts[md.name] || 0) + ")</button>";
      }).join("");
    var list = DATA.gods.filter(function (g) {
      return g.song && (musicFilter == null || parseMeta(g.song.meta).mode === musicFilter);
    });
    var godSongs = list.map(function (g) {
      var s = g.song, m = parseMeta(s.meta);
      return '<article class="card music-card">' +
        '<div class="music-head"><a class="music-thumb" href="#/gods/' + g.code + '">' + portrait(g) + "</a>" +
        '<div><p class="music-title">♪ ' + esc(s.title) + "</p>" +
        '<p class="music-god"><a href="#/gods/' + g.code + '">' + nameRuby(g) + "</a> " +
        '<span class="small muted">' + esc(g.solvent) + " ・ " + g.code + "</span></p>" +
        (s.classical_note ? '<p class="song-note">' + esc(s.classical_note) + "</p>" : "") + "</div></div>" +
        '<h4 class="music-sub">曲のイメージ</h4>' + (s.notes || []).map(function (n) { return "<p>" + esc(n) + "</p>"; }).join("") +
        '<h4 class="music-sub">曲調</h4>' + metaList(s.meta) + modeLine(m.mode) +
        audioTag(g.music, g.god + "のテーマ曲「" + s.title + "」") + scoreBlock(s.score, g.god) + "</article>";
    }).join("");

    var modes = mp.modes.map(function (md) {
      return '<div class="card mode-card"><p class="music-title"><ruby>' + esc(md.name) + "<rt>" + esc(md.reading) + "</rt></ruby></p>" +
        '<p class="small"><b>' + esc(md.scale) + "</b>の調子 ・ 主音 " + esc(md.tonic) + "</p>" +
        "<p>" + esc(md.character) + "</p>" +
        (md.examples ? '<p class="small muted">古典曲の例: ' + esc(md.examples) + "</p>" : "") +
        '<p class="small"><button type="button" class="linklike" data-mf="' + esc(md.name) + '" data-jump="1">このサイトの' + esc(md.name) + "の曲(" +
        (counts[md.name] || 0) + (md.name === "壱越調" && pr ? "+最初の五柱 " + pr.songs.length : "") + "曲)を見る</button></p></div>";
    }).join("");

    render(
      '<div class="music-page"><p class="eyebrow" style="padding-top:26px">楽曲</p><h1>神々の楽曲</h1>' +
      '<div class="prose"><p>' + esc(mp.lead || "") + "</p></div>" +
      '<nav class="music-toc" aria-label="楽曲ページの目次"><a href="#/music/primordial">最初の五柱の曲</a>' +
      '<a href="#/music/gods">三十二柱のテーマ曲</a><a href="#/music/modes">調子の解説</a><a href="#/music/axes">性格と曲調</a></nav>' +
      (pr ? '<h2 id="music-primordial">最初の五柱の曲</h2><div class="prose">' + pr.lead.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
        (pr.common ? '<p class="small"><b>ひと組としての共通点</b>: ' + esc(pr.common) + "</p>" : "") + "</div>" +
        '<div class="music-grid">' + primordial + "</div>" : "") +
      '<h2 id="music-gods">三十二柱のテーマ曲</h2>' +
      '<div class="filters" role="group" aria-label="調子でしぼりこむ">' + modeButtons + "</div>" +
      '<p class="small muted">' + list.length + " 曲</p>" +
      '<div class="music-grid">' + godSongs + "</div>" +
      '<h2 id="music-modes">調子の解説</h2><div class="prose"><p>' + esc(mp.modes_lead || "") + "</p></div>" +
      '<div class="mode-grid">' + modes + "</div>" +
      (mp.modes_note ? '<p class="small muted">' + esc(mp.modes_note) + "</p>" : "") +
      '<h2 id="music-axes">性格と曲調</h2><div class="prose"><p>三十二柱のテーマ曲は、神様の性格5軸(コード)から曲調を決めています。</p><dl class="profile">' +
      (mp.axes || []).map(function (a) { return "<dt>" + esc(a.label) + "</dt><dd>" + esc(a.text) + "</dd>"; }).join("") +
      "</dl></div></div>",
      "楽曲");
    app.querySelectorAll("[data-mf]").forEach(function (b) {
      b.addEventListener("click", function () {
        musicFilter = b.getAttribute("data-mf") || null;
        var jump = b.hasAttribute("data-jump");
        var y = window.scrollY;
        viewMusic(jump ? "gods" : null);
        if (!jump) window.scrollTo({ top: y });
      });
    });
    var el = anchor && document.getElementById("music-" + anchor);
    if (el) el.scrollIntoView(); else if (!anchor) window.scrollTo({ top: 0 });
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
    else if (parts[0] === "myth") {
      // 同じ神話ページの中の移動は、描き直さずにその位置へ送る
      if (app.querySelector(".myth-page")) scrollToMyth(parts[1]);
      else viewMyth(parts[1]);
    }
    else if (parts[0] === "music") {
      // 同じ楽曲ページの中の移動は、描き直さずにその位置へ送る(再生中の曲を止めない)
      var target = parts[1] && document.getElementById("music-" + parts[1]);
      if (app.querySelector(".music-page") && target) target.scrollIntoView();
      else viewMusic(parts[1]);
    }
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
