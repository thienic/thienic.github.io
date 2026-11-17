/* Trang Kiến thức: "tờ báo" (trang nhất + trình đọc bài) và sơ đồ tương tác.
   - Chữ của các bài nằm trong phần đã mã hóa (kien-thuc.private.html). File này chỉ dựng giao diện
     SAU KHI người đọc mở khóa (theo dõi #edu-lock-root), và dọn dẹp khi bấm "Khóa lại".
   - Thêm sơ đồ mới: viết hàm mountXxx(host) rồi khai báo trong DIAGRAMS (cuối phần sơ đồ).
   - Không đụng tới menu, banner, chân trang hay logic khóa PIN (nằm trong assets/site.js). */
(function () {
  'use strict';

  var lockRoot = document.getElementById('edu-lock-root');
  if (!lockRoot) return;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var cleanups = [];          // việc cần dọn khi khóa lại

  /* ---------- Tiện ích ---------- */
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Đọc 1 byte người dùng gõ: 0x6B, 107, 01101011 hoặc 1 ký tự (A → 0x41). Sai định dạng → null
  function parseByte(str) {
    str = String(str).trim();
    if (/^0x[0-9a-f]{1,2}$/i.test(str)) return parseInt(str, 16);
    if (/^[01]{8}$/.test(str)) return parseInt(str, 2);
    if (/^\d{1,3}$/.test(str) && Number(str) <= 255) return Number(str);
    if (str.length === 1 && str.charCodeAt(0) < 256) return str.charCodeAt(0);
    return null;
  }
  function hex2(v) { return '0x' + ('0' + v.toString(16).toUpperCase()).slice(-2); }
  function navHeight() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 68;
  }
  var ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
    step: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5v11l7-5.5zM10.5 2.5h3v11h-3z"/></svg>',
    restart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 5.4 6.5h-1.8A3.8 3.8 0 1 1 8 4.2V6.5l3.3-3L8 .5z"/></svg>'
  };

  /* =========================================================
     BỘ ĐIỀU KHIỂN SƠ ĐỒ DÙNG CHUNG
     createPlayer(host, { steps: [{ text, state, dur }], apply(state) })
       - ▶/⏸, ⏭ bước tiếp, ↺ chạy lại, tốc độ 0.5× / 1× / 2×, phụ đề "Bước k/n: …"
       - Tự phát khi sơ đồ vào màn hình, tạm dừng khi ra khỏi màn hình (IntersectionObserver)
       - Người dùng bật "giảm chuyển động" (prefers-reduced-motion): không tự phát, chỉ chạy khi bấm
     Trả về: { manual(text), speed(), visible(), destroy() }
     ========================================================= */
  function createPlayer(host, opts) {
    var steps = opts.steps;     // sơ đồ có thể dựng lại danh sách bước (số bước đổi) → luôn đọc steps.length
    var i = 0, playing = false, userPaused = false, speed = 1, elapsed = 0, raf = 0, last = 0, visible = false;

    var bar = h('div', 'np-ctrlbar');
    var ctrl = h('div', 'np-ctrl');
    var bPlay = h('button', 'np-btn'); bPlay.type = 'button';
    var bStep = h('button', 'np-btn'); bStep.type = 'button'; bStep.innerHTML = ICON.step;
    bStep.setAttribute('aria-label', 'Bước tiếp'); bStep.title = 'Bước tiếp';
    var bRestart = h('button', 'np-btn'); bRestart.type = 'button'; bRestart.innerHTML = ICON.restart;
    bRestart.setAttribute('aria-label', 'Chạy lại từ đầu'); bRestart.title = 'Chạy lại';
    ctrl.appendChild(bPlay); ctrl.appendChild(bStep); ctrl.appendChild(bRestart);
    var spd = h('div', 'np-speed'); spd.setAttribute('role', 'group'); spd.setAttribute('aria-label', 'Tốc độ');
    [0.5, 1, 2].forEach(function (v) {
      var b = h('button', 'np-btn', v + '×'); b.type = 'button'; b.dataset.speed = v;
      b.setAttribute('aria-pressed', String(v === 1));
      spd.appendChild(b);
    });
    var cap = h('p', 'np-caption'); cap.setAttribute('aria-live', 'polite');
    bar.appendChild(ctrl); bar.appendChild(spd); bar.appendChild(cap);
    host.appendChild(bar);
    var stageEl = host.querySelector('.np-stage');   // gợi ý vuốt ngang (chỉ hiện trên điện thoại)
    if (stageEl) stageEl.insertAdjacentHTML('afterend', '<p class="np-swipe" aria-hidden="true">← Vuốt ngang để xem hết sơ đồ →</p>');

    function caption(k) {
      cap.innerHTML = '<b>Bước ' + (k + 1) + '/' + steps.length + '</b> ' + esc(steps[k].text);
    }
    function show(k) {
      var n = steps.length;
      i = ((k % n) + n) % n;
      elapsed = 0;
      opts.apply(steps[i].state);
      caption(i);
    }
    function loop(now) {
      raf = 0;
      if (!playing) return;
      elapsed += Math.min(100, now - last) * speed;
      last = now;
      if (elapsed >= (steps[i].dur || 3200)) show(i + 1);
      raf = requestAnimationFrame(loop);
    }
    function sync() {
      bPlay.innerHTML = playing ? ICON.pause : ICON.play;
      bPlay.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát');
      bPlay.title = playing ? 'Tạm dừng' : 'Phát';
    }
    function play() {
      if (playing) return;
      playing = true; userPaused = false; last = performance.now();
      raf = requestAnimationFrame(loop);
      sync();
    }
    function pause(byUser) {
      if (byUser) userPaused = true;
      playing = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      sync();
    }
    bPlay.addEventListener('click', function () {
      if (playing) pause(true);
      else { if (/Bạn đang tự thử/.test(cap.textContent)) show(i); play(); }
    });
    bStep.addEventListener('click', function () { pause(true); show(i + 1); });
    bRestart.addEventListener('click', function () { show(0); play(); });
    spd.addEventListener('click', function (e) {
      var b = e.target.closest('[data-speed]');
      if (!b) return;
      speed = Number(b.dataset.speed);
      Array.prototype.forEach.call(spd.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });

    var io = null;
    if (hasIO) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          visible = en.isIntersecting;
          if (visible && !userPaused && !reduceMotion) play();
          else if (!visible) pause(false);
        });
      }, { threshold: 0.35 });
      io.observe(host);
    } else visible = true;

    show(0);
    sync();
    return {
      manual: function (text) {            // người đọc tự bấm thử: dừng phần trình diễn
        pause(true);
        cap.innerHTML = '<b>Bạn đang tự thử</b> ' + esc(text) + ' <span style="color:var(--text-faint)">— bấm ▶ để xem lại phần trình diễn.</span>';
      },
      speed: function () { return speed; },
      visible: function () { return visible; },
      playing: function () { return playing; },
      progress: function () { return Math.min(1, elapsed / (steps[i].dur || 3200)); },   // tiến độ bước hiện tại 0…1
      restart: function () { show(0); play(); },
      destroy: function () { pause(false); if (io) io.disconnect(); }
    };
  }

  /* =========================================================
     SƠ ĐỒ 1 — GPIO: bên trong một chân (thanh ghi, cặp MOSFET, bộ đệm vào, pull-up) + mạch ngoài
     ========================================================= */
  function mountGpio(host) {
    var zig = function (x, y) { return 'M' + x + ' ' + y + ' l9 4.5 l-18 9 l18 9 l-18 9 l18 9 l-18 9 l9 4.5'; };   // điện trở dài 54px
    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 420" role="img" aria-label="Sơ đồ bên trong một chân GPIO: thanh ghi, cặp MOSFET P và N, bộ đệm đầu vào, điện trở kéo lên và mạch ngoài đổi theo chế độ">' +
        '<defs><filter id="np-gpio-glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="7"/></filter></defs>' +
        '<rect class="np-chip" x="12" y="18" width="458" height="384" rx="14"/>' +
        '<text class="np-t-dim" x="28" y="44">BÊN TRONG CHIP</text>' +
        // ray nguồn & đất
        '<line class="np-vcc" x1="320" y1="56" x2="748" y2="56"/><text class="np-vcc-t" x="748" y="44" text-anchor="end">VDD 3.3 V</text>' +
        '<line class="np-gnd" x1="320" y1="384" x2="748" y2="384"/><text class="np-gnd-t" x="748" y="406" text-anchor="end">GND 0 V</text>' +
        // thanh ghi
        '<rect class="np-box-r" x="20" y="74" width="180" height="230" rx="10"/><text class="np-t-dim" x="34" y="98">THANH GHI</text>' +
        '<text x="34" y="134">MODE</text><rect class="np-valbox" data-box="mode" x="92" y="116" width="98" height="26" rx="5"/><text class="np-t-val" data-val="mode" x="141" y="134" text-anchor="middle"></text>' +
        '<text x="34" y="182">OUT</text><rect class="np-valbox" data-box="out" x="92" y="164" width="98" height="26" rx="5"/><text class="np-t-val" data-val="out" x="141" y="182" text-anchor="middle"></text>' +
        '<text x="34" y="230">IN</text><rect class="np-valbox" data-box="in" x="92" y="212" width="98" height="26" rx="5"/><text class="np-t-val" data-val="in" x="141" y="230" text-anchor="middle"></text>' +
        '<text x="34" y="278">PULL</text><rect class="np-valbox" data-box="pull" x="92" y="260" width="98" height="26" rx="5"/><text class="np-t-val" data-val="pull" x="141" y="278" text-anchor="middle"></text>' +
        // dây điều khiển cổng MOSFET (nét đứt)
        '<path class="np-ctl" d="M190 177 H234 V130 H300"/><path class="np-ctl" d="M234 177 V298 H300"/>' +
        // bộ đệm đầu vào (Schmitt trigger) → thanh ghi IN
        '<path class="np-wire" d="M342 216 H296"/><polygon class="np-buf" data-el="buf" points="296,202 296,230 262,216"/><path class="np-wire" d="M262 216 H246 V225 H190"/>' +
        // P-MOS, N-MOS
        '<line class="np-wire" x1="342" y1="56" x2="342" y2="104"/><line class="np-wire" x1="342" y1="156" x2="342" y2="272"/><line class="np-wire" x1="342" y1="324" x2="342" y2="384"/>' +
        '<g class="np-fet" data-fet="p"><rect x="300" y="104" width="84" height="52" rx="8"/><text class="np-t-strong" x="342" y="126" text-anchor="middle">P-MOS</text><text class="np-fet-state" x="342" y="145" text-anchor="middle"></text></g>' +
        '<g class="np-fet" data-fet="n"><rect x="300" y="272" width="84" height="52" rx="8"/><text class="np-t-strong" x="342" y="294" text-anchor="middle">N-MOS</text><text class="np-fet-state" x="342" y="313" text-anchor="middle"></text></g>' +
        // nút giữa → chân
        '<line class="np-wire" x1="342" y1="216" x2="456" y2="216"/><circle class="np-node" cx="342" cy="216" r="4.5"/>' +
        // điện trở kéo lên bên trong
        '<g class="np-ext" data-el="pu"><line class="np-wire" x1="420" y1="56" x2="420" y2="74"/><path class="np-res" d="' + zig(420, 74) + '"/><line class="np-wire" x1="420" y1="128" x2="420" y2="216"/><circle class="np-node" cx="420" cy="216" r="4"/><text x="432" y="98">pull-up</text><text class="np-t-dim" x="432" y="114">~45 kΩ</text></g>' +
        // chân
        '<rect class="np-pad" x="456" y="200" width="28" height="32" rx="4"/><text class="np-t-strong" x="470" y="192" text-anchor="middle">CHÂN</text>' +
        // số đo
        '<text class="np-t-strong" data-val="pinv" x="26" y="340"></text><text data-val="cur" x="26" y="362"></text>' +
        // mạch ngoài: push-pull (LED nối xuống GND)
        '<g class="np-ext" data-ext="pp"><path class="np-wire" d="M484 216 H600 V236"/><path class="np-res" d="' + zig(600, 236) + '"/><text x="616" y="268">220 Ω</text>' +
          '<path class="np-wire" d="M600 290 V304"/><circle class="np-glow" data-led-glow cx="600" cy="316" r="18" filter="url(#np-gpio-glow)"/>' +
          '<polygon class="np-led" data-led points="588,304 612,304 600,326"/><line class="np-wire" x1="588" y1="328" x2="612" y2="328"/><text x="616" y="322">LED</text>' +
          '<path class="np-wire" d="M600 328 V384"/></g>' +
        // mạch ngoài: open-drain (LED nối lên VDD)
        '<g class="np-ext" data-ext="od"><path class="np-wire" d="M600 56 V74"/><path class="np-res" d="' + zig(600, 74) + '"/><text x="616" y="106">220 Ω</text>' +
          '<path class="np-wire" d="M600 128 V146"/><circle class="np-glow" data-led-glow cx="600" cy="158" r="18" filter="url(#np-gpio-glow)"/>' +
          '<polygon class="np-led" data-led points="588,146 612,146 600,168"/><line class="np-wire" x1="588" y1="170" x2="612" y2="170"/><text x="616" y="164">LED</text>' +
          '<path class="np-wire" d="M600 170 V216 H484"/></g>' +
        // mạch ngoài: input (nút nhấn nối xuống GND)
        '<g class="np-ext" data-ext="in"><path class="np-wire" d="M484 216 H660 V272"/><circle class="np-node" cx="660" cy="272" r="3.5"/>' +
          '<line class="np-switch" data-el="sw" x1="660" y1="272" x2="680" y2="304"/><circle class="np-node" cx="660" cy="312" r="3.5"/>' +
          '<text x="690" y="296">nút</text><path class="np-wire" d="M660 312 V384"/></g>' +
        // đường dòng điện (ẩn) + chấm sáng
        '<path data-path="pp" d="M342 56 V216 H600 V384" fill="none" stroke="none"/>' +
        '<path data-path="od" d="M600 56 V216 H342 V384" fill="none" stroke="none"/>' +
        '<path data-path="in" d="M420 56 V216 H660 V384" fill="none" stroke="none"/>' +
        '<g data-el="dots"></g>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-vcc)"></i>VDD (nguồn)</span><span><i style="--c:var(--np-gnd)"></i>GND (đất)</span>' +
        '<span><i class="is-dot" style="--c:var(--primary)"></i>dòng điện</span><span><i style="--c:var(--primary)"></i>MOSFET đang dẫn</span>' +
        '<span><i style="--c:var(--np-clk)"></i>bộ đệm vào đang đọc</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var dotsG = q('[data-el="dots"]');
    var dots = [];
    for (var k = 0; k < 7; k++) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'np-dot'); c.setAttribute('r', '4');
      dotsG.appendChild(c); dots.push(c);
    }

    // Phần "Tự thử"
    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      '<div class="np-seg" role="group" aria-label="Chế độ chân">' +
        '<button type="button" class="np-btn" data-mode="in">Input</button>' +
        '<button type="button" class="np-btn" data-mode="pp">Output push-pull</button>' +
        '<button type="button" class="np-btn" data-mode="od">Output open-drain</button></div>' +
      '<div class="np-seg" role="group" aria-label="Ghi thanh ghi OUT">' +
        '<button type="button" class="np-btn" data-out="0">Ghi 0</button>' +
        '<button type="button" class="np-btn" data-out="1">Ghi 1</button></div>' +
      '<button type="button" class="np-btn np-hold" data-hold>Nhấn giữ nút</button>';

    var st = { mode: 'pp', out: 0, pressed: false };
    var prevVals = {};
    var MODE_TXT = { in: 'INPUT', pp: 'OUT·PP', od: 'OUT·OD' };

    function describe(s) {
      if (s.mode === 'pp') return s.out
        ? 'Output push-pull, OUT = 1: P-MOS dẫn, chân lên 3.3 V; dòng chạy qua điện trở 220 Ω và LED xuống GND — LED sáng (≈ 6 mA).'
        : 'Output push-pull, OUT = 0: N-MOS dẫn, chân bị nối xuống GND (0 V) — LED tắt.';
      if (s.mode === 'od') return s.out
        ? 'Output open-drain, OUT = 1: N-MOS ngắt, P-MOS bị vô hiệu → chân thả nổi (high-Z), không có dòng — LED tắt.'
        : 'Output open-drain, OUT = 0: N-MOS dẫn, kéo chân xuống 0 V → dòng từ 3.3 V qua LED chảy vào chân — LED sáng.';
      return s.pressed
        ? 'Input, đang nhấn nút: chân bị nối xuống GND → bộ đệm vào thấy 0 V → IN = 0. Dòng qua pull-up rất nhỏ (≈ 0.07 mA).'
        : 'Input, nút đang nhả: hai MOSFET đều ngắt, pull-up bên trong giữ chân ở 3.3 V → IN = 1.';
    }
    function setVal(key, txt) {
      var t = q('[data-val="' + key + '"]');
      t.textContent = txt;
      if (prevVals[key] !== undefined && prevVals[key] !== txt) {      // nháy ô thanh ghi vừa đổi
        var box = q('[data-box="' + key + '"]');
        if (box) { box.classList.remove('is-flash'); void box.getBBox(); box.classList.add('is-flash'); setTimeout(function () { box.classList.remove('is-flash'); }, 600); }
      }
      prevVals[key] = txt;
    }
    function fet(which, state) {
      var g = q('[data-fet="' + which + '"]');
      g.classList.toggle('is-on', state === 'on');
      g.classList.toggle('is-disabled', state === 'dis');
      g.querySelector('.np-fet-state').textContent = state === 'on' ? 'DẪN' : state === 'dis' ? 'VÔ HIỆU' : 'NGẮT';
    }
    var curPath = null, curSpeed = 0;
    function apply(s) {
      st.mode = s.mode; st.out = s.out; st.pressed = !!s.pressed;
      var pp = st.mode === 'pp', od = st.mode === 'od', inp = st.mode === 'in';
      fet('p', pp && st.out ? 'on' : od ? 'dis' : 'off');
      fet('n', (pp || od) && !st.out ? 'on' : 'off');
      q('[data-el="buf"]').classList.toggle('is-on', inp);
      q('[data-el="pu"]').style.opacity = inp ? '1' : '0.25';
      ['pp', 'od', 'in'].forEach(function (m) { q('[data-ext="' + m + '"]').style.display = m === st.mode ? '' : 'none'; });
      var ledOn = (pp && st.out === 1) || (od && st.out === 0);
      Array.prototype.forEach.call(svg.querySelectorAll('[data-led]'), function (l) { l.classList.toggle('is-on', ledOn); });
      Array.prototype.forEach.call(svg.querySelectorAll('[data-led-glow]'), function (l) { l.classList.toggle('is-on', ledOn); });
      var sw = q('[data-el="sw"]');
      sw.setAttribute('x2', st.pressed ? '660' : '680');
      sw.setAttribute('y2', st.pressed ? '312' : '304');
      sw.classList.toggle('is-down', st.pressed);
      setVal('mode', MODE_TXT[st.mode]);
      setVal('out', inp ? '—' : String(st.out));
      setVal('in', inp ? (st.pressed ? '0' : '1') : od && st.out ? '?' : String(st.out));
      setVal('pull', inp ? 'LÊN' : 'TẮT');
      var high = inp ? !st.pressed : st.out === 1;
      setVal('pinv', od && st.out ? 'Chân: Hi-Z (thả nổi)' : 'Chân: ' + (high ? '3.3 V · mức 1' : '0 V · mức 0'));
      curPath = pp && st.out ? 'pp' : od && !st.out ? 'od' : inp && st.pressed ? 'in' : null;
      curSpeed = curPath === 'in' ? 26 : 95;     // dòng qua pull-up rất nhỏ → chấm đi chậm
      setVal('cur', curPath === 'in' ? 'Dòng qua pull-up ≈ 0.07 mA' : curPath ? 'Dòng qua LED ≈ 6 mA' : 'Không có dòng điện');
      // nút "Tự thử"
      Array.prototype.forEach.call(tryBox.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
      Array.prototype.forEach.call(tryBox.querySelectorAll('[data-out]'), function (b) {
        b.disabled = inp; b.setAttribute('aria-pressed', String(!inp && Number(b.dataset.out) === st.out));
      });
      tryBox.querySelector('[data-hold]').disabled = !inp;
      placeDots(0);
    }

    // Chấm sáng chạy dọc đường dòng điện
    var offset = 0, raf = 0, lastT = 0;
    function placeDots(dt) {
      if (!curPath) { dots.forEach(function (d) { d.style.display = 'none'; }); return; }
      var p = q('[data-path="' + curPath + '"]'), L = p.getTotalLength();
      offset = (offset + dt * curSpeed) % L;
      dots.forEach(function (d, j) {
        var pt = p.getPointAtLength((offset + j * L / dots.length) % L);
        d.style.display = '';
        d.setAttribute('cx', pt.x.toFixed(1)); d.setAttribute('cy', pt.y.toFixed(1));
      });
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!reduceMotion && player.visible()) placeDots(dt * player.speed());
    }

    var steps = [
      { state: { mode: 'pp', out: 0 }, text: 'Chế độ Output push-pull. OUT = 0: N-MOS dẫn, chân nối xuống GND (0 V), LED tắt.' },
      { state: { mode: 'pp', out: 1 }, text: 'Ghi OUT = 1: P-MOS dẫn, chân lên 3.3 V. Dòng đi từ VDD qua chân, qua điện trở 220 Ω và LED xuống GND — LED sáng.' },
      { state: { mode: 'pp', out: 0 }, text: 'Ghi lại 0: P-MOS ngắt, N-MOS dẫn, LED tắt. Push-pull chủ động lái cả hai mức.' },
      { state: { mode: 'od', out: 1 }, text: 'Đổi sang open-drain: P-MOS bị vô hiệu. Ghi 1 nghĩa là “buông tay” — chân thả nổi (high-Z), không có dòng.' },
      { state: { mode: 'od', out: 0 }, text: 'Ghi 0: N-MOS kéo chân xuống 0 V. Dòng chạy từ 3.3 V qua LED vào chân rồi xuống GND — LED sáng.' },
      { state: { mode: 'in', out: 0, pressed: false }, text: 'Chuyển sang Input: cả hai MOSFET ngắt, chân chỉ lắng nghe. Pull-up bên trong giữ chân ở 3.3 V → IN = 1.' },
      { state: { mode: 'in', out: 0, pressed: true }, text: 'Nhấn nút: chân bị nối xuống GND → bộ đệm vào thấy 0 V → IN = 0.' }
    ];
    var player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);

    function userSet(patch) {
      Object.keys(patch).forEach(function (key) { st[key] = patch[key]; });
      apply({ mode: st.mode, out: st.out, pressed: st.pressed });
      player.manual(describe(st));
    }
    tryBox.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.mode) userSet({ mode: b.dataset.mode, pressed: false });
      else if (b.dataset.out) userSet({ out: Number(b.dataset.out) });
    });
    var hold = tryBox.querySelector('[data-hold]');
    var press = function (down) {
      if (hold.disabled || st.pressed === down) return;
      hold.classList.toggle('is-down', down);
      userSet({ pressed: down });
    };
    hold.addEventListener('pointerdown', function (e) { e.preventDefault(); press(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { hold.addEventListener(ev, function () { press(false); }); });
    hold.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); } });
    hold.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') press(false); });

    lastT = performance.now();
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* =========================================================
     SƠ ĐỒ 2 — PULL-UP / PULL-DOWN: so sánh 3 cách nối nút nhấn + giản đồ điện áp và giá trị đọc được
     ========================================================= */
  function mountPull(host) {
    var zig = function (x, y) { return 'M' + x + ' ' + y + ' l9 4.5 l-18 9 l18 9 l-18 9 l18 9 l-18 9 l9 4.5'; };
    var N = 133, X0 = 476;                                       // số mẫu trên giản đồ, mép trái vùng vẽ
    var vy = function (v) { return 236 - v * (150 / 3.3); };      // điện áp → toạ độ y
    var dy = function (b) { return b ? 290 : 320; };              // bit đọc được → toạ độ y
    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 420" role="img" aria-label="So sánh chân không có điện trở, có pull-up và có pull-down, kèm giản đồ điện áp trên chân và giá trị chip đọc được">' +
        // ray nguồn & đất
        '<line class="np-vcc" x1="160" y1="50" x2="380" y2="50"/><text class="np-vcc-t" x="380" y="40" text-anchor="end">3.3 V</text>' +
        '<line class="np-gnd" x1="160" y1="330" x2="380" y2="330"/><text class="np-gnd-t" x="380" y="352" text-anchor="end">GND</text>' +
        // vi điều khiển + bộ đệm vào + chân
        '<rect class="np-box-r" x="20" y="140" width="150" height="110" rx="12"/><text class="np-t-dim" x="34" y="162">MCU</text>' +
        '<polygon class="np-buf is-on" points="140,180 140,210 112,195"/><path class="np-wire" d="M164 195 H140"/>' +
        '<text class="np-t-strong" data-val="inbox" x="34" y="200"></text><text class="np-t-dim" x="34" y="226">giá trị đọc</text>' +
        '<rect class="np-pad" x="164" y="180" width="22" height="30" rx="4"/><text class="np-t-strong" x="175" y="172" text-anchor="middle">CHÂN</text>' +
        '<path class="np-wire" d="M186 195 H240"/><circle class="np-node" cx="240" cy="195" r="4.5"/>' +
        // khe trên (giữa 3.3 V và chân): điện trở kéo lên HOẶC nút nối lên 3.3 V
        '<g data-el="upw"><line class="np-wire" x1="240" y1="50" x2="240" y2="72"/><line class="np-wire" x1="240" y1="126" x2="240" y2="195"/></g>' +
        '<g data-el="rup"><path class="np-res" d="' + zig(240, 72) + '"/><text x="258" y="94">R</text><text class="np-t-val" data-val="rup" x="258" y="112"></text></g>' +
        '<g data-el="bup"><circle class="np-node" cx="240" cy="78" r="3.5"/><circle class="np-node" cx="240" cy="120" r="3.5"/>' +
          '<line class="np-switch" data-sw="up" x1="240" y1="78" x2="262" y2="114"/><text x="270" y="104">nút</text></g>' +
        '<text class="np-t-dim" data-el="nup" x="252" y="122">(không có điện trở)</text>' +
        // khe dưới (giữa chân và GND): nút nối xuống GND HOẶC điện trở kéo xuống
        '<line class="np-wire" x1="240" y1="195" x2="240" y2="222"/><line class="np-wire" x1="240" y1="276" x2="240" y2="330"/>' +
        '<g data-el="blow"><circle class="np-node" cx="240" cy="228" r="3.5"/><circle class="np-node" cx="240" cy="270" r="3.5"/>' +
          '<line class="np-switch" data-sw="low" x1="240" y1="228" x2="262" y2="264"/><text x="270" y="254">nút</text></g>' +
        '<g data-el="rlow"><path class="np-res" d="' + zig(240, 222) + '"/><text x="258" y="244">R</text><text class="np-t-val" data-val="rlow" x="258" y="262"></text></g>' +
        // nhiễu môi trường (chỉ hiện khi chân lơ lửng)
        '<g data-el="noise"><path class="np-noise" d="M266 168 q6 -9 12 0 t12 0 t12 0"/><path class="np-noise" d="M272 182 q6 -9 12 0 t12 0 t12 0"/>' +
          '<text x="312" y="176" style="fill:var(--rose)">nhiễu</text></g>' +
        // số đo
        '<text class="np-t-strong" data-val="rinfo" x="20" y="380"></text><text data-val="iinfo" x="20" y="404"></text>' +
        // giản đồ thời gian kiểu GTKWave
        '<rect class="np-scopebox" x="410" y="24" width="340" height="350" rx="10"/><text class="np-t-dim" x="424" y="48">GIẢN ĐỒ THỜI GIAN</text>' +
        '<rect class="np-band" x="' + X0 + '" y="' + vy(2.5) + '" width="264" height="' + (vy(0.8) - vy(2.5)) + '"/>' +
        '<line class="np-grid" x1="' + X0 + '" y1="' + vy(3.3) + '" x2="740" y2="' + vy(3.3) + '"/><line class="np-grid" x1="' + X0 + '" y1="' + vy(0) + '" x2="740" y2="' + vy(0) + '"/>' +
        '<line class="np-thr" x1="' + X0 + '" y1="' + vy(2.5) + '" x2="740" y2="' + vy(2.5) + '"/><line class="np-thr" x1="' + X0 + '" y1="' + vy(0.8) + '" x2="740" y2="' + vy(0.8) + '"/>' +
        '<text class="np-t-dim" x="470" y="' + (vy(3.3) + 4) + '" text-anchor="end">3.3</text><text class="np-t-dim" x="470" y="' + (vy(2.5) + 4) + '" text-anchor="end">2.5</text>' +
        '<text class="np-t-dim" x="470" y="' + (vy(0.8) + 4) + '" text-anchor="end">0.8</text><text class="np-t-dim" x="470" y="' + (vy(0) + 4) + '" text-anchor="end">0 V</text>' +
        '<text class="np-t-dim" x="736" y="' + (vy(1.65) + 4) + '" text-anchor="end">vùng không rõ</text>' +
        '<text class="np-t-strong" x="424" y="' + (vy(1.65) - 8) + '">V</text><text class="np-t-dim" x="424" y="' + (vy(1.65) + 8) + '">chân</text>' +
        '<line class="np-thr" x1="' + X0 + '" y1="305" x2="740" y2="305"/><text class="np-t-strong" x="424" y="309">IN</text>' +
        '<text class="np-t-dim" x="470" y="294" text-anchor="end">1</text><text class="np-t-dim" x="470" y="324" text-anchor="end">0</text>' +
        '<polyline class="np-trace-v" data-el="tv"/><polyline class="np-trace-d" data-el="td"/>' +
        '<line class="np-thr" x1="740" y1="70" x2="740" y2="330" style="stroke:var(--primary);stroke-dasharray:none"/>' +
        '<text class="np-t-big" data-val="read" x="' + X0 + '" y="358"></text>' +
        // đường dòng điện (ẩn) + chấm sáng
        '<path data-path="cur" d="M240 50 V330" fill="none" stroke="none"/><g data-el="dots"></g>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-vcc)"></i>3.3 V</span><span><i style="--c:var(--np-gnd)"></i>GND</span>' +
        '<span><i style="--c:var(--np-data)"></i>điện áp trên chân</span><span><i style="--c:var(--np-miso)"></i>giá trị chip đọc (IN)</span>' +
        '<span><i class="is-dot" style="--c:var(--primary)"></i>dòng điện</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var dots = [];
    for (var k = 0; k < 5; k++) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'np-dot'); c.setAttribute('r', '4');
      q('[data-el="dots"]').appendChild(c); dots.push(c);
    }

    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      '<div class="np-seg" role="group" aria-label="Cách nối">' +
        '<button type="button" class="np-btn" data-cfg="float">Không điện trở</button>' +
        '<button type="button" class="np-btn" data-cfg="up">Pull-up</button>' +
        '<button type="button" class="np-btn" data-cfg="down">Pull-down</button></div>' +
      '<button type="button" class="np-btn np-hold" data-hold>Nhấn giữ nút</button>' +
      '<label class="np-range"><span>R</span><input type="range" min="0" max="100" step="1" value="50" aria-label="Giá trị điện trở, từ 1 kΩ đến 100 kΩ"><output>10 kΩ</output></label>';
    var slider = tryBox.querySelector('input'), sliderOut = tryBox.querySelector('output');

    var st = { cfg: 'float', pressed: false, r: 10 };
    var fmtR = function (r) { return (r < 10 ? r.toFixed(1).replace('.0', '') : Math.round(r)) + ' kΩ'; };
    var fmtI = function (r) {
      var mA = 3.3 / r;
      return mA >= 1 ? mA.toFixed(1) + ' mA' : mA >= 0.1 ? mA.toFixed(2) + ' mA' : Math.round(mA * 1000) + ' µA';
    };
    var spring = function (r) { return r <= 4.7 ? 'chắc (tốn dòng)' : r <= 22 ? 'vừa' : 'yếu (tiết kiệm dòng)'; };
    var rToSlider = function (r) { return Math.round(Math.log(r) / Math.log(100) * 100); };

    function describe(s) {
      if (s.cfg === 'float') return s.pressed
        ? 'Không điện trở, đang nhấn: chân nối thẳng xuống GND → đọc 0 ổn định.'
        : 'Không điện trở, nút nhả: không gì giữ chân — điện áp trôi theo nhiễu, giá trị đọc nhảy 0/1 loạn xạ.';
      var i = 'I = 3.3 V ÷ ' + fmtR(s.r) + ' ≈ ' + fmtI(s.r);
      if (s.cfg === 'up') return s.pressed
        ? 'Pull-up ' + fmtR(s.r) + ', đang nhấn: chân xuống 0 V → đọc 0 (active-low). ' + i + '.'
        : 'Pull-up ' + fmtR(s.r) + ', nút nhả: điện trở kéo chân lên 3.3 V → đọc 1. Lò xo ' + spring(s.r) + '.';
      return s.pressed
        ? 'Pull-down ' + fmtR(s.r) + ', đang nhấn: chân lên 3.3 V → đọc 1 (active-high). ' + i + '.'
        : 'Pull-down ' + fmtR(s.r) + ', nút nhả: điện trở kéo chân xuống 0 V → đọc 0. Lò xo ' + spring(s.r) + '.';
    }

    // Mô phỏng điện áp trên chân theo thời gian
    var floatV = 1.65, nz = 0, simT = 0;
    function sample(s) {
      nz += ((Math.random() * 2 - 1) - nz) * 0.4;                     // nhiễu mịn
      var v;
      if (s.cfg === 'float' && !s.pressed) {                           // lơ lửng: trôi + “nhiễu lưới điện” (vẽ chậm cho dễ nhìn)
        floatV += (Math.random() - 0.5) * 0.7 + (1.65 - floatV) * 0.04;
        v = floatV + 1.15 * Math.sin(simT * 2 * Math.PI * 1.7) + nz * 0.5;
      } else {
        var high = s.cfg === 'down' ? s.pressed : (s.cfg === 'up' && !s.pressed);
        var amp = s.pressed ? 0.03 : 0.04 + 0.5 * Math.pow(Math.log(s.r) / Math.log(10) / 2, 2);   // R càng lớn càng gợn
        v = high ? 3.3 - Math.abs(nz) * amp : Math.abs(nz) * amp;
      }
      v = Math.max(0, Math.min(3.3, v));
      var bit = v >= 2.5 ? 1 : v <= 0.8 ? 0 : (Math.random() < 0.5 ? 1 : 0);   // vùng không rõ: đọc ra 0 hay 1 tùy may rủi
      return [v, bit];
    }
    var vBuf = [], dBuf = [];
    function pushSample() {
      simT += 1 / 40;
      var smp = sample(st);
      vBuf.push(smp[0]); dBuf.push(smp[1]);
      if (vBuf.length > N) { vBuf.shift(); dBuf.shift(); }
    }
    function drawTraces() {
      var pv = [], pd = [], start = N - vBuf.length;
      for (var j = 0; j < vBuf.length; j++) {
        var x = X0 + (start + j) * 2;
        pv.push(x + ',' + vy(vBuf[j]).toFixed(1));
        if (j) pd.push(x + ',' + dy(dBuf[j - 1]));                     // giữ mức cũ tới mẫu kế → dạng xung vuông
        pd.push(x + ',' + dy(dBuf[j]));
      }
      q('[data-el="tv"]').setAttribute('points', pv.join(' '));
      q('[data-el="td"]').setAttribute('points', pd.join(' '));
      var last = dBuf[dBuf.length - 1];
      q('[data-val="read"]').textContent = 'Chip đọc được: ' + last;
      q('[data-val="inbox"]').textContent = 'IN = ' + last;
    }

    var curOn = false, curSpeed = 30;
    function apply(s) {
      st.cfg = s.cfg; st.pressed = !!s.pressed; st.r = s.r || st.r;
      var fl = st.cfg === 'float', up = st.cfg === 'up', down = st.cfg === 'down';
      q('[data-el="upw"]').style.display = fl ? 'none' : '';
      q('[data-el="rup"]').style.display = up ? '' : 'none';
      q('[data-el="bup"]').style.display = down ? '' : 'none';
      q('[data-el="nup"]').style.display = fl ? '' : 'none';
      q('[data-el="blow"]').style.display = down ? 'none' : '';
      q('[data-el="rlow"]').style.display = down ? '' : 'none';
      q('[data-el="noise"]').style.display = fl && !st.pressed ? '' : 'none';
      ['up', 'low'].forEach(function (w) {
        var sw = q('[data-sw="' + w + '"]'), y0 = w === 'up' ? 78 : 228;
        sw.setAttribute('x2', st.pressed ? '240' : '262');
        sw.setAttribute('y2', String(y0 + (st.pressed ? 42 : 36)));
        sw.classList.toggle('is-down', st.pressed);
      });
      q('[data-val="rup"]').textContent = fmtR(st.r);
      q('[data-val="rlow"]').textContent = fmtR(st.r);
      q('[data-val="rinfo"]').textContent = fl ? 'Không có điện trở kéo' : 'R = ' + fmtR(st.r) + ' · lò xo ' + spring(st.r);
      q('[data-val="iinfo"]').textContent = fl
        ? (st.pressed ? 'Đang nhấn: chân nối thẳng GND' : 'Nút nhả: chân lơ lửng, đọc bừa')
        : st.pressed ? 'Đang nhấn: I = 3.3 V ÷ ' + fmtR(st.r) + ' ≈ ' + fmtI(st.r)
        : 'Nút nhả: gần như không có dòng';
      curOn = !fl && st.pressed;
      curSpeed = 18 + 62 * Math.min(1, (3.3 / st.r) / 3.3);          // dòng càng lớn, chấm chạy càng nhanh
      // nút "Tự thử"
      Array.prototype.forEach.call(tryBox.querySelectorAll('[data-cfg]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.cfg === st.cfg)); });
      slider.disabled = fl;
      slider.parentNode.classList.toggle('is-disabled', fl);
      slider.value = rToSlider(st.r);
      sliderOut.textContent = fmtR(st.r);
      if (reduceMotion || !vBuf.length) { vBuf = []; dBuf = []; for (var j = 0; j < N; j++) pushSample(); }   // không chuyển động: vẽ sẵn cả đoạn
      drawTraces();
      placeDots(0);
    }

    var offset = 0;
    function placeDots(dt) {
      if (!curOn) { dots.forEach(function (d) { d.style.display = 'none'; }); return; }
      var p = q('[data-path="cur"]'), L = p.getTotalLength();
      offset = (offset + dt * curSpeed) % L;
      dots.forEach(function (d, j) {
        var pt = p.getPointAtLength((offset + j * L / dots.length) % L);
        d.style.display = '';
        d.setAttribute('cx', pt.x.toFixed(1)); d.setAttribute('cy', pt.y.toFixed(1));
      });
    }
    var raf = 0, lastT = 0, acc = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (reduceMotion || !player.visible()) return;
      var sp = player.speed();
      acc += dt * sp;
      var grew = false;
      while (acc >= 1 / 40) { pushSample(); acc -= 1 / 40; grew = true; }
      if (grew) drawTraces();
      placeDots(dt * sp);
    }

    var steps = [
      { state: { cfg: 'float', pressed: false, r: 10 }, text: 'Không có điện trở, nút đang nhả: chân lơ lửng. Điện áp trôi theo nhiễu, giá trị đọc nhảy 0/1 loạn xạ.' },
      { state: { cfg: 'float', pressed: true, r: 10 }, text: 'Nhấn nút: chân nối thẳng xuống GND → đọc ổn định 0. Rắc rối chỉ xuất hiện lúc nhả.' },
      { state: { cfg: 'up', pressed: false, r: 10 }, text: 'Thêm điện trở 10 kΩ nối lên 3.3 V (pull-up). Nút nhả: điện trở kéo chân lên 3.3 V → đọc 1 ổn định.' },
      { state: { cfg: 'up', pressed: true, r: 10 }, text: 'Nhấn nút: chân xuống 0 V → đọc 0 (active-low). Dòng 3.3 V ÷ 10 kΩ ≈ 0.33 mA chạy qua điện trở.' },
      { state: { cfg: 'down', pressed: false, r: 10 }, text: 'Pull-down: điện trở nối chân xuống GND, nút nối lên 3.3 V. Nút nhả → đọc 0.' },
      { state: { cfg: 'down', pressed: true, r: 10 }, text: 'Nhấn nút: chân lên 3.3 V → đọc 1 (active-high). Dòng ≈ 0.33 mA chảy qua điện trở xuống GND.' },
      { state: { cfg: 'up', pressed: false, r: 100 }, text: 'Pull-up 100 kΩ: “lò xo” yếu — điện áp gợn rõ hơn dù vẫn đọc 1. Bù lại, khi nhấn chỉ tốn 33 µA.' },
      { state: { cfg: 'up', pressed: true, r: 1 }, text: 'Pull-up 1 kΩ: kéo rất chắc, nhưng mỗi lần nhấn tốn tới 3.3 mA — phí pin.' }
    ];
    steps.forEach(function (s) { s.dur = 3800; });
    var player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);

    function userSet(patch) {
      Object.keys(patch).forEach(function (key) { st[key] = patch[key]; });
      apply({ cfg: st.cfg, pressed: st.pressed, r: st.r });
      player.manual(describe(st));
    }
    tryBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cfg]');
      if (b) userSet({ cfg: b.dataset.cfg, pressed: false });
    });
    slider.addEventListener('input', function () {
      userSet({ r: Math.pow(100, slider.value / 100) });            // thang logarit: 1 kΩ … 10 kΩ … 100 kΩ
    });
    var hold = tryBox.querySelector('[data-hold]');
    var press = function (down) {
      if (st.pressed === down) return;
      hold.classList.toggle('is-down', down);
      userSet({ pressed: down });
    };
    hold.addEventListener('pointerdown', function (e) { e.preventDefault(); press(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { hold.addEventListener(ev, function () { press(false); }); });
    hold.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); } });
    hold.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') press(false); });

    lastT = performance.now();
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* =========================================================
     SƠ ĐỒ 3 — SPI: hai thanh ghi dịch nối vòng tròn + giản đồ CS / SCLK / MOSI / MISO, chọn Mode 0–3
     Trục thời gian T (đơn vị = 1 nhịp clock): CS xuống ở T = 0.5, bit i chiếm [1+i, 2+i], CS lên ở T = 9.5.
     ========================================================= */
  function mountSpi(host) {
    var P = 64, X0 = 100;                                          // 1 nhịp = 64px trên giản đồ
    var tx = function (T) { return X0 + T * P; };
    var LANE = { cs: [296, 320], clk: [346, 370], mosi: [396, 420], miso: [446, 470] };   // [y mức 1, y mức 0]
    var CELL = 32, MX = 52, SX = 452, CY = 120;                   // ô thanh ghi của master / slave
    var cfg = { mode: 0, m: 0xA5, s: 0x3C };
    var T = 0, t0 = 0, t1 = 0;
    var cpol = function () { return cfg.mode >> 1; };              // Mode 0: 0/0 · 1: 0/1 · 2: 1/0 · 3: 1/1
    var cpha = function () { return cfg.mode & 1; };
    var bitOf = function (v, i) { return (v >> (7 - i)) & 1; };    // bit thứ i tính từ MSB
    var hex = function (v) { return '0x' + ('0' + v.toString(16).toUpperCase()).slice(-2); };
    var bin = function (v) { var b = ('0000000' + v.toString(2)).slice(-8); return b.slice(0, 4) + ' ' + b.slice(4); };
    var launch = function (i) { return cpha() ? 1.5 + i : (i === 0 ? 0.5 : 1 + i); };   // lúc đặt bit lên dây
    var sampleAt = function (i) { return cpha() ? 2 + i : 1.5 + i; };                   // lúc bên kia lấy mẫu
    var edgeName = function () { return cfg.mode === 0 || cfg.mode === 3 ? 'lên' : 'xuống'; };

    var cells = '';
    for (var p = 0; p < 8; p++) {
      cells += '<g data-cell="m' + p + '"><rect class="np-cell" x="' + (MX + p * CELL) + '" y="' + CY + '" width="' + CELL + '" height="32" rx="4"/>' +
        '<text class="np-cellt" x="' + (MX + p * CELL + 16) + '" y="' + (CY + 21) + '" text-anchor="middle"></text></g>';
      cells += '<g data-cell="s' + p + '"><rect class="np-cell" x="' + (SX + p * CELL) + '" y="' + CY + '" width="' + CELL + '" height="32" rx="4"/>' +
        '<text class="np-cellt" x="' + (SX + p * CELL + 16) + '" y="' + (CY + 21) + '" text-anchor="middle"></text></g>';
    }
    var ticks = '';
    for (var b = 0; b < 8; b++) ticks += '<text class="np-t-dim" x="' + tx(1.5 + b) + '" y="286" text-anchor="middle">bit ' + (7 - b) + '</text>';

    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 500" role="img" aria-label="Giao dịch SPI: hai thanh ghi dịch 8 bit của master và slave trao đổi dữ liệu qua MOSI và MISO theo từng nhịp clock, kèm giản đồ thời gian bốn tín hiệu">' +
        // dây nối (vẽ trước để nằm dưới hộp)
        '<path class="np-sig np-sig-data" data-w="mosi" d="M52 136 H24 V44 H736 V136 H708"/>' +
        '<path class="np-sig np-sig-miso" data-w="miso" d="M452 136 H308"/>' +
        '<path class="np-sig np-sig-clk" data-w="clk" d="M150 200 V226 H610 V200"/>' +
        '<path class="np-sig np-sig-cs" data-w="cs" d="M110 200 V254 H650 V200"/>' +
        '<text class="np-sigt-data" x="380" y="36" text-anchor="middle">MOSI (COPI) · master → slave</text>' +
        '<text class="np-sigt-miso" x="380" y="126" text-anchor="middle">MISO</text><text class="np-t-dim" x="380" y="154" text-anchor="middle">slave → master</text>' +
        '<text class="np-sigt-clk" x="380" y="220" text-anchor="middle">SCLK · nhịp do master tạo</text>' +
        '<text class="np-sigt-cs" x="380" y="248" text-anchor="middle">CS · kéo xuống 0 để chọn slave</text>' +
        // hai thiết bị
        '<rect class="np-box-r" x="30" y="70" width="300" height="130" rx="12" style="fill-opacity:.92"/><text class="np-t-strong" x="46" y="98">MASTER</text><text class="np-t-dim" x="120" y="98">vi điều khiển</text>' +
        '<rect class="np-box-r" x="430" y="70" width="300" height="130" rx="12" style="fill-opacity:.92"/><text class="np-t-strong" x="446" y="98">SLAVE</text><text class="np-t-dim" x="508" y="98">ngoại vi</text>' +
        '<text class="np-t-dim" x="308" y="114" text-anchor="end">thanh ghi dịch ←</text><text class="np-t-dim" x="708" y="114" text-anchor="end">thanh ghi dịch ←</text>' +
        cells +
        '<text class="np-t-strong" data-val="mhex" x="180" y="184" text-anchor="middle"></text><text class="np-t-strong" data-val="shex" x="580" y="184" text-anchor="middle"></text>' +
        // bit đang bay trên dây
        '<g data-el="dotm"><circle class="np-bitdot-m" r="10"/><text class="np-bitdot-t" text-anchor="middle" dy="4"></text></g>' +
        '<g data-el="dots"><circle class="np-bitdot-s" r="10"/><text class="np-bitdot-t np-bitdot-t--light" text-anchor="middle" dy="4"></text></g>' +
        // giản đồ thời gian
        '<rect class="np-hl" data-el="hl" y="276" width="' + P + '" height="204"/>' +
        ticks +
        '<text class="np-sigt-cs" x="20" y="312">CS</text><text class="np-sigt-clk" x="20" y="362">SCLK</text>' +
        '<text class="np-sigt-data" x="20" y="412">MOSI</text><text class="np-sigt-miso" x="20" y="462">MISO</text>' +
        '<g data-el="samples"></g>' +
        '<path class="np-sig np-sig-cs" data-wave="cs"/><path class="np-sig np-sig-clk" data-wave="clk"/>' +
        '<path class="np-sig np-sig-data" data-wave="mosi"/><path class="np-wave-z np-sig-data" data-wave="mosiz"/>' +
        '<path class="np-sig np-sig-miso" data-wave="miso"/><path class="np-wave-z np-sig-miso" data-wave="misoz"/>' +
        '<g data-el="labels"></g>' +
        '<line class="np-cursor" data-el="cur" y1="276" y2="482"/><polygon class="np-sample-dot" data-el="curtip" points="0,0 0,0 0,0"/>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-clk)"></i>SCLK</span><span><i style="--c:var(--np-data)"></i>MOSI · bit của master</span>' +
        '<span><i style="--c:var(--np-miso)"></i>MISO · bit của slave</span><span><i style="--c:var(--np-cs)"></i>CS</span>' +
        '<span><i style="--c:var(--primary)"></i>thời điểm hiện tại / lấy mẫu</span><span><i style="--c:var(--text-faint)"></i>nét đứt: dây đang thả nổi</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var mosiPath = q('[data-w="mosi"]'), misoPath = q('[data-w="miso"]');
    var mosiLen = mosiPath.getTotalLength(), misoLen = misoPath.getTotalLength();

    // Vẽ dạng sóng số từ danh sách đoạn [tBắtĐầu, tKếtThúc, mức] (mức 'z' = thả nổi, vẽ nét đứt ở giữa)
    function wave(segs, lane) {
      var hi = lane[0], lo = lane[1], mid = (hi + lo) / 2, d = '', dz = '', prev = null;
      segs.forEach(function (sg) {
        var xa = tx(sg[0]).toFixed(1), xb = tx(sg[1]).toFixed(1);
        if (sg[2] === 'z') { dz += 'M' + xa + ' ' + mid + 'H' + xb; prev = null; return; }
        var y = sg[2] ? hi : lo;
        if (prev === null) d += 'M' + xa + ' ' + y; else if (prev !== sg[2]) d += 'V' + y;
        d += 'H' + xb; prev = sg[2];
      });
      return [d, dz];
    }
    function dataSegs(v) {
      var segs = [[0, launch(0), 'z']];
      for (var i = 0; i < 8; i++) segs.push([launch(i), i < 7 ? launch(i + 1) : (cpha() ? 9.5 : 9), bitOf(v, i)]);
      segs.push([cpha() ? 9.5 : 9, 10, 'z']);
      return segs;
    }
    function rebuildWaves() {
      var idle = cpol(), act = 1 - idle;
      q('[data-wave="cs"]').setAttribute('d', wave([[0, 0.5, 1], [0.5, 9.5, 0], [9.5, 10, 1]], LANE.cs)[0]);
      var clk = [[0, 1.5, idle]];
      for (var i = 0; i < 8; i++) { clk.push([1.5 + i, 2 + i, act]); clk.push([2 + i, i < 7 ? 2.5 + i : 10, idle]); }
      q('[data-wave="clk"]').setAttribute('d', wave(clk, LANE.clk)[0]);
      var mw = wave(dataSegs(cfg.m), LANE.mosi), sw = wave(dataSegs(cfg.s), LANE.miso);
      q('[data-wave="mosi"]').setAttribute('d', mw[0]); q('[data-wave="mosiz"]').setAttribute('d', mw[1]);
      q('[data-wave="miso"]').setAttribute('d', sw[0]); q('[data-wave="misoz"]').setAttribute('d', sw[1]);
      var lab = '', smp = '';
      for (var j = 0; j < 8; j++) {
        var mid = tx((launch(j) + sampleAt(j)) / 2 + 0.25);          // giữa cửa sổ dữ liệu của bit j
        lab += '<text class="np-wavet" x="' + mid.toFixed(1) + '" y="' + (LANE.mosi[0] - 4) + '" text-anchor="middle">' + bitOf(cfg.m, j) + '</text>';
        lab += '<text class="np-wavet" x="' + mid.toFixed(1) + '" y="' + (LANE.miso[0] - 4) + '" text-anchor="middle">' + bitOf(cfg.s, j) + '</text>';
        var sx = tx(sampleAt(j)).toFixed(1);
        smp += '<line class="np-sample" x1="' + sx + '" y1="340" x2="' + sx + '" y2="476"/><circle class="np-sample-dot" cx="' + sx + '" cy="358" r="3.5"/>';
      }
      q('[data-el="labels"]').innerHTML = lab;
      q('[data-el="samples"]').innerHTML = smp;
    }

    function render() {
      var x = tx(T);
      var cur = q('[data-el="cur"]');
      cur.setAttribute('x1', x.toFixed(1)); cur.setAttribute('x2', x.toFixed(1));
      q('[data-el="curtip"]').setAttribute('points', (x - 6) + ',270 ' + (x + 6) + ',270 ' + x + ',278');
      var bi = Math.floor(T - 1), hl = q('[data-el="hl"]');
      if (bi >= 0 && bi < 8) { hl.style.display = ''; hl.setAttribute('x', tx(1 + bi)); } else hl.style.display = 'none';
      var n = 0;
      for (var i = 0; i < 8; i++) if (T >= sampleAt(i)) n++;              // số lần đã dịch
      var flying = -1;
      for (var k = 0; k < 8; k++) if (T >= launch(k) && T < sampleAt(k)) flying = k;
      // nội dung 2 thanh ghi sau n lần dịch (vòng tròn 16 bit quay trái)
      var mVal = 0, sVal = 0;
      for (var p = 0; p < 8; p++) {
        var src = p + n;
        var mb = src < 8 ? bitOf(cfg.m, src) : bitOf(cfg.s, src - 8), mo = src < 8 ? 'm' : 's';
        var sb = src < 8 ? bitOf(cfg.s, src) : bitOf(cfg.m, src - 8), so = src < 8 ? 's' : 'm';
        mVal = (mVal << 1) | mb; sVal = (sVal << 1) | sb;
        var gm = q('[data-cell="m' + p + '"]'), gs = q('[data-cell="s' + p + '"]');
        gm.querySelector('rect').setAttribute('class', 'np-cell is-' + mo);
        gm.querySelector('text').textContent = mb;
        gs.querySelector('rect').setAttribute('class', 'np-cell is-' + so);
        gs.querySelector('text').textContent = sb;
        gm.style.opacity = gs.style.opacity = (p === 0 && flying >= 0) ? '0.35' : '1';   // bit đầu đang bay trên dây
      }
      q('[data-val="mhex"]').textContent = 'đang giữ ' + hex(mVal) + ' · ' + bin(mVal);
      q('[data-val="shex"]').textContent = 'đang giữ ' + hex(sVal) + ' · ' + bin(sVal);
      var dm = q('[data-el="dotm"]'), ds = q('[data-el="dots"]');
      if (flying >= 0) {
        var f = (T - launch(flying)) / (sampleAt(flying) - launch(flying));
        var a = mosiPath.getPointAtLength(f * mosiLen), c = misoPath.getPointAtLength(f * misoLen);
        dm.style.display = ds.style.display = '';
        dm.setAttribute('transform', 'translate(' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ')');
        ds.setAttribute('transform', 'translate(' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ')');
        dm.querySelector('text').textContent = bitOf(cfg.m, flying);
        ds.querySelector('text').textContent = bitOf(cfg.s, flying);
      } else dm.style.display = ds.style.display = 'none';
      // dây sáng theo trạng thái
      var csLow = T >= 0.5 && T < 9.5;
      var clkAct = false;
      for (var c2 = 0; c2 < 8; c2++) if (T >= 1.5 + c2 && T < 2 + c2) clkAct = true;
      q('[data-w="cs"]').classList.toggle('is-dim', !csLow);
      q('[data-w="clk"]').classList.toggle('is-dim', !clkAct);
      q('[data-w="miso"]').classList.toggle('is-dim', !csLow);
    }

    var steps = [];
    function buildSteps() {
      var m = cfg.m, s = cfg.s, list = [];
      list.push({ t: [0, 0.45], dur: 2000, text: 'Đường truyền rảnh: CS = 1 (chưa chọn slave nào), SCLK đứng yên ở mức nghỉ ' + cpol() + ' (CPOL = ' + cpol() + '), MISO đang thả nổi.' });
      list.push({ t: [0.45, 1], dur: 2400, text: cpha()
        ? 'Master kéo CS xuống 0 để chọn slave. Ở mode này (CPHA = 1), bit đầu tiên chỉ được đặt lên dây ở cạnh clock đầu tiên.'
        : 'Master kéo CS xuống 0 để chọn slave. Cả hai đặt sẵn bit cao nhất (MSB) lên dây: master đặt ' + bitOf(m, 0) + ' lên MOSI, slave đặt ' + bitOf(s, 0) + ' lên MISO.' });
      for (var i = 0; i < 8; i++) list.push({ t: [1 + i, 2 + i], dur: 2400,
        text: 'Nhịp ' + (i + 1) + '/8, cạnh ' + edgeName() + ' của SCLK: slave đọc bit ' + (7 - i) + ' của master (' + bitOf(m, i) + ') trên MOSI, cùng lúc master đọc bit ' +
          (7 - i) + ' của slave (' + bitOf(s, i) + ') trên MISO. Hai thanh ghi cùng dịch trái một ô.' + (i === 0 ? ' SPI thường gửi bit cao nhất (MSB) trước.' : '') });
      list.push({ t: [9, 10], dur: 3400, text: 'Đủ 8 nhịp: hai thanh ghi đã đổi chỗ — master giữ ' + hex(s) + ' của slave, slave giữ ' + hex(m) + ' của master. Master nhả CS lên 1: xong, không có ACK nào.' });
      steps.length = 0;
      list.forEach(function (x) { steps.push({ state: { t0: x.t[0], t1: x.t[1] }, text: x.text, dur: x.dur }); });
    }
    function modeText() {
      return 'Mode ' + cfg.mode + ' (CPOL = ' + cpol() + ', CPHA = ' + cpha() + '): SCLK nghỉ ở mức ' + cpol() + ', hai bên lấy mẫu ở cạnh ' + edgeName() +
        (cpha() ? ' (cạnh thứ hai của mỗi nhịp).' : ' (cạnh đầu tiên của mỗi nhịp).');
    }

    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      '<div class="np-seg" role="group" aria-label="Chọn SPI mode">' +
        [0, 1, 2, 3].map(function (m) { return '<button type="button" class="np-btn" data-mode="' + m + '">Mode ' + m + '</button>'; }).join('') + '</div>' +
      '<label class="np-field">Master gửi <input class="np-input" data-in="m" value="0xA5" maxlength="10" spellcheck="false" aria-label="Byte master gửi, ví dụ 0xA5"></label>' +
      '<label class="np-field">Slave gửi <input class="np-input" data-in="s" value="0x3C" maxlength="10" spellcheck="false" aria-label="Byte slave gửi, ví dụ 0x3C"></label>' +
      '<button type="button" class="np-btn" data-send>Gửi lại từ đầu</button>' +
      '<span class="np-err" data-err role="alert"></span>' +
      '<span class="np-modeinfo" data-modeinfo></span>';

    function apply(s) { t0 = s.t0; t1 = s.t1; T = t0; render(); }
    function syncMode() {
      Array.prototype.forEach.call(tryBox.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.mode) === cfg.mode)); });
      tryBox.querySelector('[data-modeinfo]').textContent = 'Mode ' + cfg.mode + ': nghỉ ' + cpol() + ', lấy mẫu cạnh ' + edgeName();
    }
    buildSteps(); rebuildWaves(); syncMode();
    var player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);

    tryBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (b) {
        cfg.mode = Number(b.dataset.mode);
        buildSteps(); rebuildWaves(); syncMode(); render();
        player.manual(modeText());
      }
      if (e.target.closest('[data-send]')) send();
    });
    function send() {
      var m = parseByte(tryBox.querySelector('[data-in="m"]').value), s = parseByte(tryBox.querySelector('[data-in="s"]').value);
      var err = tryBox.querySelector('[data-err]');
      if (m === null || s === null) { err.textContent = 'Nhập 1 byte: 0x00–0xFF, 0–255, 8 bit nhị phân hoặc 1 ký tự.'; return; }
      err.textContent = '';
      cfg.m = m; cfg.s = s;
      buildSteps(); rebuildWaves(); player.restart();
    }
    Array.prototype.forEach.call(tryBox.querySelectorAll('input'), function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    });

    var raf = 0, lastP = -1;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!player.visible()) return;
      var pr = player.progress();
      if (pr === lastP) return;
      lastP = pr;
      T = t0 + (t1 - t0) * pr;
      render();
    }
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* =========================================================
     SƠ ĐỒ 4 — I2C: 1 master + 3 slave chung SDA/SCL (open-drain + điện trở kéo lên) và giản đồ một giao dịch ghi
       Thời gian T tính theo ô bit: START lúc T = 0.6; bit k chiếm ô [1 + k, 2 + k]: SDA đổi lúc 1.1 + k (SCL đang thấp),
       SCL cao trong [1.3 + k, 1.8 + k], các bên lấy mẫu lúc 1.55 + k; sau bit cuối là STOP.
     ========================================================= */
  function mountI2c(host) {
    var P = 32, X0 = 100, TEND = 20;                               // 1 bit = 32px trên giản đồ
    var tx = function (T) { return X0 + T * P; };
    var LANE = { scl: [340, 366], sda: [396, 422] };               // [y mức 1, y mức 0]
    var SLV = [{ a: 0x48, name: 'ADS1115', x: 200 }, { a: 0x68, name: 'MPU6050', x: 360 }, { a: 0x3C, name: 'OLED', x: 520 }];
    var cfg = { addr: 0x68, data: 0x6B };
    var T = 0, t0 = 0, t1 = 0, tk = 0;    // tk: "thời điểm chính" của bước, hiện khi đang dừng (bấm ⏭)
    var man = null;                       // null = đang trình diễn; [master, slave0, slave1, slave2] = người đọc tự kéo SDA
    var ti = -1, nb = 0, E = 0, bits = [], outAt = [], flds = [], fldRects = [];
    var bin7 = function (v) { var b = ('000000' + v.toString(2)).slice(-7); return b.slice(0, 3) + ' ' + b.slice(3); };
    var bin8 = function (v) { var b = ('0000000' + v.toString(2)).slice(-8); return b.slice(0, 4) + ' ' + b.slice(4); };
    var devName = function (i) { return i === 0 ? 'master' : hex2(SLV[i - 1].a) + ' (' + SLV[i - 1].name + ')'; };   // 0 = master
    var RES = 'l9 4.5 l-18 9 l18 9 l-18 9 l18 9 l-18 9 l9 4.5';      // điện trở răng cưa cao 54px
    var tag = function (id, x, y) {                                // nhãn "↓0": thiết bị này đang kéo SDA xuống
      return '<g class="np-pulltag" data-tag="' + id + '" transform="translate(' + x + ' ' + y + ')">' +
        '<rect x="-14" y="-9" width="28" height="18" rx="4"/><text text-anchor="middle" y="4">↓0</text></g>';
    };

    var devs = '', sdaTaps = '', sclTaps = '', jn = '', gnd = 'M80 190 V272 H585', tags = tag(0, 123, 110);
    SLV.forEach(function (s, i) {
      var x = s.x;
      devs += '<g class="np-dev" data-dev="' + i + '"><rect class="np-box-r" x="' + x + '" y="190" width="130" height="60" rx="10"/>' +
        '<text class="np-t-strong" x="' + (x + 12) + '" y="213" style="font-size:15px">' + hex2(s.a) + '</text>' +
        '<text class="np-t-dim" x="' + (x + 118) + '" y="212" text-anchor="end">' + s.name + '</text>' +
        '<text class="np-devst" data-st="' + i + '" x="' + (x + 12) + '" y="238"></text></g>';
      sdaTaps += ' M' + (x + 40) + ' 110 V144 a6 6 0 0 1 0 12 V190';           // nhảy qua dây SCL (không nối)
      sclTaps += ' M' + (x + 90) + ' 150 V190';
      jn += '<circle class="np-jn" cx="' + (x + 40) + '" cy="110" r="4"/><circle class="np-jn" cx="' + (x + 90) + '" cy="150" r="4"/>';
      gnd += ' M' + (x + 65) + ' 250 V272';
      tags += tag(i + 1, x + 40, 170);
    });

    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 470" role="img" aria-label="Bus I2C: một master và ba slave 0x48, 0x68, 0x3C nối chung hai dây SDA và SCL, mỗi dây một điện trở kéo lên; bên dưới là giản đồ thời gian của một giao dịch ghi">' +
        '<text class="np-t-strong" data-val="st1" x="20" y="28"></text><text data-val="st2" x="20" y="50"></text>' +
        // nguồn 3.3 V và hai điện trở kéo lên
        '<line class="np-vcc" x1="664" y1="30" x2="748" y2="30"/><text class="np-vcc-t" x="656" y="34" text-anchor="end">3.3 V</text>' +
        '<path class="np-res" data-r="sda" d="M700 30 V44 ' + RES + ' V110"/><path class="np-res" data-r="scl" d="M730 30 V80 ' + RES + ' V150"/>' +
        '<text x="688" y="62" text-anchor="end">R kéo lên</text><text class="np-t-dim" x="688" y="78" text-anchor="end">4.7 kΩ</text>' +
        // hai dây bus (SDA vẽ sau để chỗ nhảy dây nằm trên SCL)
        '<path class="np-sig np-sig-clk" d="M140 150 H730' + sclTaps + '"/>' +
        '<path class="np-sig np-sig-data" d="M140 110 H700' + sdaTaps + '"/>' +
        jn + '<circle class="np-jn" cx="700" cy="110" r="4"/><circle class="np-jn" cx="730" cy="150" r="4"/>' +
        '<text class="np-sigt-data" x="320" y="102" text-anchor="middle">SDA · dữ liệu</text>' +
        '<text class="np-sigt-clk" x="320" y="142" text-anchor="middle">SCL · nhịp clock</text>' +
        '<text class="np-t-val" data-val="lsda" x="672" y="103" text-anchor="middle"></text>' +
        '<text class="np-t-val" data-val="lscl" x="672" y="143" text-anchor="middle"></text>' +
        // master + 3 slave + đất chung
        '<path class="np-gnd" d="' + gnd + '" fill="none" style="stroke-width:2"/><text class="np-gnd-t" x="595" y="276">GND chung</text>' +
        '<rect class="np-box-r" x="20" y="70" width="120" height="120" rx="12"/>' +
        '<text class="np-t-strong" x="34" y="94">MASTER</text><text class="np-t-dim" x="34" y="112">ESP32</text>' +
        '<text class="np-t-dim" x="34" y="132">tạo nhịp SCL</text><text class="np-devst" data-st="m" x="34" y="176"></text>' +
        devs + tags +
        // bit đang đi trên dây SDA
        '<g data-el="dotm"><circle class="np-bitdot-m" r="10"/><text class="np-bitdot-t" text-anchor="middle" dy="4"></text></g>' +
        '<g data-el="dots"><circle class="np-bitdot-s" r="10"/><text class="np-bitdot-t np-bitdot-t--light" text-anchor="middle" dy="4"></text></g>' +
        // giản đồ thời gian
        '<rect class="np-hl" data-el="hl" y="288" width="' + P + '" height="172"/>' +
        '<g data-el="flds"></g>' +
        '<text class="np-t-dim" x="20" y="307">TRƯỜNG</text><text class="np-sigt-clk" x="20" y="357">SCL</text>' +
        '<text class="np-sigt-data" x="20" y="413">SDA</text><text class="np-t-dim" x="20" y="455">AI GIỮ</text>' +
        '<g data-el="samples"></g>' +
        '<path class="np-sig np-sig-clk" data-wave="scl"/><path class="np-sig np-sig-data" data-wave="sda"/>' +
        '<path class="np-sig np-sig-miso" data-wave="sdas"/>' +
        '<g data-el="labels"></g>' +
        '<line class="np-cursor" data-el="cur" y1="288" y2="462"/><polygon class="np-sample-dot" data-el="curtip" points="0,0 0,0 0,0"/>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-clk)"></i>SCL</span><span><i style="--c:var(--np-data)"></i>SDA · master gửi</span>' +
        '<span><i style="--c:var(--np-miso)"></i>SDA · slave kéo xuống (ACK)</span><span><i style="--c:var(--np-vcc)"></i>điện trở đang kéo dây lên 1</span>' +
        '<span><i style="--c:var(--primary)"></i>thời điểm hiện tại / lấy mẫu</span>' +
        '<span>AI GIỮ: M = master kéo · S = slave kéo · R = điện trở kéo lên</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var cur = q('[data-el="cur"]'), curtip = q('[data-el="curtip"]'), hl = q('[data-el="hl"]');
    var rSda = q('[data-r="sda"]'), rScl = q('[data-r="scl"]'), lsda = q('[data-val="lsda"]'), lscl = q('[data-val="lscl"]');
    var st1 = q('[data-val="st1"]'), st2 = q('[data-val="st2"]'), mst = q('[data-st="m"]');
    var dotm = q('[data-el="dotm"]'), dots = q('[data-el="dots"]');
    var tagEls = [0, 1, 2, 3].map(function (i) { return q('[data-tag="' + i + '"]'); });
    var devG = SLV.map(function (s, i) { return q('[data-dev="' + i + '"]'); });
    var devSt = SLV.map(function (s, i) { return q('[data-st="' + i + '"]'); });

    function wave(segs, lane) {           // [tBắtĐầu, tKếtThúc, mức] → đường bậc thang
      var d = '', prev = null;
      segs.forEach(function (sg) {
        var y = sg[2] ? lane[0] : lane[1];
        if (prev === null) d += 'M' + tx(sg[0]).toFixed(1) + ' ' + y; else if (prev !== sg[2]) d += 'V' + y;
        d += 'H' + tx(sg[1]).toFixed(1); prev = sg[2];
      });
      return d;
    }
    function drvText(who, x) {            // hàng "AI GIỮ": M master kéo · S slave kéo · R không ai kéo (điện trở kéo lên)
      var c = who === 'm' ? ['np-sigt-data', 'M'] : typeof who === 'number' ? ['np-sigt-miso', 'S'] : ['np-vcc-t', 'R'];
      return '<text class="' + c[0] + '" x="' + x + '" y="455" text-anchor="middle">' + c[1] + '</text>';
    }

    // Dựng lại mọi thứ phụ thuộc địa chỉ / dữ liệu: danh sách bit, trường, dạng sóng, nhãn, các bước
    function rebuild() {
      ti = -1;
      SLV.forEach(function (s, i) { if (s.a === cfg.addr) ti = i; });
      nb = ti >= 0 ? 18 : 9;              // có ACK: địa chỉ + R/W + ACK + 8 bit dữ liệu + ACK; NACK: dừng sau 9 bit
      E = 1 + nb;
      bits = [];
      var k, v;
      for (k = 0; k < 7; k++) { v = (cfg.addr >> (6 - k)) & 1; bits.push({ v: v, who: v ? null : 'm', kind: 'addr' }); }
      bits.push({ v: 0, who: 'm', kind: 'rw' });
      bits.push(ti >= 0 ? { v: 0, who: ti, kind: 'ack' } : { v: 1, who: null, kind: 'nack' });
      if (ti >= 0) {
        for (k = 0; k < 8; k++) { v = (cfg.data >> (7 - k)) & 1; bits.push({ v: v, who: v ? null : 'm', kind: 'data' }); }
        bits.push({ v: 0, who: ti, kind: 'ack' });
      }
      outAt = SLV.map(function (s) {     // lúc slave nhận ra "không phải mình" (bit địa chỉ đầu tiên khác)
        for (var j = 0; j < 7; j++) if (((s.a >> (6 - j)) & 1) !== bits[j].v) return 1.55 + j;
        return Infinity;
      });

      flds = [[0.3, 1, 'S', ''], [1, 8, 'ĐỊA CHỈ ' + hex2(cfg.addr) + ' · ' + bin7(cfg.addr), ''], [8, 9, 'W', '']];
      if (ti >= 0) flds.push([9, 10, 'ACK', 'is-ack'], [10, 18, 'DỮ LIỆU ' + hex2(cfg.data) + ' · ' + bin8(cfg.data), ''], [18, 19, 'ACK', 'is-ack'], [19, 20, 'P', '']);
      else flds.push([9, 10, 'NACK', 'is-nack'], [10, 11, 'P', ''], [11, 20, 'bus rảnh — không có slave ' + hex2(cfg.addr), 'is-idle']);
      var fh = '';
      flds.forEach(function (f) {
        fh += '<g><rect class="np-fld ' + f[3] + '" x="' + (tx(f[0]) + 1).toFixed(1) + '" y="292" width="' + ((f[1] - f[0]) * P - 2).toFixed(1) + '" height="22" rx="4"/>' +
          '<text class="np-fldt" x="' + tx((f[0] + f[1]) / 2).toFixed(1) + '" y="307" text-anchor="middle">' + esc(f[2]) + '</text></g>';
      });
      q('[data-el="flds"]').innerHTML = fh;
      fldRects = Array.prototype.slice.call(q('[data-el="flds"]').querySelectorAll('rect'));

      var scl = [[0, 0.85, 1], [0.85, 1.3, 0]];
      for (k = 0; k < nb; k++) { scl.push([1.3 + k, 1.8 + k, 1]); scl.push([1.8 + k, k < nb - 1 ? 2.3 + k : E + 0.3, 0]); }
      scl.push([E + 0.3, TEND, 1]);
      var sda = [[0, 0.6, 1], [0.6, 1.1, 0]], sdas = '', lab = '', smp = '';
      for (k = 0; k < nb; k++) {
        var b = bits[k], xm = tx(1.6 + k).toFixed(1), sx = tx(1.55 + k).toFixed(1);
        sda.push([1.1 + k, 2.1 + k, b.v]);
        if (typeof b.who === 'number') sdas += 'M' + tx(1.1 + k).toFixed(1) + ' ' + LANE.sda[1] + 'H' + tx(2.1 + k).toFixed(1);
        lab += '<text class="' + (typeof b.who === 'number' ? 'np-sigt-miso' : 'np-wavet') + '" x="' + xm + '" y="' + (LANE.sda[0] - 6) + '" text-anchor="middle">' + b.v + '</text>' + drvText(b.who, xm);
        smp += '<line class="np-sample" x1="' + sx + '" y1="334" x2="' + sx + '" y2="428"/><circle class="np-sample-dot" cx="' + sx + '" cy="' + LANE.scl[0] + '" r="3"/>';
      }
      sda.push([E + 0.1, E + 0.6, 0]); sda.push([E + 0.6, TEND, 1]);
      lab += drvText('m', tx(0.85).toFixed(1)) + drvText('m', tx(E + 0.35).toFixed(1));      // START, STOP: master kéo SDA
      q('[data-wave="scl"]').setAttribute('d', wave(scl, LANE.scl));
      q('[data-wave="sda"]').setAttribute('d', wave(sda, LANE.sda));
      q('[data-wave="sdas"]').setAttribute('d', sdas);
      q('[data-el="labels"]').innerHTML = lab;
      q('[data-el="samples"]').innerHTML = smp;
      buildSteps();
    }

    function sdaAt(T) {                   // mức SDA và ai đang kéo ('m' = master, 0…2 = slave, null = không ai)
      if (T < 0.6) return { v: 1, who: null };
      if (T < 1.1) return { v: 0, who: 'm' };
      var k = Math.floor(T - 1.1);
      if (k < nb) return bits[k];
      if (T < E + 0.6) return { v: 0, who: 'm' };
      return { v: 1, who: null };
    }
    function sclAt(T) {
      if (T < 0.85 || T >= E + 0.3) return 1;
      var u = T - 1;
      if (u < 0) return 0;
      var f = u - Math.floor(u);
      return Math.floor(u) < nb && f >= 0.3 && f < 0.8 ? 1 : 0;
    }
    function sclText(scl) {
      if (T < 0.6) return 'SCL = 1 · bus rảnh, chưa có nhịp';
      if (T < 0.85) return 'SCL = 1 · SDA vừa xuống khi SCL đang cao → START';
      if (T >= E + 0.3 && T < E + 0.6) return 'SCL = 1 · master sắp thả SDA lên khi SCL đang cao';
      if (T >= E + 0.6) return T < E + 1.3 ? 'SCL = 1 · SDA vừa lên khi SCL đang cao → STOP' : 'SCL = 1 · bus rảnh';
      return scl ? 'SCL = 1 · cao: các bên đọc SDA, không ai được đổi' : 'SCL = 0 · thấp: lúc được phép đổi SDA';
    }
    function masterState() {
      if (T < 0.6) return 'rảnh';
      if (T < 1.1) return 'START';
      var k = Math.floor(T - 1.1);
      if (k < nb) {
        var kind = bits[k].kind;
        if (kind === 'addr') return 'gửi địa chỉ';
        if (kind === 'rw') return 'gửi W = 0';
        if (kind === 'data') return 'gửi dữ liệu';
        if (T < 1.55 + k) return 'buông SDA…';
        return kind === 'nack' ? 'NACK ✗' : 'nhận ACK ✓';
      }
      if (T < E + 0.6) return 'STOP';
      return ti >= 0 ? 'xong ✓' : 'bỏ cuộc';
    }
    function slaveState(i) {
      if (T < 0.6) return ['rảnh', ''];
      if (T >= E + 0.6) return i === ti ? ['đã nhận ' + hex2(cfg.data), 'is-sel'] : ['rảnh', ''];
      if (T >= outAt[i]) return ['không phải mình', 'is-off'];
      if (T < 7.55) return ['đang nghe…', ''];
      var k = Math.floor(T - 1.1);       // từ đây chỉ còn slave đúng địa chỉ
      if (k >= nb) return ['đã nhận ' + hex2(cfg.data), 'is-sel'];
      if (bits[k].kind === 'ack') return ['ACK: kéo SDA ↓', 'is-ack'];
      if (bits[k].kind === 'data') {
        var s = '', n = 0;
        for (var j = 0; j < 8; j++) if (T >= 10.55 + j) { s += (n === 4 ? ' ' : '') + bits[9 + j].v; n++; }
        return [n ? 'nhận ' + s : 'chờ dữ liệu…', 'is-sel'];
      }
      return ['đúng tên mình!', 'is-sel'];
    }
    function along(xEnd, down, f) {       // điểm trên dây SDA: từ chân master (140,110) sang phải tới xEnd rồi xuống
      var len = (xEnd - 140) + down, d = f * len;
      return d <= xEnd - 140 ? [140 + d, 110] : [xEnd, 110 + d - (xEnd - 140)];
    }
    function place(g, pt, v) {
      g.setAttribute('transform', 'translate(' + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1) + ')');
      g.querySelector('text').textContent = v;
    }

    function render() {
      var x = tx(T);
      cur.setAttribute('x1', x.toFixed(1)); cur.setAttribute('x2', x.toFixed(1));
      curtip.setAttribute('points', (x - 6) + ',282 ' + (x + 6) + ',282 ' + x + ',290');
      var bk = Math.floor(T - 1);
      if (bk >= 0 && bk < nb) { hl.style.display = ''; hl.setAttribute('x', tx(1 + bk)); } else hl.style.display = 'none';
      fldRects.forEach(function (r, j) { r.classList.toggle('is-cur', T >= flds[j][0] && T < flds[j][1]); });

      var pull = [false, false, false, false], sda, scl = sclAt(T);
      if (man) { pull = man.slice(); sda = pull.some(Boolean) ? 0 : 1; }
      else {
        var d = sdaAt(T);
        sda = d.v;
        if (d.who === 'm') pull[0] = true; else if (typeof d.who === 'number') pull[d.who + 1] = true;
      }
      tagEls.forEach(function (g, i) { g.style.display = pull[i] ? '' : 'none'; });
      rSda.classList.toggle('is-on', sda === 1);
      rScl.classList.toggle('is-on', scl === 1);
      lsda.textContent = '= ' + sda; lscl.textContent = '= ' + scl;
      var np = pull.filter(Boolean).length;
      st1.textContent = sda ? 'SDA = 1 · không ai kéo → điện trở kéo lên giữ mức 1'
        : np === 1 ? 'SDA = 0 · ' + devName(pull.indexOf(true)) + ' đang kéo xuống'
        : 'SDA = 0 · ' + np + ' thiết bị cùng kéo — vẫn là 0, không chập mạch';
      st2.textContent = man ? 'Open-drain: chỉ được kéo xuống hoặc buông tay, không ai đẩy dây lên 1' : sclText(scl);

      mst.textContent = man ? (pull[0] ? 'kéo SDA ↓' : 'buông SDA') : masterState();
      SLV.forEach(function (s, i) {
        var stt = man ? (pull[i + 1] ? ['kéo SDA ↓', 'is-ack'] : ['buông SDA', '']) : slaveState(i);
        devSt[i].textContent = stt[0];
        devG[i].setAttribute('class', 'np-dev' + (stt[1] ? ' ' + stt[1] : ''));
      });

      // chấm bit: vàng = master gửi (đi tới mọi slave khi gọi địa chỉ, tới đúng slave khi gửi dữ liệu); lam = ACK của slave đi về master
      var showM = false, showS = false;
      if (!man) {
        var k = Math.floor(T - 1.1), u = T - 1.1 - k;
        if (k >= 0 && k < nb && u < 0.7) {
          var b = bits[k], f = Math.min(1, u / 0.45);
          if (typeof b.who === 'number') { place(dots, along(SLV[b.who].x + 40, 80, 1 - f), b.v); showS = true; }
          else if (b.kind !== 'nack') { place(dotm, b.kind === 'data' ? along(SLV[ti].x + 40, 80, f) : along(690, 0, f), b.v); showM = true; }
        }
      }
      dotm.style.display = showM ? '' : 'none';
      dots.style.display = showS ? '' : 'none';
    }

    var steps = [];
    function buildSteps() {
      var a = cfg.addr, list = [], tg = ti >= 0 ? SLV[ti] : null;
      list.push({ t: [0, 0.55], dur: 2600, text: 'Bus rảnh: không ai kéo dây, hai điện trở kéo lên giữ SDA và SCL ở mức 1. Ba slave đều đang nghe.' });
      list.push({ t: [0.55, 1], dur: 3000, text: 'START: master kéo SDA xuống 0 trong khi SCL vẫn ở mức 1. Đây là lần “phá luật” có chủ đích — mọi slave hiểu là “chú ý, bắt đầu!”.' });
      for (var k = 0; k < 7; k++) {
        var v = bits[k].v, outs = [];
        SLV.forEach(function (s, i) { if (outAt[i] === 1.55 + k) outs.push(hex2(s.a)); });
        list.push({ t: [1 + k, 2 + k], dur: k === 0 ? 4200 : 2600, text: 'Bit địa chỉ ' + (k + 1) + '/7 (A' + (6 - k) + ') = ' + v + ': ' +
          (v ? 'master buông SDA, điện trở kéo lên đưa dây lên 1.' : 'master kéo SDA xuống 0.') +
          (k === 0 ? ' SDA chỉ đổi khi SCL thấp; SCL lên cao thì mọi slave cùng đọc. Gửi bit 1 nghĩa là buông tay.' : ' SCL lên cao, các slave đọc.') +
          (outs.length ? ' ' + outs.join(', ') + ' thấy bit này khác địa chỉ của mình → thôi nghe.' : '') });
      }
      list.push({ t: [8, 9], dur: 3200, text: 'Bit thứ 8 là R/W = 0: master muốn GHI. Byte đầu tiên trên dây là ' + hex2(a << 1) + ' (' + hex2(a) + ' dịch trái 1 bit, thêm bit W).' });
      if (tg) {
        list.push({ t: [9, 10], dur: 3800, text: 'Nhịp thứ 9: master buông SDA. Chỉ ' + hex2(a) + ' (' + tg.name + ') nhận ra tên mình và kéo SDA xuống 0 → ACK: “Có!”. Hai slave còn lại im lặng.' });
        for (var j = 0; j < 8; j++) {
          var dv = bits[9 + j].v;
          list.push({ t: [10 + j, 11 + j], dur: j === 0 ? 3600 : 2400, text: 'Bit dữ liệu ' + (j + 1) + '/8 (D' + (7 - j) + ') = ' + dv + ': ' +
            (dv ? 'master buông, SDA về 1 nhờ điện trở kéo lên' : 'master kéo SDA xuống 0') + '; ' + tg.name + ' đọc khi SCL cao.' +
            (j === 0 ? ' Byte dữ liệu ' + hex2(cfg.data) + ', bit cao nhất (MSB) đi trước.' : '') });
        }
        list.push({ t: [18, 19], dur: 3200, text: 'Nhịp thứ 9 của byte dữ liệu: ' + tg.name + ' kéo SDA xuống lần nữa → ACK, đã nhận ' + hex2(cfg.data) + '.' });
        list.push({ t: [19, 20], dur: 3800, text: 'STOP: master giữ SDA ở 0, thả SCL lên 1, rồi thả SDA lên 1 trong lúc SCL đang cao. Bus rảnh, sẵn sàng cho giao dịch mới.' });
      } else {
        list.push({ t: [9, 10], dur: 4200, text: 'Nhịp thứ 9: master buông SDA, nhưng không ai có địa chỉ ' + hex2(a) + ' — SDA vẫn ở 1 nhờ điện trở kéo lên → NACK. Master hiểu là không có ai.' });
        list.push({ t: [10, 11], dur: 3400, text: 'Master gửi STOP và bỏ cuộc, không gửi byte dữ liệu. Trên Arduino, Wire.endTransmission() lúc này trả về 2 (NACK khi gửi địa chỉ).' });
        list.push({ t: [11, 12.5], dur: 2800, text: 'Bus rảnh trở lại. i2c.scan() cũng dò bus đúng như vậy: địa chỉ nào trả NACK là không có thiết bị.' });
      }
      // thời điểm chính: bit đã đặt lên dây và vừa được đọc (1.6 + k); bước đầu/cuối lấy lúc rảnh, START, STOP
      var key = function (t) {
        if (t[0] === 0) return 0.3;                 // rảnh
        if (t[0] === 0.55) return 0.75;             // START: SDA đã xuống, SCL còn cao
        if (t[0] === E) return E + 0.8;             // STOP: SDA đã lên khi SCL cao
        if (t[0] > E) return (t[0] + t[1]) / 2;     // bus rảnh sau NACK
        return t[0] + 0.6;                          // bit k: đã đặt lên dây và vừa được đọc
      };
      steps.length = 0;
      list.forEach(function (x) { steps.push({ state: { t0: x.t[0], t1: x.t[1], tk: key(x.t) }, text: x.text, dur: x.dur }); });
    }

    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      '<span class="np-field">Gọi địa chỉ</span>' +
      '<div class="np-seg" role="group" aria-label="Chọn địa chỉ master gọi">' +
        [0x48, 0x68, 0x3C, 0x50].map(function (a) {
          return '<button type="button" class="np-btn" data-addr="' + a + '">' + hex2(a) + (a === 0x50 ? ' · không có' : '') + '</button>';
        }).join('') + '</div>' +
      '<label class="np-field">Dữ liệu <input class="np-input" data-in="d" value="0x6B" maxlength="10" spellcheck="false" aria-label="Byte dữ liệu master ghi, ví dụ 0x6B"></label>' +
      '<button type="button" class="np-btn" data-send>Gửi lại từ đầu</button>' +
      '<span class="np-err" data-err role="alert"></span>';
    var odBox = h('div', 'np-try');
    odBox.innerHTML =
      '<span class="np-try-label">Open-drain</span>' +
      '<span class="np-field">Bấm để cho thiết bị kéo SDA</span>' +
      '<div class="np-seg" role="group" aria-label="Cho từng thiết bị kéo SDA xuống">' +
        ['Master', '0x48', '0x68', '0x3C'].map(function (n, i) {
          return '<button type="button" class="np-btn" data-pull="' + i + '" aria-pressed="false">' + n + '</button>';
        }).join('') + '</div>';
    var pullBtns = Array.prototype.slice.call(odBox.querySelectorAll('[data-pull]'));

    function syncAddr() {
      Array.prototype.forEach.call(tryBox.querySelectorAll('[data-addr]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.addr) === cfg.addr)); });
    }
    function apply(s) {
      man = null;                         // trình diễn lại: bỏ các nút "kéo SDA" người đọc đã bấm
      pullBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      t0 = s.t0; t1 = s.t1; tk = s.tk;
      T = player && player.playing() ? t0 : tk;   // đang phát: chạy từ đầu bước; đang dừng: hiện thời điểm chính
      render();
    }
    rebuild(); syncAddr();
    var player = null;
    player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);
    host.appendChild(odBox);

    tryBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-addr]');
      if (b) { cfg.addr = Number(b.dataset.addr); rebuild(); syncAddr(); player.restart(); }
      if (e.target.closest('[data-send]')) send();
    });
    function send() {
      var d = parseByte(tryBox.querySelector('[data-in="d"]').value), err = tryBox.querySelector('[data-err]');
      if (d === null) { err.textContent = 'Nhập 1 byte: 0x00–0xFF, 0–255, 8 bit nhị phân hoặc 1 ký tự.'; return; }
      err.textContent = '';
      cfg.data = d;
      rebuild(); player.restart();
    }
    tryBox.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    odBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pull]');
      if (!b) return;
      if (!man) man = [false, false, false, false];
      var i = Number(b.dataset.pull);
      man[i] = !man[i];
      b.setAttribute('aria-pressed', String(man[i]));
      render();
      var who = [];
      man.forEach(function (on, j) { if (on) who.push(j === 0 ? 'Master' : SLV[j - 1].name + ' (' + hex2(SLV[j - 1].a) + ')'); });
      player.manual(who.length === 0 ? 'Không ai kéo: SDA = 1 nhờ điện trở kéo lên.'
        : who.length === 1 ? who[0] + ' kéo SDA → SDA = 0. Chỉ cần một bên kéo là cả dây xuống 0.'
        : who.join(' và ') + ' cùng kéo → SDA vẫn = 0, không chập mạch vì không ai đẩy dây lên 1 (giống cổng AND nối dây).');
    });

    var raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!player.visible() || man) return;
      var pr = player.progress();
      var nt = !player.playing() && pr === 0 ? tk : t0 + (t1 - t0) * pr;
      if (nt === T) return;
      T = nt;
      render();
    }
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* =========================================================
     SƠ ĐỒ 5 — UART: 2 thiết bị nối chéo TX↔RX + GND; chuỗi ký tự đi qua dây theo khung 8N1 (hoặc có parity / 2 stop bit)
       Thời gian T tính theo bit của BÊN GỬI. Khung của ký tự k bắt đầu ở F[k] = 1 + k·(L + 1) (giữa hai khung nghỉ 1 bit).
       Bên nhận được mô phỏng thật: chờ cạnh xuống, lấy mẫu giữa mỗi bit theo baud rate CỦA NÓ → sai baud là ra rác.
     ========================================================= */
  function mountUart(host) {
    var X0 = 100, WZ = 640;                                        // vùng vẽ giản đồ: x 100 → 740
    var LANE = [320, 346];                                         // TX: [y mức 1, y mức 0]
    var cfg = { text: 'THIEN', baud: 9600, par: '', stop: 1, wrong: false };   // par: '' | 'even' | 'odd'
    var T = 0, t0 = 0, t1 = 0, tk = 0, win = 0;
    var chars = [], fl = 10, Fs = [], Gend = 0, rxr = 1, rx = [], Gfin = 0;
    var zk = -1, W0 = 0, P = 1, bandRects = [], smpEls = [], rxEls = [];   // khung đang phóng to trên giản đồ
    var zx = function (g) { return X0 + (g - W0) * P; };
    var ox = function (g) { return X0 + g * WZ / Gend; };          // dải "CHUỖI" thu nhỏ
    var fmtT = function (us) {                                     // 104,2 µs · 8,68 µs · 1,04 ms
      var s = us >= 1000 ? (us / 1000).toFixed(2) + ' ms' : us >= 10 ? +us.toFixed(1) + ' µs' : us.toFixed(2) + ' µs';
      return s.replace('.', ',');
    };
    var bin8 = function (v) { var b = ('0000000' + v.toString(2)).slice(-8); return b.slice(0, 4) + ' ' + b.slice(4); };
    var fmtName = function () { return '8' + (cfg.par === 'even' ? 'E' : cfg.par === 'odd' ? 'O' : 'N') + cfg.stop; };
    var rxBaud = function () { return cfg.wrong ? cfg.baud * 2 : cfg.baud; };     // "sai baud": bên nhận đặt gấp đôi
    var shown = function (b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : '�'; };
    var qc = function (x) { return '‘' + (x.ch === ' ' ? '␣' : x.ch) + '’'; };
    var parName = function () { return cfg.par === 'even' ? 'chẵn' : 'lẻ'; };

    var seq = '';
    for (var j0 = 0; j0 < 8; j0++) seq += '<tspan data-b="' + j0 + '"></tspan>' + (j0 < 7 ? ' ' : '');
    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 432" role="img" aria-label="Hai thiết bị nối chéo TX và RX qua UART; chuỗi ký tự đi qua dây TX theo từng khung start bit, 8 bit dữ liệu, parity, stop bit; bên nhận lấy mẫu giữa mỗi bit">' +
        '<text class="np-t-strong" data-val="st1" x="20" y="24"></text><text data-val="st2" x="20" y="44"></text>' +
        // hai dây nối chéo (vẽ trước hộp) + GND chung
        '<path class="np-sig np-sig-miso is-dim" d="M520 96 H430 L330 150 H240"/>' +
        '<path class="np-sig np-sig-data" d="M240 96 H330 L430 150 H520"/>' +
        '<polygon class="np-sigt-data" points="292,90 304,96 292,102"/><polygon class="np-sigt-miso" points="478,90 466,96 478,102" style="opacity:.45"/>' +
        '<text class="np-sigt-data" x="248" y="86">TX</text><text class="np-sigt-miso" x="248" y="170">RX</text>' +
        '<text class="np-sigt-miso" x="512" y="86" text-anchor="end">TX</text><text class="np-sigt-data" x="512" y="170" text-anchor="end">RX</text>' +
        '<text class="np-t-dim" x="380" y="80" text-anchor="middle">nối chéo TX ↔ RX</text>' +
        '<text class="np-t-dim" x="380" y="176" text-anchor="middle">(B → A đang rảnh)</text>' +
        '<path class="np-gnd" d="M130 190 V204 H630 V190" fill="none" style="stroke-width:2"/><text class="np-gnd-t" x="640" y="208">GND chung</text>' +
        // bên gửi
        '<rect class="np-box-r" x="20" y="58" width="220" height="132" rx="12"/>' +
        '<text class="np-t-strong" x="34" y="80">BÊN GỬI (A) · ESP32</text>' +
        '<text class="np-big" data-val="ch" x="34" y="128"></text>' +
        '<text data-val="asc" x="80" y="108"></text><text class="np-t-strong" data-val="bin" x="80" y="128"></text>' +
        '<text class="np-t-dim" x="34" y="156">lên dây, LSB trước:</text>' +
        '<text class="np-bitseq" x="34" y="178">' + seq + '</text>' +
        // bên nhận
        '<rect class="np-box-r" x="520" y="58" width="220" height="132" rx="12"/>' +
        '<text class="np-t-strong" x="536" y="80">BÊN NHẬN (B) · MÁY TÍNH</text>' +
        '<rect class="np-term" x="536" y="90" width="190" height="38" rx="6"/><text class="np-term-t" data-val="term" x="546" y="115"></text>' +
        '<text class="np-uart-s" data-val="bst" x="536" y="154"></text><text class="np-uart-s" data-val="bbaud" x="536" y="176"></text>' +
        // bit đang đi trên dây TX
        '<g data-el="dot"><circle class="np-bitdot-m" r="10"/><text class="np-bitdot-t" text-anchor="middle" dy="4"></text></g>' +
        // cả chuỗi thu nhỏ
        '<text class="np-t-dim" x="20" y="246">CHUỖI</text>' +
        '<rect class="np-ovwin" data-el="ovwin" y="218" height="34" rx="4"/>' +
        '<path class="np-sig np-sig-data" data-el="ovw" style="stroke-width:2"/><g data-el="ovl"></g>' +
        '<line class="np-cursor" data-el="ovcur" y1="218" y2="252"/>' +
        // giản đồ phóng to một khung
        '<clipPath id="np-uart-clip"><rect x="' + X0 + '" y="254" width="' + WZ + '" height="178"/></clipPath>' +
        '<text class="np-t-dim" x="20" y="278">KHUNG</text><text class="np-sigt-data" x="20" y="338">TX</text>' +
        '<text class="np-t-dim" x="20" y="372">RX ĐỌC</text><text class="np-t-dim" x="20" y="397">RX HIỂU</text>' +
        '<g clip-path="url(#np-uart-clip)">' +
          '<rect class="np-hl" data-el="hl" y="258" height="160"/>' +
          '<g data-el="band"></g><g data-el="dim"></g>' +
          '<path class="np-sig np-sig-data" data-el="wave"/><g data-el="vals"></g>' +
          '<g data-el="smp"></g><g data-el="rxb"></g><g data-el="time"></g>' +
          '<line class="np-cursor" data-el="cur" y1="258" y2="426"/>' +
        '</g>' +
        '<polygon class="np-sample-dot" data-el="curtip" points="0,0 0,0 0,0"/>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-data)"></i>TX · dây A → B</span><span><i style="--c:var(--np-miso)"></i>RX · dây B → A / giá trị bên nhận đọc</span>' +
        '<span><i style="--c:var(--np-gnd)"></i>GND</span><span><i style="--c:var(--primary)"></i>thời điểm hiện tại · vạch đứt: bên nhận lấy mẫu</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var el = {};
    ['st1', 'st2', 'ch', 'asc', 'bin', 'term', 'bst', 'bbaud'].forEach(function (k) { el[k] = q('[data-val="' + k + '"]'); });
    ['dot', 'ovwin', 'ovw', 'ovl', 'ovcur', 'hl', 'band', 'dim', 'wave', 'vals', 'smp', 'rxb', 'time', 'cur', 'curtip'].forEach(function (k) { el[k] = q('[data-el="' + k + '"]'); });
    var seqEls = Array.prototype.slice.call(svg.querySelectorAll('[data-b]'));

    // Mức trên dây TX ở thời điểm g, và bit nào của ký tự nào đang được gửi
    function bitAt(g) {
      if (g < 1) return null;
      var k = Math.floor((g - 1) / (fl + 1));
      if (k >= chars.length) return null;
      var u = g - Fs[k];
      return u < fl ? { k: k, i: Math.floor(u) } : null;
    }
    function lvl(g) { var b = bitAt(g); return b ? chars[b.k].bits[b.i].v : 1; }

    // Bên nhận: chờ cạnh xuống (1 → 0), rồi lấy mẫu giữa từng bit theo độ dài bit của nó (rxr, tính theo bit bên gửi)
    function simulate() {
      var out = [], g = 0, rl = 10 + (cfg.par ? 1 : 0);              // chỉ kiểm tra stop bit đầu tiên
      for (var guard = 0; guard < 160; guard++) {
        var s = -1;
        for (var t = Math.max(1, Math.ceil(g)); t <= Gend; t++) if (lvl(t - 0.5) === 1 && lvl(t + 0.5) === 0) { s = t; break; }
        if (s < 0) break;
        var smp = [], byte = 0, ones = 0, j;
        for (j = 0; j < rl; j++) { var ts = s + (j + 0.5) * rxr; smp.push({ t: ts, v: lvl(ts), j: j }); }
        if (smp[0].v !== 0) { g = smp[0].t; continue; }                // nhiễu, không phải start bit thật
        for (j = 0; j < 8; j++) { byte |= smp[1 + j].v << j; ones += smp[1 + j].v; }
        var perr = cfg.par ? (ones + smp[9].v) % 2 !== (cfg.par === 'even' ? 0 : 1) : false;
        out.push({ s: s, smp: smp, byte: byte, perr: perr, ferr: smp[rl - 1].v !== 1, end: smp[rl - 1].t });
        g = smp[rl - 1].t;
      }
      return out;
    }

    function rebuild() {
      chars = Array.prototype.map.call(cfg.text, function (ch) {
        var c = ch.charCodeAt(0), b = [{ v: 0, kind: 'start', name: 'S' }], ones = 0, j;
        for (j = 0; j < 8; j++) { var v = (c >> j) & 1; ones += v; b.push({ v: v, kind: 'data', name: 'D' + j, j: j }); }
        if (cfg.par) b.push({ v: cfg.par === 'even' ? ones % 2 : 1 - ones % 2, kind: 'par', name: 'P' });
        for (j = 0; j < cfg.stop; j++) b.push({ v: 1, kind: 'stop', name: cfg.stop > 1 ? 'SP' + (j + 1) : 'SP' });
        return { ch: ch, c: c, bits: b, ones: ones };
      });
      fl = chars[0].bits.length;
      Fs = chars.map(function (x, k) { return 1 + k * (fl + 1); });
      Gend = 1 + chars.length * (fl + 1);
      rxr = cfg.baud / rxBaud();
      rx = simulate();
      Gfin = Math.max(Gend, rx.length ? rx[rx.length - 1].end + 0.2 : 0);
      // dải cả chuỗi thu nhỏ
      var d = '', prev = null, lab = '';
      for (var g = 0; g < Gend; g++) {
        var v = lvl(g + 0.5), y = v ? 234 : 248;
        if (prev === null) d += 'M' + ox(g).toFixed(1) + ' ' + y; else if (prev !== v) d += 'V' + y;
        d += 'H' + ox(g + 1).toFixed(1); prev = v;
      }
      chars.forEach(function (x, k) { lab += '<text class="np-ovt" x="' + ox(Fs[k] + fl / 2).toFixed(1) + '" y="229" text-anchor="middle">' + esc(x.ch === ' ' ? '␣' : x.ch) + '</text>'; });
      el.ovw.setAttribute('d', d);
      el.ovl.innerHTML = lab;
      zk = -1;
      buildSteps();
    }

    // Vẽ lại phần giản đồ phóng to cho khung của ký tự k
    function buildZoom(k) {
      zk = k;
      var F = Fs[k], x = chars[k], bitUs = 1e6 / cfg.baud;
      W0 = F - 1; P = WZ / (fl + 2);
      var cell = function (a, b, label, cls, y) {
        return '<rect class="np-fld ' + cls + '" x="' + (zx(a) + 1).toFixed(1) + '" y="' + y + '" width="' + Math.max(1, (b - a) * P - 2).toFixed(1) + '" height="22" rx="4"/>' +
          '<text class="np-fldt" x="' + zx((a + b) / 2).toFixed(1) + '" y="' + (y + 15) + '" text-anchor="middle">' + label + '</text>';
      };
      var band = '<g>' + cell(W0, F, 'rảnh', 'is-idle', 262) + '</g>';
      x.bits.forEach(function (b, i) { band += '<g>' + cell(F + i, F + i + 1, b.name, b.kind === 'data' ? '' : b.kind === 'par' ? 'is-ack' : 'is-ss', 262) + '</g>'; });
      band += '<g>' + cell(F + fl, F + fl + 1, 'rảnh', 'is-idle', 262) + '</g>';
      el.band.innerHTML = band;
      bandRects = Array.prototype.slice.call(el.band.querySelectorAll('rect'));
      // dạng sóng TX + giá trị từng bit
      var d = '', prev = null, vals = '';
      for (var g = W0; g < W0 + fl + 2; g++) {
        var v = lvl(g + 0.5), y = v ? LANE[0] : LANE[1];
        if (prev === null) d += 'M' + zx(g).toFixed(1) + ' ' + y; else if (prev !== v) d += 'V' + y;
        d += 'H' + zx(g + 1).toFixed(1); prev = v;
      }
      x.bits.forEach(function (b, i) { vals += '<text class="np-wavet" x="' + zx(F + i + 0.5).toFixed(1) + '" y="313" text-anchor="middle">' + b.v + '</text>'; });
      el.wave.setAttribute('d', d);
      el.vals.innerHTML = vals;
      // thước đo 1 bit (đặt trên start bit)
      var xa = zx(F) + 3, xb = zx(F + 1) - 3;
      el.dim.innerHTML = '<path class="np-dimln" d="M' + xa + ' 290 V298 M' + xa + ' 294 H' + xb + ' M' + xb + ' 290 V298"/>' +
        '<text class="np-t-val" x="' + (xb + 9) + '" y="299">1 bit = ' + fmtT(bitUs) + '</text>';
      // các lần bên nhận lấy mẫu + cách bên nhận chia khung (chỉ những gì nằm trong khung đang xem)
      var W1 = W0 + fl + 2, sm = '', rb = '';
      rx.forEach(function (f, fi) {
        if (f.end < W0 - 0.5 || f.s > W1) return;
        f.smp.forEach(function (s, si) {
          if (s.t < W0 || s.t > W1) return;
          var sx = zx(s.t).toFixed(1);
          sm += '<g data-f="' + fi + '" data-s="' + si + '"><line class="np-sample" x1="' + sx + '" y1="306" x2="' + sx + '" y2="356"/>' +
            '<circle class="np-sample-dot" cx="' + sx + '" cy="' + (s.v ? LANE[0] : LANE[1]) + '" r="3.5"/>' +
            '<text class="np-rxv" x="' + sx + '" y="372" text-anchor="middle">' + s.v + '</text></g>';
        });
        f.smp.forEach(function (s, j) {            // mỗi ô hiện ra khi bên nhận bắt đầu đếm tới bit đó
          var a = f.s + j * rxr, b = a + rxr, last = j === f.smp.length - 1;
          var name = j === 0 ? 'S' : last ? 'SP' : cfg.par && j === 9 ? 'P' : (P * rxr >= 34 ? 'D' : '') + (j - 1);
          var cls = j === 0 ? 'is-ss' : last ? (f.ferr ? 'is-nack' : 'is-ss') : cfg.par && j === 9 ? (f.perr ? 'is-nack' : 'is-ack') : '';
          rb += '<g data-t="' + a + '">' + cell(a, b, name, cls, 382) + '</g>';
        });
      });
      el.smp.innerHTML = sm;
      el.rxb.innerHTML = rb;
      smpEls = Array.prototype.map.call(el.smp.children, function (n) { return { el: n, t: rx[+n.dataset.f].smp[+n.dataset.s].t }; });
      rxEls = Array.prototype.map.call(el.rxb.children, function (n) { return { el: n, t: Number(n.dataset.t) }; });
      // trục thời gian: vạch mỗi bit, nhãn ở đầu và cuối khung
      var tm = '';
      for (var b2 = 0; b2 <= fl; b2++) tm += '<line class="np-grid" x1="' + zx(F + b2).toFixed(1) + '" y1="406" x2="' + zx(F + b2).toFixed(1) + '" y2="412"/>';
      tm += '<text class="np-t-dim" x="' + zx(F).toFixed(1) + '" y="424" text-anchor="middle">0</text>' +
        '<text class="np-t-dim" x="' + zx(F + fl).toFixed(1) + '" y="424" text-anchor="middle">' + fmtT(fl * bitUs) + '</text>';
      el.time.innerHTML = tm;
      el.hl.setAttribute('width', P);
      el.ovwin.setAttribute('x', ox(W0).toFixed(1));
      el.ovwin.setAttribute('width', ((fl + 2) * WZ / Gend).toFixed(1));
    }

    function along(f) {                   // điểm trên dây TX vàng: (240,96) → (330,96) → (430,150) → (520,150)
      var d = f * 293.65;
      if (d <= 90) return [240 + d, 96];
      d -= 90;
      if (d <= 113.65) return [330 + 100 * d / 113.65, 96 + 54 * d / 113.65];
      return [430 + d - 113.65, 150];
    }

    function render() {
      if (win !== zk) buildZoom(win);
      var W1 = W0 + fl + 2, inWin = T >= W0 && T <= W1, x = zx(T);
      el.cur.style.display = el.curtip.style.display = inWin ? '' : 'none';
      el.cur.setAttribute('x1', x.toFixed(1)); el.cur.setAttribute('x2', x.toFixed(1));
      el.curtip.setAttribute('points', (x - 6) + ',252 ' + (x + 6) + ',252 ' + x + ',260');
      var cb = bitAt(T);
      if (cb && cb.k === zk) { el.hl.style.display = ''; el.hl.setAttribute('x', zx(Fs[zk] + cb.i).toFixed(1)); } else el.hl.style.display = 'none';
      var ci = Math.floor(T - W0);
      bandRects.forEach(function (r, i) { r.classList.toggle('is-cur', inWin && ci === i); });
      smpEls.forEach(function (o) { o.el.style.display = T >= o.t ? '' : 'none'; });
      rxEls.forEach(function (o) { o.el.style.display = T >= o.t ? '' : 'none'; });
      el.ovcur.setAttribute('x1', ox(Math.min(T, Gend)).toFixed(1)); el.ovcur.setAttribute('x2', ox(Math.min(T, Gend)).toFixed(1));

      // chấm bit chạy trên dây TX trong suốt thời gian của bit
      if (cb) {
        var pt = along(T - Math.floor(T));
        el.dot.style.display = '';
        el.dot.setAttribute('transform', 'translate(' + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1) + ')');
        el.dot.querySelector('text').textContent = chars[cb.k].bits[cb.i].v;
      } else el.dot.style.display = 'none';

      // bên gửi: ký tự của khung đang xem
      var cx = chars[zk];
      el.ch.textContent = cx.ch === ' ' ? '␣' : cx.ch;
      el.asc.textContent = 'ASCII ' + cx.c + ' · ' + hex2(cx.c);
      el.bin.textContent = bin8(cx.c);
      var curJ = cb && cb.k === zk && chars[zk].bits[cb.i].kind === 'data' ? chars[zk].bits[cb.i].j : -1;
      seqEls.forEach(function (s, j) { s.textContent = cx.bits[1 + j].v; s.setAttribute('class', j === curJ ? 'is-cur' : ''); });

      // bên nhận: các byte đã ghép xong + byte đang ghép
      var got = '', cur = null, last = null;
      rx.forEach(function (f) { if (f.end <= T) { got += shown(f.byte); last = f; } else if (f.s <= T) cur = f; });
      el.term.textContent = got.slice(-15) + '▌';
      if (cur) {
        var bs = cur.smp.filter(function (s) { return s.j >= 1 && s.j <= 8 && s.t <= T; }).map(function (s) { return s.v; });
        el.bst.textContent = bs.length ? 'đang ghép: ' + bs.join(' ')
          : T >= cur.smp[0].t ? 'start bit = 0 ✓, chờ bit D0…' : 'thấy cạnh xuống, chờ giữa start bit…';
      } else if (last) {
        el.bst.textContent = 'nhận ' + hex2(last.byte) + ' ‘' + shown(last.byte) + '’ ' +
          (last.ferr ? '✗ lỗi khung' : last.perr ? '✗ sai parity' : cfg.wrong ? '(tưởng là đúng)' : '✓');
      } else el.bst.textContent = 'chờ cạnh xuống…';
      el.bbaud.textContent = cfg.wrong ? 'nhận ' + rxBaud() + ' baud ✗ (lệch)' : 'nhận ' + cfg.baud + ' baud ✓';

      // hai dòng trạng thái
      if (cb) {
        var b = chars[cb.k].bits[cb.i], who = qc(chars[cb.k]);
        el.st1.textContent = 'TX = ' + b.v + ' · ' + (b.kind === 'start' ? 'start bit của ' + who
          : b.kind === 'data' ? 'bit D' + b.j + ' của ' + who + (b.j === 0 ? ' (LSB đi trước)' : '')
          : b.kind === 'par' ? 'bit parity (' + parName() + ') của ' + who : 'stop bit của ' + who);
      } else el.st1.textContent = 'TX = 1 · ' + (T < 1 ? 'rảnh (idle high), chưa gửi gì' : T >= Gend ? 'rảnh, đã gửi xong' : 'nghỉ giữa hai ký tự, giữ mức 1');
      el.st2.textContent = cfg.wrong
        ? 'Bên gửi ' + cfg.baud + ' baud, bên nhận ' + rxBaud() + ' baud ✗ → bên nhận lấy mẫu lệch chỗ'
        : cfg.baud + ' baud → 1 bit = ' + fmtT(1e6 / cfg.baud) + ' · khung ' + fmtName() + ' = ' + fl + ' bit = ' + fmtT(fl * 1e6 / cfg.baud);
    }

    var steps = [];
    function buildSteps() {
      var x = chars[0], F = Fs[0], B = cfg.baud, wr = cfg.wrong, n = chars.length, list = [], j;
      var smpIn = function (a, b) { var v = []; rx.forEach(function (f) { f.smp.forEach(function (s) { if (s.t >= a && s.t < b) v.push(s.v); }); }); return v; };
      var doneIn = function (a, b) {
        var d = rx.filter(function (f) { return f.end >= a && f.end < b; }).map(function (f) {
          return hex2(f.byte) + ' ‘' + shown(f.byte) + '’' + (f.ferr ? ' (lỗi khung)' : f.perr ? ' (sai parity)' : '');
        });
        return d.length ? ' Bên nhận ghép xong: ' + d.join(', ') + '.' : '';
      };
      var wrongBit = function (a) {
        var s = smpIn(a, a + 1);
        return (s.length ? ' Bên nhận đọc ' + s.length + ' lần trong bit này: ' + s.join(', ') + '.' : ' Bên nhận tưởng đã đọc xong một byte, đang chờ cạnh xuống mới — bỏ lỡ bit này.') + doneIn(a, a + 1);
      };
      var frameBits = function (c) {
        return 'start 0, rồi ' + c.bits.filter(function (b) { return b.kind === 'data'; }).map(function (b) { return b.v; }).join(' ') +
          (cfg.par ? ', parity ' + c.bits[9].v : '') + ', stop 1';
      };
      list.push({ t: [0, 1], tk: 0.5, w: 0, dur: 3000, text: 'Dây TX đang rảnh, giữ mức 1 (idle high). Không có dây clock: hai bên hẹn trước ' + B +
        ' baud, tức mỗi bit dài ' + fmtT(1e6 / B) + '.' + (wr ? ' Nhưng bên nhận lại đặt ' + rxBaud() + ' baud — nhanh gấp đôi.' : '') });
      list.push({ t: [F, F + 1], tk: F + 0.85, w: 0, dur: 3800, text: wr
        ? 'Start bit: TX kéo xuống 0 trong 1 bit. Bên nhận thấy cạnh xuống nhưng tưởng 1 bit chỉ dài ' + fmtT(1e6 / rxBaud()) + ': nó lấy mẫu sau 1/4 bit, rồi cứ nửa bit lại đọc một lần.'
        : 'Start bit: TX kéo xuống 0 trong đúng 1 bit. Bên nhận thấy cạnh xuống thì bắt đầu bấm giờ, đợi nửa bit rồi lấy mẫu giữa start bit — vẫn là 0, đúng là có ký tự tới.' });
      for (j = 0; j < 8; j++) {
        var a = F + 1 + j, v = x.bits[1 + j].v;
        list.push({ t: [a, a + 1], tk: a + 0.85, w: 0, dur: j === 0 ? 4600 : 2400, text: 'Bit D' + j + ' = ' + v +
          (j === 0 ? ' — bit thấp nhất (LSB) đi trước. ' + qc(x) + ' = ' + hex2(x.c) + ' = ' + bin8(x.c) + ', nên trên dây lần lượt là ' +
            x.bits.slice(1, 9).map(function (b) { return b.v; }).join(' ') + '.' : '.') +
          (wr ? wrongBit(a) : ' Bên nhận lấy mẫu đúng giữa bit, đọc được ' + v + '.') });
      }
      if (cfg.par) {
        var p = x.bits[9].v;
        list.push({ t: [F + 9, F + 10], tk: F + 9.85, w: 0, dur: 3600, text: 'Bit parity (' + parName() + ') = ' + p + ': ' + qc(x) + ' có ' + x.ones +
          ' bit 1, thêm ' + p + ' để tổng số bit 1 thành số ' + parName() + '. Bên nhận đếm lại để phát hiện lỗi 1 bit.' + (wr ? wrongBit(F + 9) : '') });
      }
      var s0 = F + 9 + (cfg.par ? 1 : 0);
      list.push({ t: [s0, F + fl], tk: F + fl - 0.15, w: 0, dur: 3600, text: (cfg.stop > 1 ? 'Hai stop bit = 1' : 'Stop bit = 1') + ': TX trở về mức 1. ' + (wr
        ? 'Ký tự ' + qc(x) + ' đã gửi xong, nhưng bên nhận lệch nhịp nên hiểu sai hoàn toàn.' + doneIn(s0, F + fl)
        : 'Bên nhận kiểm tra stop bit phải là 1, rồi ghép 8 bit thành ' + hex2(x.c) + ' = ' + qc(x) + ' ✓. Khung ' + fmtName() + ' tốn ' + fl + ' bit cho 1 byte, mất ' + fmtT(fl * 1e6 / B) + '.') });
      for (var k = 1; k < n; k++) {
        var c = chars[k];
        list.push({ t: [Fs[k] - 1, Fs[k] + fl], tk: Fs[k] + fl - 0.15, w: k, dur: 4400, text: wr
          ? qc(c) + ' = ' + hex2(c.c) + ' = ' + bin8(c.c) + '.' + (doneIn(Fs[k] - 1, Fs[k] + fl) || ' Bên nhận vẫn lệch nhịp, chưa ghép xong byte nào.')
          : qc(c) + ' = ' + hex2(c.c) + ' = ' + bin8(c.c) + ' → trên dây: ' + frameBits(c) + '.' + (k === 1 ? ' Mỗi khung mở đầu bằng start bit, nên bên nhận được canh lại giờ cho từng ký tự.' : '') });
      }
      var got = rx.map(function (f) { return shown(f.byte); }).join('');
      list.push({ t: [Fs[n - 1] + fl, Gfin], tk: Gfin, w: n - 1, dur: 4400, text: wr
        ? 'Bên gửi gửi “' + cfg.text + '” nhưng bên nhận in ra “' + got + '” — dữ liệu rác vì lệch baud rate. Đặt hai bên cùng ' + B + ' baud là hết.'
        : 'Xong: ' + n + ' khung × ' + fl + ' bit = ' + n * fl + ' bit, mất khoảng ' + fmtT(n * fl * 1e6 / B) + ' ở ' + B + ' baud. Bên nhận in ra “' + got +
          '”. Giữa hai khung, dây nghỉ ở mức 1 bao lâu cũng được.' });
      steps.length = 0;
      list.forEach(function (s) { steps.push({ state: { t0: s.t[0], t1: s.t[1], tk: s.tk, w: s.w }, text: s.text, dur: s.dur }); });
    }

    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      '<label class="np-field">Chuỗi <input class="np-input np-input--wide" data-in="s" value="THIEN" maxlength="8" spellcheck="false" autocomplete="off" aria-label="Chuỗi gửi qua UART, tối đa 8 ký tự ASCII"></label>' +
      '<button type="button" class="np-btn" data-send>Gửi lại từ đầu</button>' +
      '<div class="np-seg" role="group" aria-label="Baud rate">' +
        [9600, 115200].map(function (b) { return '<button type="button" class="np-btn" data-baud="' + b + '">' + b + ' baud</button>'; }).join('') + '</div>' +
      '<span class="np-err" data-err role="alert"></span>' +
      '<span class="np-modeinfo" data-ascii></span>';
    var frBox = h('div', 'np-try');
    frBox.innerHTML =
      '<span class="np-try-label">Khung</span>' +
      '<div class="np-seg" role="group" aria-label="Parity">' +
        [['', 'Không parity'], ['even', 'Parity chẵn'], ['odd', 'Parity lẻ']].map(function (p) { return '<button type="button" class="np-btn" data-par="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="np-seg" role="group" aria-label="Số stop bit">' +
        [1, 2].map(function (s) { return '<button type="button" class="np-btn" data-stop="' + s + '">' + s + ' stop bit</button>'; }).join('') + '</div>' +
      '<button type="button" class="np-btn" data-wrong aria-pressed="false">Bên nhận sai baud rate</button>' +
      '<span class="np-modeinfo" data-fmt></span>';

    function sync() {
      var each = function (box, sel, fn) { Array.prototype.forEach.call(box.querySelectorAll(sel), function (b) { b.setAttribute('aria-pressed', String(fn(b))); }); };
      each(tryBox, '[data-baud]', function (b) { return Number(b.dataset.baud) === cfg.baud; });
      each(frBox, '[data-par]', function (b) { return b.dataset.par === cfg.par; });
      each(frBox, '[data-stop]', function (b) { return Number(b.dataset.stop) === cfg.stop; });
      frBox.querySelector('[data-wrong]').setAttribute('aria-pressed', String(cfg.wrong));
      tryBox.querySelector('[data-ascii]').textContent = chars.map(function (c) { return (c.ch === ' ' ? '␣' : c.ch) + ' ' + hex2(c.c); }).join(' · ');
      frBox.querySelector('[data-fmt]').textContent = 'Khung ' + fmtName() + ' = ' + fl + ' bit · 1 bit = ' + fmtT(1e6 / cfg.baud) +
        (cfg.wrong ? ' · bên nhận ' + rxBaud() + ' baud' : '');
    }
    function apply(s) {
      t0 = s.t0; t1 = s.t1; tk = s.tk; win = s.w;
      T = player && player.playing() ? t0 : tk;     // đang phát: chạy từ đầu bước; đang dừng: hiện thời điểm chính
      render();
    }
    rebuild(); sync();
    var player = null;
    player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);
    host.appendChild(frBox);

    function redo() { rebuild(); sync(); player.restart(); }
    function send() {
      var s = tryBox.querySelector('[data-in="s"]').value.trim(), err = tryBox.querySelector('[data-err]');
      if (!/^[\x20-\x7E]{1,8}$/.test(s)) { err.textContent = 'Gõ 1–8 ký tự ASCII không dấu, vd. THIEN, OK, 42.'; return; }
      err.textContent = '';
      cfg.text = s;
      redo();
    }
    tryBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-baud]');
      if (b) { cfg.baud = Number(b.dataset.baud); redo(); }
      if (e.target.closest('[data-send]')) send();
    });
    tryBox.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    frBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-par], [data-stop], [data-wrong]');
      if (!b) return;
      if (b.hasAttribute('data-par')) cfg.par = b.dataset.par;
      else if (b.hasAttribute('data-stop')) cfg.stop = Number(b.dataset.stop);
      else cfg.wrong = !cfg.wrong;
      redo();
    });

    var raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!player.visible()) return;
      var pr = player.progress();
      var nt = !player.playing() && pr === 0 ? tk : t0 + (t1 - t0) * pr;
      if (nt === T) return;
      T = nt;
      render();
    }
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* =========================================================
     SƠ ĐỒ 6 — CAN: bus CAN_H/CAN_L, 120 Ω hai đầu, 4 node; 3 node cùng gửi → phân xử theo ID từng bit;
       khung chuẩn của bên thắng được dựng thật (CRC-15 của CAN, nhồi bit sau 5 bit giống nhau).
       Thời gian T tính theo bit trên dây: bit thứ k của khung (đã nhồi) chiếm [1 + k, 2 + k].
     ========================================================= */
  function mountCan(host) {
    var X0 = 110, WZ = 630;
    var NODES = [
      { name: 'PHANH / ABS', short: 'Phanh/ABS', lane: 'ABS TX', x: 40, id: 0x064, send: true },
      { name: 'ĐỘNG CƠ', short: 'Động cơ', lane: 'ĐỘNG CƠ', x: 212, id: 0x078, send: true },
      { name: 'ĐÈN', short: 'Đèn', lane: 'ĐÈN TX', x: 384, id: 0x300, send: true },
      { name: 'BẢNG ĐỒNG HỒ', short: 'Bảng đồng hồ', x: 556, send: false }
    ];
    var LANES = [[296, 310], [320, 334], [344, 358]];               // TX của 3 node gửi: [y mức 1, y mức 0]
    var vy = function (v) { return 404 - (v - 2.5) * 20; };        // điện áp → y (3,5 V ở 384, 1,5 V ở 424)
    var dy = function (d) { return 452 - d * 7; };                 // hiệu CAN_H − CAN_L → y
    var STRIP = [['SOF', 'SOF', 44], ['ID', 'ID 11 bit', 104], ['RTR', 'RTR', 44], ['CTL', 'IDE·r0', 58], ['DLC', 'DLC', 48],
      ['DATA', 'DATA', 96], ['CRC', 'CRC 15 bit', 96], ['ACK', 'ACK', 52], ['EOF', 'EOF 7 bit', 74]];
    var stripOf = function (f) { return f === 'IDE' || f === 'r0' ? 'CTL' : f; };
    var cfg = { data: [0x12, 0x34], noise: false };
    var T = 0, t0 = 0, t1 = 0, tk = 0, win = 0;
    var bits = [], N = 0, Gend = 0, wi = 0, lossAt = [], crc = 0, fs = {}, fe = {}, ackIdx = 0, wins = [], nStuff = 0;
    var zk = -1, W0 = 0, W1 = 1, P = 1, bandEls = [], stripEls = {};
    var zx = function (g) { return X0 + (g - W0) * P; };
    var hex3 = function (v) { return '0x' + ('00' + v.toString(16).toUpperCase()).slice(-3); };
    var hex4 = function (v) { return '0x' + ('000' + v.toString(16).toUpperCase()).slice(-4); };
    var bin = function (v, n) { var b = ''; for (var i = n - 1; i >= 0; i--) b += ((v >> i) & 1) + (i % 4 === 0 && i ? ' ' : ''); return b; };
    var fmtV = function (v) { return v.toFixed(1).replace('.', ',') + ' V'; };
    var nz = function (t) { return cfg.noise ? 0.28 * Math.sin(2 * Math.PI * t / 3.1) + 0.12 * Math.sin(2 * Math.PI * t / 0.7 + 1.3) : 0; };
    var busAt = function (t) { var k = Math.floor(t - 1); return k >= 0 && k < N ? bits[k].v : 1; };

    var taps = '', nodes = '', jn = '';
    NODES.forEach(function (n, i) {
      var x = n.x;
      taps += '<g class="np-cantap" data-tap="' + i + '"><path class="np-sig np-sig-data" d="M' + (x + 60) + ' 70 V94 a6 6 0 0 1 0 12 V128"/>' +
        '<path class="np-sig np-sig-miso" d="M' + (x + 98) + ' 100 V128"/></g>';
      jn += '<circle class="np-jn" cx="' + (x + 60) + '" cy="70" r="4"/><circle class="np-jn" cx="' + (x + 98) + '" cy="100" r="4"/>';
      nodes += '<g class="np-dev" data-dev="' + i + '"><rect class="np-box-r" x="' + x + '" y="128" width="158" height="66" rx="10"/>' +
        '<text class="np-t-strong" x="' + (x + 12) + '" y="148">' + n.name + '</text>' +
        (n.send ? '<text class="np-t-val" data-id="' + i + '" x="' + (x + 146) + '" y="148" text-anchor="end"></text>' : '') +
        '<text class="np-devst" data-st="' + i + '" x="' + (x + 12) + '" y="168"></text>' +
        '<text class="np-uart-s" data-ln="' + i + '" x="' + (x + 12) + '" y="186"></text></g>';
    });
    var res = function (x) {
      return '<path class="np-wire" d="M' + x + ' 70 V76 M' + x + ' 94 V100"/><rect class="np-res" x="' + (x - 5) + '" y="76" width="10" height="18" rx="1"/>' +
        '<text class="np-t-dim" x="' + x + '" y="58" text-anchor="middle">120 Ω</text>';
    };
    var laneLab = '';
    LANES.forEach(function (l, i) { laneLab += '<text class="np-t-dim" x="20" y="' + (l[1] - 2) + '">' + NODES[i].lane + '</text>'; });

    host.insertAdjacentHTML('beforeend',
      '<div class="np-stage"><svg class="np-svg" viewBox="0 0 760 466" role="img" aria-label="Bus CAN: cặp dây CAN_H và CAN_L có điện trở 120 ôm ở hai đầu, bốn node Phanh/ABS, Động cơ, Đèn, Bảng đồng hồ; ba node cùng gửi và phân xử theo ID; bên dưới là dải các trường của khung CAN và giản đồ mức bus, TX từng node, điện áp CAN_H, CAN_L">' +
        '<text class="np-t-strong" data-val="st1" x="20" y="22"></text><text data-val="st2" x="20" y="42"></text>' +
        // bus: hai dây (vẽ thẳng cho dễ nhìn), 120 Ω ở hai đầu, các node treo bên dưới
        taps +
        '<line class="np-sig np-sig-data" x1="24" y1="70" x2="736" y2="70"/><line class="np-sig np-sig-miso" x1="24" y1="100" x2="736" y2="100"/>' +
        jn + res(24) + res(736) +
        '<text class="np-sigt-data" x="150" y="63">CAN_H</text><text class="np-sigt-miso" x="150" y="117">CAN_L</text>' +
        '<text class="np-t-val" data-val="vh" x="377" y="63" text-anchor="middle"></text><text class="np-t-val" data-val="vl" x="377" y="117" text-anchor="middle"></text>' +
        '<path class="np-dimln" d="M560 58 q5 -8 10 0 t10 0 t10 0 t10 0"/><path class="np-dimln" d="M560 58 q5 8 10 0 t10 0 t10 0 t10 0"/>' +
        '<text class="np-t-dim" x="552" y="62" text-anchor="end">cặp dây xoắn</text>' +
        nodes +
        '<g data-el="dl"><circle class="np-bitdot-m" r="9"/><text class="np-bitdot-t" text-anchor="middle" dy="4"></text></g>' +
        '<g data-el="dr"><circle class="np-bitdot-m" r="9"/><text class="np-bitdot-t" text-anchor="middle" dy="4"></text></g>' +
        // dải các trường của khung
        '<text class="np-t-dim" x="20" y="226">KHUNG</text><rect class="np-ovwin" data-el="swin" y="206" height="30" rx="5"/><g data-el="strip"></g>' +
        // giản đồ phóng to
        '<clipPath id="np-can-clip"><rect x="' + X0 + '" y="244" width="' + WZ + '" height="222"/></clipPath>' +
        '<text class="np-t-dim" x="20" y="264">TRƯỜNG</text><text class="np-t-dim" x="20" y="290">BUS</text>' + laneLab +
        '<text class="np-sigt-data" x="20" y="388">CAN_H</text><text class="np-sigt-miso" x="20" y="428">CAN_L</text>' +
        '<text class="np-t-dim" x="104" y="388" text-anchor="end">3,5</text><text class="np-t-dim" x="104" y="408" text-anchor="end">2,5</text>' +
        '<text class="np-t-dim" x="104" y="428" text-anchor="end">1,5 V</text>' +
        '<text class="np-t-strong" x="20" y="455">H − L</text><text class="np-t-dim" x="104" y="442" text-anchor="end">2 V</text>' +
        '<g clip-path="url(#np-can-clip)">' +
          '<rect class="np-hl" data-el="hl" y="248" height="212"/>' +
          '<g data-el="band"></g><g data-el="busv"></g><g data-el="lanes"></g>' +
          '<line class="np-thr" x1="' + X0 + '" y1="384" x2="740" y2="384"/><line class="np-thr" x1="' + X0 + '" y1="404" x2="740" y2="404"/>' +
          '<line class="np-thr" x1="' + X0 + '" y1="424" x2="740" y2="424"/><line class="np-thr" x1="' + X0 + '" y1="452" x2="740" y2="452"/>' +
          '<path class="np-sig np-sig-data" data-el="vH" style="stroke-width:2.2"/><path class="np-sig np-sig-miso" data-el="vL" style="stroke-width:2.2"/>' +
          '<path class="np-diff" data-el="vD"/>' +
          '<line class="np-cursor" data-el="cur" y1="248" y2="462"/>' +
        '</g>' +
        '<polygon class="np-sample-dot" data-el="curtip" points="0,0 0,0 0,0"/>' +
      '</svg></div>' +
      '<div class="np-legend"><span><i style="--c:var(--np-data)"></i>CAN_H</span><span><i style="--c:var(--np-miso)"></i>CAN_L</span>' +
        '<span><i style="--c:var(--text)"></i>H − L: hiệu điện áp bên nhận đọc</span><span><i class="is-dot" style="--c:var(--primary)"></i>ô cam đậm: bit nhồi</span>' +
        '<span>nét đứt: node đang chỉ nghe · ✗: gửi 1 nhưng nghe 0 → thua</span><span><i style="--c:var(--primary)"></i>thời điểm hiện tại</span></div>');

    var svg = host.querySelector('svg');
    var q = function (sel) { return svg.querySelector(sel); };
    var el = {};
    ['st1', 'st2', 'vh', 'vl'].forEach(function (k) { el[k] = q('[data-val="' + k + '"]'); });
    ['dl', 'dr', 'swin', 'strip', 'hl', 'band', 'busv', 'lanes', 'vH', 'vL', 'vD', 'cur', 'curtip'].forEach(function (k) { el[k] = q('[data-el="' + k + '"]'); });
    var devG = NODES.map(function (n, i) { return q('[data-dev="' + i + '"]'); });
    var devSt = NODES.map(function (n, i) { return q('[data-st="' + i + '"]'); });
    var devLn = NODES.map(function (n, i) { return q('[data-ln="' + i + '"]'); });
    var tapG = NODES.map(function (n, i) { return q('[data-tap="' + i + '"]'); });

    // Dựng khung của bên thắng (ID nhỏ nhất), CRC-15, nhồi bit; tính bit mà mỗi node thua phân xử
    function rebuild() {
      wi = 0;
      for (var i = 1; i < 3; i++) if (NODES[i].id < NODES[wi].id) wi = i;
      var Wn = NODES[wi], u = [], k, n = cfg.data.length;
      var push = function (v, f, key, name) { u.push({ v: v, f: f, key: key, name: name }); };
      push(0, 'SOF', 'SOF', 'SOF');
      for (k = 10; k >= 0; k--) push((Wn.id >> k) & 1, 'ID', 'ID' + k, 'ID' + k);
      push(0, 'RTR', 'RTR', 'RTR'); push(0, 'IDE', 'IDE', 'IDE'); push(0, 'r0', 'r0', 'r0');
      for (k = 3; k >= 0; k--) push((n >> k) & 1, 'DLC', 'DLC', 'DLC');
      cfg.data.forEach(function (b, bi) { for (var j = 7; j >= 0; j--) push((b >> j) & 1, 'DATA', 'D' + bi, 'DATA ' + (bi + 1)); });
      crc = 0;                                                     // CRC-15 của CAN: x^15 + x^14 + x^10 + x^8 + x^7 + x^4 + x^3 + 1
      u.forEach(function (b) { var nx = b.v ^ ((crc >> 14) & 1); crc = (crc << 1) & 0x7FFF; if (nx) crc ^= 0x4599; });
      for (k = 14; k >= 0; k--) push((crc >> k) & 1, 'CRC', 'CRC', 'CRC');
      bits = []; nStuff = 0;
      var umap = [], last = -1, run = 0;
      u.forEach(function (b, ui) {                                 // nhồi bit từ SOF tới hết CRC
        umap[ui] = bits.length;
        bits.push({ v: b.v, tx: b.v, f: b.f, key: b.key, name: b.name });
        if (b.v === last) run++; else { last = b.v; run = 1; }
        if (run === 5) { var s = 1 - b.v; bits.push({ v: s, tx: s, f: b.f, key: 'n' + bits.length, name: 'nhồi', stuff: true }); nStuff++; last = s; run = 1; }
      });
      var tail = function (v, tx, f, key, name) { bits.push({ v: v, tx: tx, f: f, key: key, name: name }); };
      tail(1, 1, 'CRC', 'CRCD', 'DEL');
      ackIdx = bits.length; tail(0, 1, 'ACK', 'ACK', 'ACK');      // bên gửi để lặn, các node nhận kéo trội
      tail(1, 1, 'ACK', 'ACKD', 'DEL');
      for (k = 0; k < 7; k++) tail(1, 1, 'EOF', 'EOF', 'EOF');
      for (k = 0; k < 3; k++) tail(1, 1, 'IFS', 'IFS', 'nghỉ');
      N = bits.length; Gend = 1 + N;
      fs = {}; fe = {};
      bits.forEach(function (b, bi) { if (!(b.f in fs)) fs[b.f] = bi; fe[b.f] = bi + 1; });
      lossAt = NODES.map(function (nd, ni) {                       // node thua ở bit ID đầu tiên khác bên thắng (nó gửi 1, bus 0)
        if (!nd.send || ni === wi) return Infinity;
        for (var j = 10; j >= 0; j--) if (((nd.id >> j) & 1) !== ((Wn.id >> j) & 1)) return umap[1 + 10 - j];
        return Infinity;
      });
      var dEnd = n ? fe.DATA : fe.DLC;
      wins = [[0, 1 + fe.RTR + 0.5], [1 + fs.IDE - 0.5, 1 + dEnd + 0.5], [1 + fs.CRC - 0.5, Gend]];
      // dải các trường
      var sx = X0, sh = '';
      STRIP.forEach(function (s) {
        var label = s[0] === 'DATA' ? 'DATA ' + n + ' byte' : s[1];
        sh += '<g data-sf="' + s[0] + '" data-x="' + sx + '" data-w="' + s[2] + '"><rect class="np-fld' + (s[0] === 'DATA' && !n ? ' is-idle' : '') + '" x="' + (sx + 1) + '" y="210" width="' + (s[2] - 2) + '" height="22" rx="4"/>' +
          '<text class="np-fldt" x="' + (sx + s[2] / 2) + '" y="225" text-anchor="middle">' + label + '</text></g>';
        sx += s[2];
      });
      el.strip.innerHTML = sh;
      stripEls = {};
      Array.prototype.forEach.call(el.strip.children, function (g) { stripEls[g.dataset.sf] = g; });
      zk = -1;
      buildSteps();
    }

    function txOf(i, k) {                 // node i đang đưa gì ra chân TX ở bit k: 0/1 khi đang gửi, null khi chỉ nghe
      if (k < 0 || k >= N) return null;
      if (k === ackIdx) return i === wi ? 1 : 0;
      if (!NODES[i].send) return null;
      if (i === wi) return bits[k].f === 'IFS' ? null : bits[k].tx;
      if (k < lossAt[i]) return bits[k].v;
      return k === lossAt[i] ? 1 : null;
    }

    function buildZoom(w) {
      zk = w; W0 = wins[w][0]; W1 = wins[w][1]; P = WZ / (W1 - W0);
      var cell = function (a, b, label, cls) {
        var wd = (b - a) * P - 2, lab = label.length * 6.4 <= wd + 2 ? label : label === 'nhồi' ? 'n' : label.slice(0, Math.max(1, Math.floor((wd + 2) / 6.4)));
        return '<g data-a="' + a + '" data-b="' + b + '"><rect class="np-fld ' + cls + '" x="' + (zx(a) + 1).toFixed(1) + '" y="250" width="' + Math.max(1, wd).toFixed(1) + '" height="20" rx="4"/>' +
          '<text class="np-fldt" x="' + zx((a + b) / 2).toFixed(1) + '" y="264" text-anchor="middle">' + lab + '</text></g>';
      };
      var k0 = Math.max(0, Math.floor(W0 - 1)), k1 = Math.min(N, Math.ceil(W1 - 1)), band = W0 < 1 ? cell(W0, 1, 'rảnh', 'is-idle') : '', bv = '', i, j;
      for (i = k0; i < k1; i = j + 1) {   // gộp các bit liền nhau cùng trường (bit nhồi luôn là ô riêng)
        j = i;
        while (j + 1 < k1 && !bits[i].stuff && bits[j + 1].key === bits[i].key) j++;
        var b0 = bits[i];
        var cls = b0.stuff ? 'is-stuff' : b0.key === 'ACK' ? 'is-ack' : b0.f === 'IFS' ? 'is-idle' : b0.f === 'SOF' || b0.f === 'EOF' || b0.name === 'DEL' ? 'is-ss' : '';
        band += cell(Math.max(W0, 1 + i), Math.min(W1, 2 + j), b0.name, cls);
      }
      for (i = k0; i < k1; i++) bv += '<text class="' + (bits[i].stuff ? 'np-t-val' : 'np-wavet') + '" x="' + zx(1.5 + i).toFixed(1) + '" y="290" text-anchor="middle">' + bits[i].v + '</text>';
      el.band.innerHTML = band;
      el.busv.innerHTML = bv;
      bandEls = Array.prototype.map.call(el.band.children, function (g) { return { r: g.querySelector('rect'), a: +g.dataset.a, b: +g.dataset.b }; });
      // TX của 3 node gửi: nét liền khi đang gửi, nét đứt (ở mức lặn) khi chỉ nghe
      var lanes = '';
      LANES.forEach(function (ln, ni) {
        var d = '', dz = '', prev = null, mark = '';
        for (var k = Math.floor(W0 - 1); k < Math.ceil(W1 - 1); k++) {
          var a = Math.max(W0, 1 + k), b = Math.min(W1, 2 + k);
          if (a >= b) continue;
          var tx = txOf(ni, k), xa = zx(a).toFixed(1), xb = zx(b).toFixed(1);
          if (tx === null) {
            if (prev === 0) d += 'V' + ln[0];                          // vừa kéo trội (vd. ACK) → nhả về mức lặn
            dz += 'M' + xa + ' ' + ln[0] + 'H' + xb; prev = null; continue;
          }
          var y = tx ? ln[0] : ln[1];
          var start = a === W0 ? 'M' + xa + ' ' + y : 'M' + xa + ' ' + ln[0] + (tx ? '' : 'V' + y);   // bắt đầu gửi: từ mức lặn
          d += (prev === null ? start : prev !== tx ? 'V' + y : '') + 'H' + xb;
          prev = tx;
          if (k === lossAt[ni]) mark = '<text class="np-lose" x="' + (zx(b) + 3).toFixed(1) + '" y="' + (ln[0] + 12) + '">✗ thua</text>';
        }
        lanes += '<path class="np-sig np-sig-data" d="' + d + '" style="stroke-width:2.2"/><path class="np-wave-z np-sig-data" d="' + dz + '"/>' + mark;
      });
      el.lanes.innerHTML = lanes;
      // điện áp CAN_H, CAN_L (lặn: cùng 2,5 V, tách 1px để thấy cả hai nét) và hiệu H − L
      var pH = '', pL = '', pD = '', st = cfg.noise ? 1 / 16 : 0;
      if (st) {
        for (var t = W0; t <= W1 + 1e-9; t += st) {
          var v = busAt(t + 1e-6), n0 = nz(t), cmd = t === W0 ? 'M' : 'L';
          pH += cmd + zx(t).toFixed(1) + ' ' + (vy((v ? 2.5 : 3.5) + n0) - (v ? 1 : 0)).toFixed(1);
          pL += cmd + zx(t).toFixed(1) + ' ' + (vy((v ? 2.5 : 1.5) + n0) + (v ? 1 : 0)).toFixed(1);
        }
      }
      var pv = null;
      for (var g = Math.floor(W0); g < W1; g++) {
        var ga = Math.max(W0, g), gb = Math.min(W1, g + 1), vv = busAt(ga + 1e-6), xa2 = zx(ga).toFixed(1), xb2 = zx(gb).toFixed(1);
        if (!st) {
          var yh = vv ? vy(2.5) - 1 : vy(3.5), yl = vv ? vy(2.5) + 1 : vy(1.5);
          pH += (pv === null ? 'M' + xa2 + ' ' + yh : pv !== vv ? 'V' + yh : '') + 'H' + xb2;
          pL += (pv === null ? 'M' + xa2 + ' ' + yl : pv !== vv ? 'V' + yl : '') + 'H' + xb2;
        }
        var yd = dy(vv ? 0 : 2);
        pD += (pv === null ? 'M' + xa2 + ' ' + yd : pv !== vv ? 'V' + yd : '') + 'H' + xb2;
        pv = vv;
      }
      el.vH.setAttribute('d', pH); el.vL.setAttribute('d', pL); el.vD.setAttribute('d', pD);
      el.hl.setAttribute('width', P);
      // khung cửa sổ trên dải các trường
      var cover = [['SOF', 'RTR'], ['CTL', cfg.data.length ? 'DATA' : 'DLC'], ['CRC', 'EOF']][w];
      var ga1 = stripEls[cover[0]], gb1 = stripEls[cover[1]];
      el.swin.setAttribute('x', +ga1.dataset.x - 3);
      el.swin.setAttribute('width', +gb1.dataset.x + +gb1.dataset.w - +ga1.dataset.x + 6);
    }

    function nodeState(i, k) {
      var nd = NODES[i];
      if (k === ackIdx) return i === wi ? ['nghe thấy ACK ✓', 'is-sel'] : ['nhận đúng → ACK ↓', 'is-ack'];
      if (!nd.send) return [k >= 0 && k < N ? 'nghe mọi bản tin' : 'chỉ nghe', ''];
      if (k < 0) return ['muốn gửi ID ' + hex3(nd.id), ''];
      if (i === wi) return k < fe.RTR ? ['đang phân xử…', ''] : k < ackIdx ? ['thắng → gửi tiếp', 'is-sel'] : ['xong ✓', k < fs.IFS ? 'is-sel' : ''];
      if (k < lossAt[i]) return ['đang phân xử…', ''];
      if (k === lossAt[i]) return ['gửi 1, nghe 0 → thua', ''];
      if (k >= fs.IFS) return ['chuẩn bị gửi lại', ''];
      return ['thua ở ' + bits[lossAt[i]].name + ' → nghe', 'is-off'];
    }

    function render() {
      if (win !== zk) buildZoom(win);
      var inWin = T >= W0 && T <= W1, x = zx(T);
      el.cur.style.display = el.curtip.style.display = inWin ? '' : 'none';
      el.cur.setAttribute('x1', x.toFixed(1)); el.cur.setAttribute('x2', x.toFixed(1));
      el.curtip.setAttribute('points', (x - 6) + ',240 ' + (x + 6) + ',240 ' + x + ',248');
      var k = Math.floor(T - 1), on = k >= 0 && k < N, bv = on ? bits[k].v : 1;
      if (on && 1 + k >= W0 - 0.01 && 2 + k <= W1 + 0.01) { el.hl.style.display = ''; el.hl.setAttribute('x', zx(1 + k).toFixed(1)); } else el.hl.style.display = 'none';
      bandEls.forEach(function (o) { o.r.classList.toggle('is-cur', T >= o.a && T < o.b); });
      var sf = on ? stripOf(bits[k].f) : '';
      Object.keys(stripEls).forEach(function (f) { stripEls[f].querySelector('rect').classList.toggle('is-cur', f === sf); });

      var n0 = nz(T), vH = (bv ? 2.5 : 3.5) + n0, vL = (bv ? 2.5 : 1.5) + n0;
      el.vh.textContent = fmtV(vH); el.vl.textContent = fmtV(vL);
      var loseNow = [];
      NODES.forEach(function (nd, i) {
        var tx = txOf(i, k), st = nodeState(i, k);
        devSt[i].textContent = st[0];
        devG[i].setAttribute('class', 'np-dev' + (st[1] ? ' ' + st[1] : ''));
        devLn[i].textContent = !on ? 'bus rảnh = 1' : tx === null ? 'nghe: bus = ' + bv : 'gửi ' + tx + ' · nghe ' + bv + (tx !== bv ? (k === ackIdx ? ' ✓' : ' ✗') : '');
        tapG[i].classList.toggle('is-drive', tx === 0);
        if (nd.send) q('[data-id="' + i + '"]').textContent = hex3(nd.id);
        if (k === lossAt[i]) loseNow.push(nd.short);
      });
      // bit lan ra khắp bus từ node đang lái (ACK: từ một node nhận)
      if (on && bits[k].f !== 'IFS') {
        var sx = (k === ackIdx ? NODES[3].x : NODES[wi].x) + 60, f = T - 1 - k;
        [[el.dl, sx - f * (sx - 24)], [el.dr, sx + f * (736 - sx)]].forEach(function (p) {
          p[0].style.display = '';
          p[0].setAttribute('transform', 'translate(' + p[1].toFixed(1) + ' 70)');
          p[0].querySelector('text').textContent = bv;
        });
      } else el.dl.style.display = el.dr.style.display = 'none';

      var b = on ? bits[k] : null;
      var name = !b ? 'Bus rảnh' : b.stuff ? 'Bit nhồi' : b.f === 'IFS' ? 'Nghỉ giữa hai khung' : b.name === 'DEL' ? 'Bit phân cách (DEL)' : b.name;
      el.st1.textContent = name + ' · bus = ' + bv + (bv ? ' (lặn)' : ' (trội)') +
        (loseNow.length ? ' · ' + loseNow.join(', ') + ' gửi 1 nhưng nghe 0 → thua' : k === ackIdx ? ' · các node nhận kéo bus xuống trội' : '');
      el.st2.textContent = 'CAN_H ' + fmtV(vH) + ' · CAN_L ' + fmtV(vL) + ' · hiệu ' + fmtV(vH - vL) + ' → bit ' + (bv ? 'lặn (1)' : 'trội (0)') +
        (cfg.noise ? ' · nhiễu ' + (n0 >= 0 ? '+' : '−') + fmtV(Math.abs(n0)) + ' ăn vào cả hai dây' : '');
    }

    var steps = [];
    function buildSteps() {
      var Wn = NODES[wi], list = [], snd = [0, 1, 2], losers = snd.filter(function (i) { return i !== wi; });
      var stuffIn = function (a, b) {
        var c = 0; for (var i = a; i < b; i++) if (bits[i].stuff) c++;
        return c ? ' Có ' + c + ' bit nhồi (ô cam đậm) chen vào.' : '';
      };
      list.push({ t: [0, 1], tk: 0.5, w: 0, dur: 3200, text: 'Bus rảnh: không node nào lái, hai điện trở 120 Ω giữ CAN_H và CAN_L cùng quanh 2,5 V — hiệu 0 V, tức bit lặn (1). Ba node cùng có bản tin muốn gửi.' });
      list.push({ t: [1, 2], tk: 1.6, w: 0, dur: 3600, text: 'SOF: cả ba node thấy bus rảnh nên cùng bắt đầu bằng một bit trội (0). CAN_H lên khoảng 3,5 V, CAN_L xuống khoảng 1,5 V — hiệu 2 V.' });
      var active = snd.slice();
      for (var s = 1; s < fe.RTR; s++) {
        var b = bits[s], text, dur = 2400;
        if (b.stuff) {
          text = 'Bit nhồi = ' + b.v + ': vừa có 5 bit ' + (1 - b.v) + ' liên tiếp nên bên gửi chèn một bit ngược lại, để bus có cạnh cho mọi node canh lại đồng hồ. Bên nhận tự bỏ bit này.';
          dur = 4200;
        } else if (b.f === 'RTR') {
          text = 'RTR = 0: đây là khung dữ liệu. Hết vùng phân xử — ' + Wn.short + ' (ID ' + hex3(Wn.id) + ', nhỏ nhất) thắng mà bản tin không chậm, không hỏng bit nào. ' +
            losers.map(function (i) { return NODES[i].short; }).join(' và ') + ' chuyển sang nghe, sẽ tự gửi lại khi bus rảnh.';
          dur = 4600;
        } else {
          var lost = active.filter(function (i) { return lossAt[i] === s; });
          if (active.length > 1) {
            text = 'Bit ' + b.name + ': ' + active.map(function (i) { return NODES[i].short + ' gửi ' + (lossAt[i] === s ? 1 : b.v); }).join(', ') + ' → bus = ' + b.v + '.';
            if (s === 1) text += ' ID đi từ bit cao nhất; mỗi node vừa gửi vừa nghe lại bus.';
            if (lost.length) {
              text += ' ' + lost.map(function (i) { return NODES[i].short; }).join(', ') + ' gửi 1 (lặn) nhưng nghe thấy 0 (trội) → biết có bản tin quan trọng hơn, lặng lẽ thôi gửi và chuyển sang nghe.';
              dur = 4800;
            } else if (s === 1) dur = 4200;
          } else { text = 'Bit ' + b.name + ' = ' + b.v + ': chỉ còn ' + Wn.short + ' gửi.'; dur = 1800; }
          active = active.filter(function (i) { return lossAt[i] !== s; });
        }
        list.push({ t: [1 + s, 2 + s], tk: 1.6 + s, w: 0, dur: dur, text: text });
      }
      var n = cfg.data.length;
      list.push({ t: [1 + fs.IDE, 1 + fe.DLC], tk: fe.DLC + 0.8, w: 1, dur: 4200, text: 'IDE = 0 và r0 = 0: khung chuẩn, ID 11 bit. DLC = ' + bin(n, 4) + ': bản tin có ' + n +
        ' byte dữ liệu (tối đa 8).' + stuffIn(fs.IDE, fe.DLC) });
      cfg.data.forEach(function (byte, bi) {
        var a = bits.findIndex(function (x) { return x.key === 'D' + bi; }), e = a;
        while (e < N && (bits[e].key === 'D' + bi || (bits[e].stuff && bits[e].f === 'DATA' && bits[e - 1].key === 'D' + bi))) e++;
        list.push({ t: [1 + a, 1 + e], tk: e + 0.8, w: 1, dur: 4000, text: 'Byte dữ liệu ' + (bi + 1) + ' = ' + hex2(byte) + ' = ' + bin(byte, 8) +
          ', bit cao nhất đi trước (ngược với UART).' + stuffIn(a, e) });
      });
      list.push({ t: [1 + fs.CRC, 1 + fe.CRC], tk: fe.CRC + 0.8, w: 2, dur: 4600, text: 'CRC = ' + hex4(crc) + ': mã kiểm tra 15 bit tính từ SOF tới hết dữ liệu. Mọi node nhận tự tính lại và so sánh; sau CRC là 1 bit phân cách (delimiter) lặn.' + stuffIn(fs.CRC, fe.CRC) });
      list.push({ t: [1 + fs.ACK, 1 + fe.ACK], tk: ackIdx + 1.7, w: 2, dur: 4400, text: 'ACK: ' + Wn.short + ' gửi bit lặn, còn mọi node đã nhận đúng — ' +
        losers.concat([3]).map(function (i) { return NODES[i].short; }).join(', ') + ' — cùng kéo bus xuống trội. Nghe thấy 0, ' + Wn.short + ' biết ít nhất một node đã nhận được.' });
      var next = losers[0];
      losers.forEach(function (i) { if (NODES[i].id < NODES[next].id) next = i; });
      list.push({ t: [1 + fs.EOF, Gend], tk: Gend - 0.3, w: 2, dur: 4400, text: 'EOF: 7 bit lặn kết thúc khung, rồi 3 bit nghỉ. Bus rảnh — ' +
        losers.map(function (i) { return NODES[i].short; }).join(' và ') + ' lại phân xử với nhau, lần này ' + NODES[next].short + ' (ID ' + hex3(NODES[next].id) + ') thắng.' });
      steps.length = 0;
      list.forEach(function (x) { steps.push({ state: { t0: x.t[0], t1: x.t[1], tk: x.tk, w: x.w }, text: x.text, dur: x.dur }); });
    }

    var tryBox = h('div', 'np-try');
    tryBox.innerHTML =
      '<span class="np-try-label">Tự thử</span>' +
      [0, 1, 2].map(function (i) {
        return '<label class="np-field">' + ['ID ABS', 'Động cơ', 'Đèn'][i] + ' <input class="np-input" data-in="' + i + '" value="' + hex3(NODES[i].id) +
          '" maxlength="6" spellcheck="false" autocomplete="off" aria-label="ID 11 bit của ' + NODES[i].short + ', ví dụ ' + hex3(NODES[i].id) + '"></label>';
      }).join('') +
      '<button type="button" class="np-btn" data-send>Phân xử lại</button>' +
      '<span class="np-err" data-err role="alert"></span>';
    var dBox = h('div', 'np-try');
    dBox.innerHTML =
      '<span class="np-try-label">Khung</span>' +
      '<label class="np-field">Dữ liệu <input class="np-input" data-in="d" value="12 34" maxlength="11" spellcheck="false" autocomplete="off" aria-label="Dữ liệu bên thắng gửi: 0 đến 2 byte hex, ví dụ 12 34"></label>' +
      '<button type="button" class="np-btn" data-noise aria-pressed="false">Thêm nhiễu vào cả hai dây</button>' +
      '<span class="np-modeinfo" data-info></span>';

    function sync() {
      dBox.querySelector('[data-noise]').setAttribute('aria-pressed', String(cfg.noise));
      dBox.querySelector('[data-info]').textContent = 'Thắng: ' + NODES[wi].short + ' ' + hex3(NODES[wi].id) + ' · DLC ' + cfg.data.length +
        ' · CRC ' + hex4(crc) + ' · khung ' + (N - 3) + ' bit (' + nStuff + ' bit nhồi)';
    }
    function apply(s) {
      t0 = s.t0; t1 = s.t1; tk = s.tk; win = s.w;
      T = player && player.playing() ? t0 : tk;     // đang phát: chạy từ đầu bước; đang dừng: hiện thời điểm chính
      render();
    }
    rebuild(); sync();
    var player = null;
    player = createPlayer(host, { steps: steps, apply: apply });
    host.appendChild(tryBox);
    host.appendChild(dBox);

    function parseId(s) {
      s = String(s).trim();
      var v = /^0x[0-9a-f]{1,3}$/i.test(s) ? parseInt(s, 16) : /^\d{1,4}$/.test(s) ? Number(s) : -1;
      return v >= 0 && v <= 0x7FF ? v : null;
    }
    function parseData(s) {
      var tk2 = String(s).trim().split(/[\s,]+/).filter(Boolean);
      if (tk2.length > 2) return null;
      var out = [];
      for (var i = 0; i < tk2.length; i++) {
        if (!/^(0x)?[0-9a-f]{1,2}$/i.test(tk2[i])) return null;
        out.push(parseInt(tk2[i].replace(/^0x/i, ''), 16));
      }
      return out;
    }
    function send() {
      var ids = [0, 1, 2].map(function (i) { return parseId(tryBox.querySelector('[data-in="' + i + '"]').value); });
      var data = parseData(dBox.querySelector('[data-in="d"]').value), err = tryBox.querySelector('[data-err]');
      if (ids.indexOf(null) >= 0 || ids[0] === ids[1] || ids[0] === ids[2] || ids[1] === ids[2]) { err.textContent = 'ID là số 11 bit: 0x000–0x7FF, và ba ID phải khác nhau.'; return; }
      if (!data) { err.textContent = 'Dữ liệu: 0–2 byte hex, cách nhau bằng dấu cách, vd. 12 34.'; return; }
      err.textContent = '';
      ids.forEach(function (v, i) { NODES[i].id = v; });
      cfg.data = data;
      rebuild(); sync(); player.restart();
    }
    tryBox.addEventListener('click', function (e) { if (e.target.closest('[data-send]')) send(); });
    Array.prototype.forEach.call(host.querySelectorAll('.np-try input'), function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    });
    dBox.addEventListener('click', function (e) {
      if (!e.target.closest('[data-noise]')) return;
      cfg.noise = !cfg.noise;
      zk = -1; render(); sync();             // chỉ đổi cách vẽ điện áp, không chạy lại
    });

    var raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!player.visible()) return;
      var pr = player.progress();
      var nt = !player.playing() && pr === 0 ? tk : t0 + (t1 - t0) * pr;
      if (nt === T) return;
      T = nt;
      render();
    }
    raf = requestAnimationFrame(frame);
    return { destroy: function () { cancelAnimationFrame(raf); player.destroy(); } };
  }

  /* Danh sách sơ đồ: tên dùng trong data-np-diagram="…" */
  var DIAGRAMS = { gpio: mountGpio, pull: mountPull, spi: mountSpi, i2c: mountI2c, uart: mountUart, can: mountCan };

  /* Ảnh minh họa nhỏ cho thẻ bài lớn ở trang nhất (theo mã bài) */
  var ART = {
    gpio: '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: chân GPIO của con chip thắp sáng một LED">' +
      '<rect x="40" y="25" width="120" height="100" rx="10" fill="var(--scope-bg)"/>' +
      '<text x="100" y="80" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="15" font-weight="600">MCU</text>' +
      '<g stroke="var(--pin)" stroke-width="7">' +
        '<path d="M58 25V12M82 25V12M106 25V12M130 25V12M58 125v13M82 125v13M106 125v13M130 125v13M40 50H27M40 75H27M40 100H27"/></g>' +
      '<path d="M160 75H245" stroke="var(--primary)" stroke-width="3"/><path d="M160 50H175M160 100H175" stroke="var(--pin)" stroke-width="7"/>' +
      '<text x="200" y="66" text-anchor="middle" fill="var(--primary)" font-family="var(--mono)" font-size="12" font-weight="600">GPIO</text>' +
      '<path d="M245 75l7 -9l7 18l7 -18l7 18l7 -18l7 18l4 -9H310" fill="none" stroke="var(--text-muted)" stroke-width="2.5"/>' +
      '<circle cx="335" cy="75" r="22" fill="#facc15" opacity="0.35"/><polygon points="322,62 322,88 344,75" fill="#facc15" stroke="#b45309" stroke-width="2.5"/>' +
      '<path d="M346 62V88" stroke="#b45309" stroke-width="2.5"/><path d="M346 75H392V128" fill="none" stroke="var(--np-gnd)" stroke-width="2.5"/>' +
      '<path d="M380 128h24M385 134h14M390 140h4" stroke="var(--np-gnd)" stroke-width="2.5"/></svg>',
    pull: '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: điện trở kéo lên giữ chân MCU ở mức 1, nút nhấn nối xuống GND">' +
      '<path d="M190 16H400" stroke="var(--np-vcc)" stroke-width="3"/><text x="398" y="12" text-anchor="end" fill="var(--np-vcc)" font-family="var(--mono)" font-size="11" font-weight="600">3.3 V</text>' +
      '<rect x="30" y="40" width="110" height="70" rx="10" fill="var(--scope-bg)"/>' +
      '<text x="85" y="80" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="15" font-weight="600">MCU</text>' +
      '<path d="M140 75H240" stroke="var(--primary)" stroke-width="3"/><circle cx="240" cy="75" r="4.5" fill="var(--primary)"/>' +
      '<path d="M240 16V24l9 4.5l-18 9l18 9l-18 9l9 4.5V75" fill="none" stroke="var(--text-muted)" stroke-width="2.5"/>' +
      '<text x="256" y="48" fill="var(--primary)" font-family="var(--mono)" font-size="12" font-weight="700">PULL-UP 10 kΩ</text>' +
      '<path d="M240 75V96" stroke="var(--text-muted)" stroke-width="2.5"/><circle cx="240" cy="98" r="3.5" fill="var(--text-muted)"/>' +
      '<path d="M240 98L262 124" stroke="var(--text-muted)" stroke-width="3" stroke-linecap="round"/><circle cx="240" cy="128" r="3.5" fill="var(--text-muted)"/>' +
      '<path d="M240 128V140M226 140h28M231 146h18" stroke="var(--np-gnd)" stroke-width="2.5"/>' +
      '<text x="270" y="122" fill="var(--text-muted)" font-family="var(--mono)" font-size="11">nút</text>' +
      '<text x="190" y="100" text-anchor="end" fill="var(--np-miso)" font-family="var(--mono)" font-size="13" font-weight="700">IN = 1</text></svg>',
    spi: '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: master và slave đổi bit cho nhau qua MOSI và MISO theo nhịp clock">' +
      '<rect x="20" y="40" width="140" height="64" rx="10" fill="var(--scope-bg)"/><rect x="260" y="40" width="140" height="64" rx="10" fill="var(--scope-bg)"/>' +
      '<text x="90" y="60" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="11" font-weight="600">MASTER</text>' +
      '<text x="330" y="60" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="11" font-weight="600">SLAVE</text>' +
      [0, 1, 2, 3].map(function (k) {
        return '<rect x="' + (42 + k * 24) + '" y="70" width="20" height="20" rx="3" fill="#facc15"/><rect x="' + (282 + k * 24) + '" y="70" width="20" height="20" rx="3" fill="#60a5fa"/>';
      }).join('') +
      '<path d="M42 80H30V20H392V80H378" fill="none" stroke="var(--np-data)" stroke-width="3"/><path d="M370 20l10 -5v10z" fill="var(--np-data)"/>' +
      '<path d="M282 80H138" fill="none" stroke="var(--np-miso)" stroke-width="3"/><path d="M150 80l-10 -5v10z" fill="var(--np-miso)"/>' +
      '<text x="210" y="14" text-anchor="middle" fill="var(--np-data)" font-family="var(--mono)" font-size="11" font-weight="700">MOSI</text>' +
      '<text x="210" y="74" text-anchor="middle" fill="var(--np-miso)" font-family="var(--mono)" font-size="11" font-weight="700">MISO</text>' +
      '<path d="M40 132h22v-14h22v14h22v-14h22v14h22v-14h22v14h22v-14h22v14h22v-14h22v14h22v-14h22v14h22v-14h22v14h22" fill="none" stroke="var(--np-clk)" stroke-width="2.5"/>' +
      '<text x="20" y="130" text-anchor="end" fill="var(--np-clk)" font-family="var(--mono)" font-size="10" font-weight="700">SCLK</text></svg>',
    i2c: '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: một master và ba slave dùng chung hai dây SDA, SCL, mỗi dây một điện trở kéo lên">' +
      '<path d="M336 12H410" stroke="var(--np-vcc)" stroke-width="3"/>' +
      '<text x="330" y="16" text-anchor="end" fill="var(--np-vcc)" font-family="var(--mono)" font-size="10" font-weight="700">3.3 V</text>' +
      '<path d="M360 12v8l6 3l-12 6l12 6l-12 6l12 6l-6 3v10M388 12v32l6 3l-12 6l12 6l-12 6l12 6l-6 3v10" fill="none" stroke="var(--text-muted)" stroke-width="2"/>' +
      '<rect x="14" y="36" width="92" height="64" rx="10" fill="var(--scope-bg)"/>' +
      '<text x="60" y="72" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="12" font-weight="600">MASTER</text>' +
      '<path d="M106 84H388M178 84V106M254 84V106M330 84V106" fill="none" stroke="var(--np-clk)" stroke-width="3"/>' +
      '<path d="M106 60H360M148 60V106M224 60V106M300 60V106" fill="none" stroke="var(--np-data)" stroke-width="3"/>' +
      [[132, '0x48'], [208, '0x68'], [284, '0x3C']].map(function (s) {
        return '<rect x="' + s[0] + '" y="106" width="62" height="34" rx="7" fill="var(--scope-bg)"' + (s[1] === '0x68' ? ' stroke="var(--primary)" stroke-width="3"' : '') + '/>' +
          '<text x="' + (s[0] + 31) + '" y="128" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="11" font-weight="600">' + s[1] + '</text>' +
          '<circle cx="' + (s[0] + 16) + '" cy="60" r="3.5" fill="var(--np-data)"/><circle cx="' + (s[0] + 46) + '" cy="84" r="3.5" fill="var(--np-clk)"/>';
      }).join('') +
      '<circle cx="360" cy="60" r="3.5" fill="var(--np-data)"/><circle cx="388" cy="84" r="3.5" fill="var(--np-clk)"/>' +
      '<text x="114" y="53" fill="var(--np-data)" font-family="var(--mono)" font-size="10" font-weight="700">SDA</text>' +
      '<text x="114" y="78" fill="var(--np-clk)" font-family="var(--mono)" font-size="10" font-weight="700">SCL</text></svg>',
    uart: (function () {
      // khung UART của chữ T (0x54): rảnh, start, 8 bit LSB trước, stop, rảnh — mỗi bit 30px
      var lv = [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1], nm = ['', 'S', '0', '0', '1', '0', '1', '0', '1', '0', 'SP', ''], d = '', lab = '';
      lv.forEach(function (v, i) {
        var y = v ? 98 : 124, x = 30 + i * 30;
        d += (i === 0 ? 'M' + x + ' ' + y : (lv[i - 1] !== v ? 'V' + y : '')) + 'H' + (x + 30);
        if (nm[i]) lab += '<text x="' + (x + 15) + '" y="90" text-anchor="middle" fill="' + (i === 1 || i === 10 ? 'var(--primary)' : 'var(--text-muted)') + '" font-family="var(--mono)" font-size="10" font-weight="700">' + nm[i] + '</text>';
      });
      return '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: hai thiết bị nối chéo TX và RX, bên dưới là khung UART của chữ T">' +
        '<rect x="14" y="10" width="100" height="50" rx="10" fill="var(--scope-bg)"/><rect x="306" y="10" width="100" height="50" rx="10" fill="var(--scope-bg)"/>' +
        '<text x="64" y="40" text-anchor="middle" fill="#e6edf3" font-family="var(--mono)" font-size="12" font-weight="600">ESP32</text>' +
        '<text x="356" y="40" text-anchor="middle" fill="#4ade80" font-family="var(--mono)" font-size="12" font-weight="600">THIEN▌</text>' +
        '<path d="M306 24H250L170 48H114" fill="none" stroke="var(--np-miso)" stroke-width="3" opacity="0.55"/>' +
        '<path d="M114 24H170L250 48H306" fill="none" stroke="var(--np-data)" stroke-width="3"/>' +
        '<text x="122" y="18" fill="var(--np-data)" font-family="var(--mono)" font-size="10" font-weight="700">TX</text>' +
        '<text x="298" y="18" text-anchor="end" fill="var(--np-miso)" font-family="var(--mono)" font-size="10" font-weight="700">TX</text>' +
        lab + '<path d="' + d + '" fill="none" stroke="var(--np-data)" stroke-width="3"/>' +
        '<text x="210" y="144" text-anchor="middle" fill="var(--text-muted)" font-family="var(--mono)" font-size="10" font-weight="600">‘T’ = 0x54 · LSB đi trước</text></svg>';
    })(),
    can: (function () {
      // bus CAN_H / CAN_L, 120 Ω hai đầu, 3 node (ABS thắng), bên dưới là điện áp ở bit trội / lặn
      var lv = [1, 0, 1, 1, 0, 0, 1, 0, 1], h = '', l = '', mono = 'font-family="var(--mono)" font-weight="700"';
      lv.forEach(function (v, i) {
        var x = 30 + i * 40;
        h += (i === 0 ? 'M' + x + ' ' + (v ? 126 : 110) : (lv[i - 1] !== v ? 'V' + (v ? 126 : 110) : '')) + 'H' + (x + 40);
        l += (i === 0 ? 'M' + x + ' ' + (v ? 128 : 144) : (lv[i - 1] !== v ? 'V' + (v ? 128 : 144) : '')) + 'H' + (x + 40);
      });
      return '<svg viewBox="0 0 420 150" role="img" aria-label="Minh họa: ba node trên bus CAN có điện trở 120 ôm hai đầu, bên dưới là điện áp CAN_H và CAN_L ở bit trội và bit lặn">' +
        '<path d="M24 26H396" stroke="var(--np-data)" stroke-width="3"/><path d="M24 46H396" stroke="var(--np-miso)" stroke-width="3"/>' +
        '<rect x="19" y="30" width="10" height="12" fill="none" stroke="var(--text-muted)" stroke-width="2"/><rect x="391" y="30" width="10" height="12" fill="none" stroke="var(--text-muted)" stroke-width="2"/>' +
        [[60, 'ABS 0x064', true], [168, 'ĐỘNG CƠ', false], [276, 'ĐÈN', false]].map(function (n) {
          return '<path d="M' + (n[0] + 30) + ' 26V64M' + (n[0] + 56) + ' 46V64" stroke="var(--text-faint)" stroke-width="2"/>' +
            '<circle cx="' + (n[0] + 30) + '" cy="26" r="3.5" fill="var(--np-data)"/><circle cx="' + (n[0] + 56) + '" cy="46" r="3.5" fill="var(--np-miso)"/>' +
            '<rect x="' + n[0] + '" y="64" width="86" height="28" rx="7" fill="var(--scope-bg)"' + (n[2] ? ' stroke="var(--primary)" stroke-width="3"' : '') + '/>' +
            '<text x="' + (n[0] + 43) + '" y="82" text-anchor="middle" fill="#e6edf3" font-size="10" ' + mono + '>' + n[1] + '</text>';
        }).join('') +
        '<text x="34" y="20" fill="var(--np-data)" font-size="10" ' + mono + '>CAN_H</text><text x="366" y="60" fill="var(--np-miso)" font-size="10" ' + mono + '>CAN_L</text>' +
        '<path d="' + h + '" fill="none" stroke="var(--np-data)" stroke-width="2.5"/><path d="' + l + '" fill="none" stroke="var(--np-miso)" stroke-width="2.5"/>' +
        '<text x="90" y="104" text-anchor="middle" fill="var(--primary)" font-size="9" ' + mono + '>trội</text>' +
        '<text x="50" y="104" text-anchor="middle" fill="var(--text-muted)" font-size="9" ' + mono + '>lặn</text></svg>';
    })()
  };

  /* =========================================================
     "TỜ BÁO": trang nhất + trình đọc bài
     ========================================================= */
  function readMinutes(el) {
    var body = el.querySelector('.np-body');
    if (!body) return 0;
    var clone = body.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('pre, .np-diagram'), function (x) { x.remove(); });
    var words = clone.textContent.trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 200)) + el.querySelectorAll('.np-diagram').length;   // +1 phút mỗi sơ đồ
  }

  function buildPaper(section) {
    var ds = section.dataset;
    var arts = Array.prototype.filter.call(section.children, function (c) { return c.classList.contains('np-article'); })
      .map(function (el) {
        var kicker = (el.querySelector('.np-kicker') || {}).textContent || '';
        return {
          el: el, id: el.dataset.id, no: el.dataset.no || '', date: el.dataset.date || '',
          published: el.dataset.status !== 'upcoming',
          topic: kicker.split('·').pop().trim(),
          title: (el.querySelector('.np-headline') || {}).innerHTML || '',
          sapo: (el.querySelector('.np-sapo') || {}).textContent || ''
        };
      });
    var pubCount = 0;
    arts.forEach(function (a) {
      if (!a.published) { a.el.remove(); return; }
      pubCount++;
      a.minutes = readMinutes(a.el);
      var d = a.el.querySelector('[data-np-date]'), r = a.el.querySelector('[data-np-read]');
      if (d) d.textContent = a.date;
      if (r) r.textContent = '≈ ' + a.minutes + ' phút đọc';
    });

    // Tên báo
    var mast = h('header', 'np-masthead');
    mast.innerHTML =
      '<div class="np-mast-top"><span>Chuyên mục: ' + esc(ds.npTitle) + '</span><span>' + esc(ds.npIssue) + '</span></div>' +
      '<p class="np-mast-title">' + esc(ds.npMasthead).replace(/ · /g, ' <span class="np-dot">·</span> ') + '</p>' +
      '<p class="np-mast-sub">' + esc(ds.npTagline) + '</p>' +
      '<div class="np-mast-line"><span>' + esc(ds.npDate) + '</span><span>' + pubCount + '/' + arts.length + ' bài đã đăng</span><span>Biên tập: thienba</span></div>';

    // Trang nhất
    var front = h('div', 'np-front');
    var pubs = arts.filter(function (a) { return a.published; });
    var lead = pubs[pubs.length - 1] || arts[0];                 // bài mới đăng nhất lên thẻ lớn
    [lead].concat(arts.filter(function (a) { return a !== lead; })).forEach(function (a) {
      var isLead = a === lead;
      var card = h(a.published ? 'a' : 'div', 'np-card' + (isLead ? ' np-card--lead' : '') + (a.published ? '' : ' is-upcoming'));
      if (a.published) { card.href = '#bai-' + a.id; card.dataset.open = a.id; }
      else card.setAttribute('aria-disabled', 'true');
      card.innerHTML =
        '<p class="np-card-no">Bài ' + esc(a.no) + ' <span class="np-card-kicker">· ' + esc(a.topic) + '</span></p>' +
        (isLead && ART[a.id] ? '<div class="np-card-art">' + ART[a.id] + '</div>' : '') +
        '<h3 class="np-card-title">' + a.title + '</h3>' +
        '<p class="np-card-sapo">' + esc(a.sapo) + '</p>' +
        '<p class="np-card-meta">' + (a.published
          ? (isLead ? 'Đọc bài → · ' : '') + '≈ ' + a.minutes + ' phút đọc · ' + esc(a.date)
          : '<span class="np-soon">Sắp đăng</span>') + '</p>';
      front.appendChild(card);
    });

    // Trình đọc bài
    var reader = h('div', 'np-reader'); reader.hidden = true;
    var navTop = h('nav', 'np-artnav'); navTop.setAttribute('aria-label', 'Điều hướng bài viết');
    var navBot = h('nav', 'np-artnav np-artnav--bottom'); navBot.setAttribute('aria-label', 'Điều hướng bài viết');
    var slot = h('div', 'np-slot');
    reader.appendChild(navTop); reader.appendChild(slot); reader.appendChild(navBot);
    arts.forEach(function (a) { if (a.published) { a.el.hidden = true; a.el.id = 'bai-' + a.id; slot.appendChild(a.el); } });

    section.insertBefore(mast, section.firstChild);
    section.appendChild(front);
    section.appendChild(reader);

    var bar = h('div', 'np-progress'); bar.setAttribute('aria-hidden', 'true'); bar.hidden = true;
    var barFill = h('span'); bar.appendChild(barFill);
    document.body.appendChild(bar);

    var mounted = [], current = null;
    function navHtml(a) {
      var idx = arts.indexOf(a), prev = arts[idx - 1], next = arts[idx + 1];
      function pn(x, dir) {
        var label = dir === 'prev' ? '← Bài trước' : 'Bài sau →';
        if (!x) return '<button type="button" class="np-navbtn" disabled>' + label + '</button>';
        if (!x.published) return '<button type="button" class="np-navbtn" disabled>' + label + ' <small>(sắp đăng)</small></button>';
        return '<button type="button" class="np-navbtn" data-open="' + esc(x.id) + '" title="' + esc(x.topic) + '">' + label + ' <small>' + esc(x.topic) + '</small></button>';
      }
      return '<button type="button" class="np-navbtn" data-home>← Về trang nhất</button>' +
        '<div class="np-artnav-pn">' + pn(prev, 'prev') + pn(next, 'next') + '</div>';
    }
    function scrollToTop(el) {
      var y = el.getBoundingClientRect().top + window.scrollY - navHeight() - 16;
      window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function open(id, noScroll) {
      var a = arts.filter(function (x) { return x.id === id && x.published; })[0];
      if (!a) return;
      current = a;
      front.hidden = true;
      reader.hidden = false;
      arts.forEach(function (x) { if (x.published) x.el.hidden = x !== a; });
      navTop.innerHTML = navHtml(a); navBot.innerHTML = navHtml(a);
      Array.prototype.forEach.call(a.el.querySelectorAll('[data-np-diagram]'), function (host) {   // dựng sơ đồ lần đầu mở bài
        if (host._np) return;
        var fn = DIAGRAMS[host.dataset.npDiagram];
        if (fn) { host._np = fn(host); mounted.push(host._np); }
      });
      bar.hidden = false;
      onScroll();
      if (history.replaceState) history.replaceState(null, '', '#bai-' + a.id);
      if (!noScroll) scrollToTop(mast);
    }
    function home() {
      current = null;
      reader.hidden = true;
      front.hidden = false;
      bar.hidden = true;
      if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      scrollToTop(mast);
    }
    section.addEventListener('click', function (e) {
      var t = e.target.closest('[data-open], [data-home]');
      if (!t || !section.contains(t)) return;
      e.preventDefault();
      if (t.hasAttribute('data-home')) home(); else open(t.dataset.open);
    });

    // Thanh tiến độ đọc
    var raf = 0;
    function onScroll() {
      raf = 0;
      if (!current) return;
      var r = current.el.getBoundingClientRect(), nh = navHeight();
      var total = r.height - (window.innerHeight - nh);
      var p = total > 0 ? (nh - r.top) / total : 1;
      barFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)).toFixed(4) + ')';
    }
    var scrollHandler = function () { if (!raf) raf = requestAnimationFrame(onScroll); };
    window.addEventListener('scroll', scrollHandler, { passive: true });
    window.addEventListener('resize', scrollHandler);

    // Mở thẳng bài nếu đường dẫn có #bai-<mã>
    var m = location.hash.match(/^#bai-([a-z0-9-]+)$/i);
    if (m) open(m[1]);

    cleanups.push(function () {
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', scrollHandler);
      bar.remove();
      mounted.forEach(function (x) { if (x && x.destroy) x.destroy(); });
    });
  }

  /* ---------- Chờ người đọc mở khóa, dọn dẹp khi khóa lại ---------- */
  function check() {
    var box = lockRoot.querySelector('.edu-unlocked');
    if (box && !box._npReady) {
      box._npReady = true;
      Array.prototype.forEach.call(box.querySelectorAll('section.np'), buildPaper);
    } else if (!box && cleanups.length) {
      cleanups.splice(0).forEach(function (fn) { fn(); });
      if (/^#bai-/.test(location.hash) && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    }
  }
  new MutationObserver(check).observe(lockRoot, { childList: true });
  check();
})();
