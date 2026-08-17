/* ============================================================
   RONI GAMING - behaviour
   No dependencies. No scroll listeners (IntersectionObserver only).
   Honors prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var games = window.RONI_GAMES || [];
  // Games marked `hidden: true` are kept out of every public listing
  // (home grid, portfolio, "more games"). They stay reachable only via
  // their direct link, e.g. /game/<slug>.
  var publicGames = games.filter(function (g) { return !g.hidden; });
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.addEventListener("DOMContentLoaded", function () {
    setYear();
    initHeroVideo();
    initNav();
    renderFeatured();
    renderPortfolio();
    renderGameDetail();
    initBuild();
    initReveal();
    initModal();
    initLightbox();
    initSound();
    initMagnetic();
    initSpotlight();
    initContactForm();
  });

  /* ---------- build: scroll-assembled slot wireframe ---------- */
  function slotSVG() {
    var GRID_X = 48, GRID_Y = 104, GRID_W = 284, GRID_H = 210;
    var cols = 5, rows = 3;
    var colW = GRID_W / cols, rowH = GRID_H / rows;
    var s = "";

    // helpers
    function cx(i) { return GRID_X + colW * (i + 0.5); }
    function cy(j) { return GRID_Y + rowH * (j + 0.5); }

    // reels: window + separators
    var reels = '<rect data-draw pathLength="1" x="' + GRID_X + '" y="' + GRID_Y + '" width="' + GRID_W + '" height="' + GRID_H + '" rx="12"/>';
    for (var i = 1; i < cols; i++) {
      var x = GRID_X + colW * i;
      reels += '<line data-draw pathLength="1" x1="' + x + '" y1="' + GRID_Y + '" x2="' + x + '" y2="' + (GRID_Y + GRID_H) + '"/>';
    }
    for (var j = 1; j < rows; j++) {
      var y = GRID_Y + rowH * j;
      reels += '<line data-draw pathLength="1" x1="' + GRID_X + '" y1="' + y + '" x2="' + (GRID_X + GRID_W) + '" y2="' + y + '"/>';
    }

    // symbols: simple outline shapes per cell
    var sym = "";
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < rows; r++) {
        var X = cx(c), Y = cy(r), t = (c + r) % 3;
        if (t === 0) {
          sym += '<circle data-draw pathLength="1" cx="' + X + '" cy="' + Y + '" r="14"/>';
        } else if (t === 1) {
          sym += '<rect data-draw pathLength="1" x="' + (X - 12) + '" y="' + (Y - 12) + '" width="24" height="24" rx="4" transform="rotate(45 ' + X + ' ' + Y + ')"/>';
        } else {
          sym += '<polygon data-draw pathLength="1" points="' + X + ',' + (Y - 15) + ' ' + (X + 14) + ',' + (Y + 11) + ' ' + (X - 14) + ',' + (Y + 11) + '"/>';
        }
      }
    }

    // paylines: one straight middle, one zigzag
    function line(rowPattern) {
      var pts = rowPattern.map(function (rr, idx) { return cx(idx) + "," + cy(rr); }).join(" ");
      return '<polyline data-draw pathLength="1" points="' + pts + '"/>';
    }
    var pay = line([1, 1, 1, 1, 1]) + line([0, 2, 0, 2, 0]);

    // ui: balance bars, bet controls, spin button
    var ui =
      '<rect data-draw pathLength="1" x="48" y="334" width="150" height="22" rx="11"/>' +
      '<rect data-draw pathLength="1" x="212" y="334" width="68" height="22" rx="11"/>' +
      '<rect data-draw pathLength="1" x="48" y="430" width="44" height="44" rx="14"/>' +
      '<rect data-draw pathLength="1" x="100" y="430" width="86" height="44" rx="14"/>' +
      '<rect data-draw pathLength="1" x="194" y="430" width="44" height="44" rx="14"/>' +
      '<circle data-draw pathLength="1" cx="300" cy="452" r="40"/>' +
      '<polygon data-draw pathLength="1" points="291,438 291,466 314,452"/>';

    var frame =
      '<rect data-draw pathLength="1" x="24" y="24" width="332" height="492" rx="26"/>' +
      '<line data-draw pathLength="1" x1="24" y1="84" x2="356" y2="84"/>' +
      '<circle data-draw pathLength="1" cx="50" cy="54" r="6"/>';

    var codeLines = [
      "const reels = [5, 3];",
      "const ways  = 243;",
      "",
      "function spin(bet) {",
      "  const g = draw(reels);",
      "  return evaluate(g, lines)",
      "    .reduce((s, w) =>",
      "      s + w.pay * bet, 0);",
      "}",
      "",
      "rtp = simulate(spin, 1e7);",
      "// rtp -> 0.962"
    ];
    var code = codeLines.map(function (ln, k) {
      return '<text xml:space="preserve" x="62" y="' + (150 + k * 23) + '">' + esc(ln) + "</text>";
    }).join("");

    var win = '<circle data-draw data-win-ring pathLength="1" cx="300" cy="452" r="52"/>';

    return (
      '<svg class="slot" viewBox="0 0 380 540" role="img" aria-label="Outline of a slot game assembling step by step" ' +
        'fill="none" stroke="url(#slotGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<defs><linearGradient id="slotGrad" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#1fbce6"/><stop offset="1" stop-color="#2bd07d"/>' +
        '</linearGradient></defs>' +
        '<g class="slot__layer" data-min="1">' + frame + '</g>' +
        '<g class="slot__layer slot__code" data-min="1" data-max="1">' + code + '</g>' +
        '<g class="slot__layer" data-min="2">' + reels + '</g>' +
        '<g class="slot__layer slot__symbols" data-min="3">' + sym + '</g>' +
        '<g class="slot__layer slot__paylines" data-min="4">' + pay + '</g>' +
        '<g class="slot__layer" data-min="5">' + ui + '</g>' +
        '<g class="slot__layer slot__win" data-min="5">' + win + '</g>' +
      '</svg>'
    );
  }

  function initBuild() {
    var section = document.getElementById("build");
    if (!section) return;
    var mount = document.getElementById("slot-mount");
    if (mount) mount.innerHTML = slotSVG();

    var stage = section.querySelector(".build__visual");
    var steps = Array.prototype.slice.call(section.querySelectorAll(".build__step"));
    var layers = Array.prototype.slice.call(section.querySelectorAll(".slot__layer"));
    var symLayer = section.querySelector(".slot__symbols");
    var payLayer = section.querySelector(".slot__paylines");
    var winLayer = section.querySelector(".slot__win");
    var railFill = section.querySelector(".rail__fill");
    var rail = section.querySelector(".rail");

    // run the rail from the first node to the last node (not past it)
    function positionRail() {
      if (!rail || steps.length < 2) return;
      var first = steps[0], last = steps[steps.length - 1];
      var top = first.offsetTop + first.offsetHeight / 2;
      var bottom = last.offsetTop + last.offsetHeight / 2;
      rail.style.top = top + "px";
      rail.style.bottom = "auto";
      rail.style.height = (bottom - top) + "px";
    }
    positionRail();
    window.addEventListener("resize", positionRail);

    // does the browser support scroll-driven CSS animations?
    var supportsSDA = !reduceMotion && window.CSS && CSS.supports && CSS.supports("animation-timeline: view()");

    // the assembled slot does a quick demo spin + win the first time you reach the last step
    var spinning = false;
    function payoff() {
      if (spinning || !symLayer) return;
      spinning = true;
      symLayer.classList.add("is-spinning");
      Sound.tick();
      setTimeout(function () { Sound.tick(); }, 220);
      setTimeout(function () {
        symLayer.classList.remove("is-spinning");
        if (payLayer) payLayer.classList.add("is-won");
        if (winLayer) winLayer.classList.add("is-won");
        Sound.win();
      }, 900);
    }
    function resetPayoff() {
      spinning = false;
      if (payLayer) payLayer.classList.remove("is-won");
      if (winLayer) winLayer.classList.remove("is-won");
    }

    function setLayers(idx) {
      layers.forEach(function (l) {
        var min = +l.getAttribute("data-min");
        var maxAttr = l.getAttribute("data-max");
        var max = maxAttr === null ? Infinity : +maxAttr;
        l.classList.toggle("is-on", idx >= min && idx <= max);
      });
    }

    if (reduceMotion || !("IntersectionObserver" in window)) {
      layers.forEach(function (l) {
        if (l.getAttribute("data-max") === null) l.classList.add("is-on"); // final state, no code overlay
      });
      steps.forEach(function (s) { s.classList.add("is-active"); });
      return;
    }

    if (supportsSDA) {
      document.documentElement.classList.add("js-sda"); // CSS scroll-timeline drives the draw
    } else {
      setLayers(1); // stepped fallback
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var idx = +e.target.getAttribute("data-step");
        if (stage) stage.dataset.active = idx;
        steps.forEach(function (s) { s.classList.toggle("is-active", s === e.target); });
        if (!supportsSDA) {
          setLayers(idx);
          if (railFill) railFill.style.transform = "scaleY(" + (idx / steps.length) + ")";
        }
        if (idx >= steps.length) payoff(); else if (idx <= 1) resetPayoff();
      });
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    steps.forEach(function (s) { io.observe(s); });
  }

  /* ---------- footer year ---------- */
  function setYear() {
    var el = document.querySelectorAll("[data-year]");
    el.forEach(function (n) { n.textContent = new Date().getFullYear(); });
  }

  /* ---------- hero background video ---------- */
  function initHeroVideo() {
    var v = document.querySelector(".hero__video");
    if (!v) return;
    if (reduceMotion) { v.remove(); return; }   // honor reduced motion, skip download
    v.play().catch(function () {});             // some browsers need an explicit nudge
  }

  /* ---------- nav ---------- */
  function initNav() {
    var nav = document.querySelector(".nav");
    var burger = document.querySelector(".nav__burger");
    var menu = document.querySelector(".nav__menu");

    if (nav) {
      var io = new IntersectionObserver(function (entries) {
        nav.classList.toggle("is-scrolled", !entries[0].isIntersecting);
      }, { rootMargin: "-72px 0px 0px 0px" });
      var sentinel = document.createElement("div");
      sentinel.setAttribute("aria-hidden", "true");
      document.body.prepend(sentinel);
      io.observe(sentinel);
    }

    if (burger && menu) {
      burger.addEventListener("click", function () {
        var open = menu.classList.toggle("is-open");
        burger.setAttribute("aria-expanded", String(open));
      });
      menu.addEventListener("click", function (e) {
        if (e.target.closest("a")) { menu.classList.remove("is-open"); burger.setAttribute("aria-expanded", "false"); }
      });
    }
  }

  /* ---------- featured games (home) ---------- */
  function gcardHTML(g) {
    return (
      '<article class="gcard reveal">' +
        '<a class="gcard__art" href="/game/' + g.slug + '" aria-label="' + esc(g.title) + ' details">' +
          (g.video
            ? '<video class="gcard__media" autoplay muted loop playsinline preload="metadata" poster="' + g.poster + '" style="view-transition-name:poster-' + g.slug + '"><source src="' + g.video + '" type="video/mp4"></video>'
            : '<img class="gcard__media" src="' + g.poster + '" alt="' + esc(g.title) + ' poster art" loading="lazy" style="view-transition-name:poster-' + g.slug + '">') +
          '<span class="gcard__play" aria-hidden="true">' + ICON.play + '</span>' +
        '</a>' +
        '<div>' +
          '<a class="gcard__title" href="/game/' + g.slug + '">' + esc(g.title) + '</a>' +
          '<p class="gcard__tag">' + esc(g.tagline) + '</p>' +
        '</div>' +
        '<div class="gcard__row">' +
          '<span><b>' + esc(g.rtp) + '</b> RTP</span>' +
          '<span><b>' + esc(g.volatility) + '</b> vol</span>' +
          '<span><b>' + esc(g.maxWin) + '</b> max</span>' +
        '</div>' +
      '</article>'
    );
  }
  function comingSoonHTML() {
    return (
      '<article class="gcard gcard--soon reveal">' +
        '<div class="gcard__art gcard__art--soon">' +
          '<span class="soon__badge">Coming soon</span>' +
        '</div>' +
        '<div>' +
          '<span class="gcard__title">New titles in the works</span>' +
          '<p class="gcard__tag">Fresh slots and crash hybrids are in production - check back soon to play the demos.</p>' +
        '</div>' +
      '</article>'
    );
  }
  function renderFeatured() {
    var grid = document.getElementById("games-grid");
    if (!grid) return;
    grid.innerHTML = publicGames.length ? publicGames.map(gcardHTML).join("") : comingSoonHTML();
    setupCarouselDots(grid);
  }

  /* ---------- carousel dots: signal "there's more to swipe" ---------- */
  function setupCarouselDots(grid) {
    var old = grid.parentNode.querySelector(".games-dots");
    if (old) old.parentNode.removeChild(old);

    var cards = Array.prototype.slice.call(grid.querySelectorAll(".gcard"));
    if (cards.length < 2) return;

    var dots = document.createElement("div");
    dots.className = "games-dots";
    dots.setAttribute("role", "tablist");
    dots.setAttribute("aria-label", "Game carousel position");

    cards.forEach(function (card, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "games-dot" + (idx === 0 ? " is-active" : "");
      b.setAttribute("aria-label", "Go to game " + (idx + 1));
      b.addEventListener("click", function () {
        card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      });
      dots.appendChild(b);
    });
    grid.parentNode.insertBefore(dots, grid.nextSibling);

    var btns = Array.prototype.slice.call(dots.querySelectorAll(".games-dot"));

    // IntersectionObserver only (no scroll listeners) — highlight the card in view.
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && e.intersectionRatio > 0.55) {
            var idx = cards.indexOf(e.target);
            if (idx < 0) return;
            btns.forEach(function (b, j) { b.classList.toggle("is-active", j === idx); });
          }
        });
      }, { root: grid, threshold: [0.55, 0.8] });
      cards.forEach(function (c) { io.observe(c); });
    }

    // Dots only matter when the row actually overflows (i.e. on narrow screens).
    function updateVisibility() {
      dots.style.display = grid.scrollWidth > grid.clientWidth + 4 ? "" : "none";
    }
    updateVisibility();
    window.addEventListener("resize", updateVisibility);
  }
  function renderPortfolio() {
    var grid = document.getElementById("portfolio-grid");
    if (!grid) return;
    grid.innerHTML = publicGames.length ? publicGames.map(gcardHTML).join("") : comingSoonHTML();
  }

  /* ---------- game detail page ---------- */
  function renderGameDetail() {
    var root = document.getElementById("game-root");
    if (!root) return;

    // clean URL: /game/<slug>  (falls back to ?game=<slug> for old links / local testing)
    var pm = location.pathname.replace(/\/+$/, "").match(/\/game\/([^/]+)$/);
    var slug = pm ? decodeURIComponent(pm[1]) : new URLSearchParams(location.search).get("game");
    // Direct slug always resolves (incl. hidden games — this is the private link).
    // With no slug, fall back to the first public game only.
    var g = games.find(function (x) { return x.slug === slug; }) || publicGames[0];
    if (!g) return;

    document.title = g.title + " - RoniGaming";
    var more = publicGames.filter(function (x) { return x.slug !== g.slug; }).slice(0, 4);

    root.innerHTML =
      '<section class="ghero wrap">' +
        '<div class="ghero__art reveal"><img src="' + g.poster + '" alt="' + esc(g.title) + ' key art" style="view-transition-name:poster-' + g.slug + '"></div>' +
        '<div class="reveal">' +
          '<span class="hero__role"><span class="line"></span> ' + esc(g.category || "Slot game") + '</span>' +
          '<h1 class="display">' + esc(g.title) + '</h1>' +
          '<p class="lead">' + esc(g.description) + '</p>' +
          '<div class="feature-chips">' +
            g.features.map(function (f) { return '<span class="chip">' + esc(f) + '</span>'; }).join("") +
          '</div>' +
          '<div class="ghero__cta">' +
            (g.demoUrl
              ? '<a class="btn btn--primary btn--lg" href="' + esc(g.demoUrl) + '" target="_blank" rel="noopener">' + ICON.play + ' Play demo</a>'
              : '<button class="btn btn--primary btn--lg" data-demo="" data-title="' + esc(g.title) + '">' + ICON.play + ' Play demo</button>') +
            (g.sheet ? '<a class="btn btn--ghost btn--lg" href="' + esc(g.sheet) + '" target="_blank" rel="noopener">Game sheet</a>' : "") +
            '<a class="btn btn--ghost btn--lg" href="/#games">All games</a>' +
          '</div>' +
          '<div class="specs">' +
            spec(g.rtp, "RTP") + spec(g.volatility, "Volatility") + spec(g.maxWin, "Max win") +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="section wrap">' +
        '<div class="shead"><h2 class="display">Inside the game</h2><p class="lead">A look at the moments the game is built around - the screens, the action, and the live tension of a round.</p></div>' +
        '<div class="gshots reveal">' +
          g.shots.map(function (s) { return '<img src="' + s + '" alt="' + esc(g.title) + ' screenshot" loading="lazy">'; }).join("") +
        '</div>' +
      '</section>' +
      (more.length ? (
      '<section class="section--tight wrap">' +
        '<div class="shead"><h2 class="display">More from the studio</h2></div>' +
        '<div class="games" id="more-games">' +
          more.map(function (m) {
            return (
              '<article class="gcard">' +
                '<a class="gcard__art" href="/game/' + m.slug + '">' +
                  '<img src="' + m.poster + '" alt="' + esc(m.title) + ' poster" loading="lazy" style="view-transition-name:poster-' + m.slug + '">' +
                  '<span class="gcard__play" aria-hidden="true">' + ICON.play + '</span>' +
                '</a>' +
                '<div><a class="gcard__title" href="/game/' + m.slug + '">' + esc(m.title) + '</a>' +
                '<p class="gcard__tag">' + esc(m.tagline) + '</p></div>' +
              '</article>'
            );
          }).join("") +
        '</div>' +
      '</section>') : "");
  }

  function spec(value, label) {
    return '<div class="spec"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    var nodes = document.querySelectorAll(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.18 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- demo modal ---------- */
  function initModal() {
    var modal = document.getElementById("demo-modal");
    if (!modal) return;
    var frame = modal.querySelector(".modal__frame");
    var fallback = modal.querySelector(".modal__fallback");
    var fbTitle = modal.querySelector("[data-fb-title]");
    var closeEls = modal.querySelectorAll("[data-close]");
    var lastFocus = null;

    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-demo]");
      if (!trigger) return;
      e.preventDefault();
      open(trigger.getAttribute("data-demo"), trigger.getAttribute("data-title") || "Demo");
      lastFocus = trigger;
    });

    function open(url, title) {
      if (url) {
        frame.src = url;
        frame.style.display = "block";
        fallback.style.display = "none";
      } else {
        frame.removeAttribute("src");
        frame.style.display = "none";
        fallback.style.display = "grid";
        if (fbTitle) fbTitle.textContent = title;
      }
      modal.classList.add("is-open");
      document.body.style.overflow = "hidden";
      var c = modal.querySelector(".modal__close");
      if (c) c.focus();
    }

    function close() {
      modal.classList.remove("is-open");
      frame.removeAttribute("src");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }

    closeEls.forEach(function (el) { el.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) close();
    });
  }

  /* ---------- sound (WebAudio, synthesised, no files) ---------- */
  var Sound = (function () {
    var ctx = null, enabled = true;
    try { enabled = localStorage.getItem("roni-sound") !== "off"; } catch (e) {}
    function ac() {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx && AC) ctx = new AC();
      if (ctx && ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function blip(freq, dur, type, gain) {
      if (!enabled) return;
      var c = ac(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      o.connect(g); g.connect(c.destination);
      var t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain || 0.04, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.start(t); o.stop(t + (dur || 0.08) + 0.02);
    }
    return {
      tick: function () { blip(440 + Math.random() * 120, 0.05, "square", 0.025); },
      win: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { blip(f, 0.18, "triangle", 0.045); }, i * 75); }); },
      isEnabled: function () { return enabled; },
      toggle: function () {
        enabled = !enabled;
        try { localStorage.setItem("roni-sound", enabled ? "on" : "off"); } catch (e) {}
        if (enabled) { ac(); blip(660, 0.06, "square", 0.03); }
        return enabled;
      }
    };
  })();

  function initSound() {
    var btn = document.querySelector("[data-sound-toggle]");
    if (!btn) return;
    function paint() {
      btn.innerHTML = Sound.isEnabled() ? ICON.soundOn : ICON.soundOff;
      btn.setAttribute("aria-pressed", String(Sound.isEnabled()));
      btn.setAttribute("aria-label", Sound.isEnabled() ? "Mute sound" : "Unmute sound");
    }
    paint();
    btn.addEventListener("click", function () { Sound.toggle(); paint(); });
  }

  /* ---------- magnetic CTAs ---------- */
  function initMagnetic() {
    if (reduceMotion || !window.matchMedia("(hover: hover)").matches) return;
    document.querySelectorAll(".btn--primary, [data-magnetic]").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var mx = e.clientX - (r.left + r.width / 2);
        var my = e.clientY - (r.top + r.height / 2);
        el.style.transform = "translate(" + (mx * 0.22).toFixed(1) + "px," + (my * 0.32).toFixed(1) + "px)";
      });
      el.addEventListener("pointerleave", function () { el.style.transform = ""; });
    });
  }

  /* ---------- spotlight on game cards ---------- */
  function initSpotlight() {
    if (!window.matchMedia("(hover: hover)").matches) return;
    document.querySelectorAll(".gcard__art").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
        el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      });
    });
  }

  /* ---------- contact form (Formspree, with full states) ---------- */
  var FORM_ENDPOINT = "https://formspree.io/f/xjgdpaya"; // submissions -> ronigames.hq@gmail.com

  function initContactForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;
    var statusEl = form.querySelector("[data-form-status]");
    var fields = Array.prototype.slice.call(form.querySelectorAll("input, textarea"));

    function setError(field, msg) {
      var wrap = field.closest(".field");
      if (wrap) wrap.classList.toggle("has-error", !!msg);
      var err = wrap && wrap.querySelector(".field__err");
      if (err) err.textContent = msg || "";
    }
    function validate() {
      var ok = true;
      fields.forEach(function (f) {
        var v = f.value.trim();
        var msg = "";
        if (!v) msg = "This field is required.";
        else if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) msg = "Enter a valid email.";
        if (msg) ok = false;
        setError(f, msg);
      });
      return ok;
    }
    fields.forEach(function (f) {
      f.addEventListener("input", function () { if (f.closest(".field").classList.contains("has-error")) setError(f, ""); });
    });

    function status(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.className = "cform__status" + (kind ? " " + kind : "");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate()) { status("Please fix the highlighted fields.", "bad"); return; }

      var data = {};
      fields.forEach(function (f) { data[f.name] = f.value.trim(); });

      // No endpoint configured yet: fall back to a prefilled email so the form still works.
      if (!FORM_ENDPOINT) {
        var body = encodeURIComponent("From: " + data.name + " (" + data.email + ")\n\n" + data.message);
        window.location.href = "mailto:ronigames.hq@gmail.com?subject=" + encodeURIComponent("New project enquiry") + "&body=" + body;
        status("Opening your email app. You can also write to ronigames.hq@gmail.com directly.", "ok");
        return;
      }

      form.classList.add("is-loading");
      status("Sending...", "");
      fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then(function (res) {
        form.classList.remove("is-loading");
        if (res.ok) { form.reset(); status("Thanks. I will get back to you shortly.", "ok"); }
        else { status("Something went wrong. Please email ronigames.hq@gmail.com directly.", "bad"); }
      }).catch(function () {
        form.classList.remove("is-loading");
        status("Network error. Please email ronigames.hq@gmail.com directly.", "bad");
      });
    });
  }

  /* ---------- lightbox for game screenshots ---------- */
  function initLightbox() {
    var imgs = Array.prototype.slice.call(document.querySelectorAll(".gshots img"));
    if (!imgs.length) return;

    var box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Screenshot viewer");
    box.innerHTML =
      '<button class="lightbox__close" aria-label="Close">' + ICON.close + "</button>" +
      '<button class="lightbox__btn lightbox__prev" aria-label="Previous">' + ICON.chevL + "</button>" +
      '<img class="lightbox__img" alt="">' +
      '<button class="lightbox__btn lightbox__next" aria-label="Next">' + ICON.chevR + "</button>" +
      '<div class="lightbox__count"></div>';
    document.body.appendChild(box);

    var big = box.querySelector(".lightbox__img");
    var count = box.querySelector(".lightbox__count");
    var i = 0;

    function show(n) {
      i = (n + imgs.length) % imgs.length;
      big.src = imgs[i].currentSrc || imgs[i].src;
      big.alt = imgs[i].alt;
      count.textContent = (i + 1) + " / " + imgs.length;
    }
    function open(n) { show(n); box.classList.add("is-open"); document.body.style.overflow = "hidden"; }
    function close() { box.classList.remove("is-open"); document.body.style.overflow = ""; }

    imgs.forEach(function (im, idx) { im.addEventListener("click", function () { open(idx); }); });
    box.querySelector(".lightbox__prev").addEventListener("click", function (e) { e.stopPropagation(); show(i - 1); });
    box.querySelector(".lightbox__next").addEventListener("click", function (e) { e.stopPropagation(); show(i + 1); });
    box.querySelector(".lightbox__close").addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(i - 1);
      else if (e.key === "ArrowRight") show(i + 1);
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var ICON = {
    play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    close: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chevL: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    chevR: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    soundOn: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
    soundOff: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>'
  };
})();
