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
    var steps = opts.steps, n = steps.length;
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
      cap.innerHTML = '<b>Bước ' + (k + 1) + '/' + n + '</b> ' + esc(steps[k].text);
    }
    function show(k) {
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

    function parseByte(str) {
      str = String(str).trim();
      if (/^0x[0-9a-f]{1,2}$/i.test(str)) return parseInt(str, 16);
      if (/^[01]{8}$/.test(str)) return parseInt(str, 2);
      if (/^\d{1,3}$/.test(str) && Number(str) <= 255) return Number(str);
      if (str.length === 1 && str.charCodeAt(0) < 256) return str.charCodeAt(0);   // một ký tự, vd. A → 0x41
      return null;
    }
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

  /* Danh sách sơ đồ: tên dùng trong data-np-diagram="…" */
  var DIAGRAMS = { gpio: mountGpio, pull: mountPull, spi: mountSpi };

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
      '<text x="20" y="130" text-anchor="end" fill="var(--np-clk)" font-family="var(--mono)" font-size="10" font-weight="700">SCLK</text></svg>'
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
