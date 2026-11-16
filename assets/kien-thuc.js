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

  /* Danh sách sơ đồ: tên dùng trong data-np-diagram="…" */
  var DIAGRAMS = { gpio: mountGpio };

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
      '<path d="M380 128h24M385 134h14M390 140h4" stroke="var(--np-gnd)" stroke-width="2.5"/></svg>'
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
    var lead = arts.filter(function (a) { return a.published; })[0] || arts[0];
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
