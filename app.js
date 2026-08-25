(function(){
  "use strict";

  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var $ = function(id){ return document.getElementById(id); };
  var MIN_BPM = 20, MAX_BPM = 300, MAX_BARS = 999, FAV_SLOTS = 6, MAX_SECTIONS = 60;

  // accent levels: 3 강 / 2 중 / 1 약 / 0 쉼
  // Compound meters keep their real grouping — 6/8 is two dotted-quarter groups,
  // so beat 4 gets a secondary accent instead of being a plain weak pulse.
  var METERS = [
    { label:"1/4",  acc:[3] },
    { label:"2/4",  acc:[3,1] },
    { label:"3/4",  acc:[3,1,1] },
    { label:"4/4",  acc:[3,1,1,1] },
    { label:"5/4",  acc:[3,1,1,2,1] },
    { label:"7/8",  acc:[3,1,1,2,1,2,1] },
    { label:"3/8",  acc:[3,1,1] },
    { label:"6/8",  acc:[3,1,1,2,1,1] },
    { label:"9/8",  acc:[3,1,1,2,1,1,2,1,1] },
    { label:"12/8", acc:[3,1,1,2,1,1,2,1,1,2,1,1] }
  ];
  function meterBy(label){
    for (var i=0;i<METERS.length;i++) if (METERS[i].label === label) return METERS[i];
    return METERS[3];
  }

  // Drawn rather than typed: Pretendard has no ♩ or ♬, and a real figure can show
  // how many notes the beat actually splits into.
  function head(cx){
    return '<ellipse cx="'+cx+'" cy="31" rx="6.2" ry="4.4" transform="rotate(-20 '+cx+' 31)"/>';
  }
  function stem(x, top){
    return '<rect x="'+x+'" y="'+top+'" width="2" height="'+(30-top)+'" rx=".7"/>';
  }
  function beam(x, y, w){
    return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="3.9" rx=".8"/>';
  }
  var NOTE_SVG = {
    // one quarter note
    1:'<svg viewBox="0 0 15 38" aria-hidden="true">' + head(7) + stem(11.3,4) + '</svg>',
    // two beamed eighths
    2:'<svg viewBox="0 0 35 38" aria-hidden="true">' + head(7) + head(27)
      + stem(11.3,6) + stem(31.3,6) + beam(11.3,4.4,22) + '</svg>',
    // three beamed eighths under a 3
    3:'<svg viewBox="0 0 44 38" aria-hidden="true">' + head(6) + head(21) + head(36)
      + stem(10.3,12) + stem(25.3,12) + stem(40.3,12) + beam(10.3,10.6,32)
      + '<text x="26.3" y="7.4" text-anchor="middle" font-size="11.5" font-weight="600"'
      + ' font-family="inherit">3</text></svg>',
    // four sixteenths under a double beam
    4:'<svg viewBox="0 0 53 38" aria-hidden="true">' + head(6) + head(19) + head(32) + head(45)
      + stem(10.3,4) + stem(23.3,4) + stem(36.3,4) + stem(49.3,4)
      + beam(10.3,4,41) + beam(10.3,10.4,41) + '</svg>'
  };

  var SUBS = [
    { n:1, name:"4분음표" },
    { n:2, name:"8분음표" },
    { n:3, name:"셋잇단음표" },
    { n:4, name:"16분음표" }
  ];
  function subBy(n){
    for (var i=0;i<SUBS.length;i++) if (SUBS[i].n === n) return SUBS[i];
    return SUBS[0];
  }

  var TEMPI = [
    [40,"Grave"],[52,"Largo"],[60,"Larghetto"],[68,"Adagio"],[76,"Adagietto"],
    [84,"Andante"],[100,"Andante moderato"],[112,"Moderato"],[120,"Allegretto"],
    [140,"Allegro"],[160,"Vivace"],[178,"Presto"],[9999,"Prestissimo"]
  ];
  function tempoName(b){
    for (var i=0;i<TEMPI.length;i++) if (b < TEMPI[i][0]) return TEMPI[i][1];
    return "Prestissimo";
  }

  var mode = "basic";
  var state = { bpm:96, meter:METERS[3], accents:METERS[3].acc.slice(), subdiv:1, running:false };

  // A song is a list of sections. Each owns its meter and tempo, and the transport
  // walks them in order — that is the whole feature.
  // Sections are numbered by position. A name you type yourself is left alone; only
  // auto names (구간N) get re-numbered when the list changes.
  var AUTO_NAME = /^구간\s*\d+$/;
  function autoName(i){ return "구간" + (i + 1); }
  function renumberSections(){
    song.sections.forEach(function(s, i){
      if (!s.name || AUTO_NAME.test(s.name)) s.name = autoName(i);
    });
  }
  function blankSong(){
    return { title:"", loop:true, sections:[
      { name:autoName(0), bars:8, meter:"4/4", bpm:100, subdiv:1,
        accents:meterBy("4/4").acc.slice() }
    ] };
  }
  // 저장본은 언제든 옛 형식이거나 손상돼 있을 수 있습니다. 믿지 않고 한 번 거릅니다.
  // accents 가 빠진 구간 하나면 예전에는 앱 전체가 멈췄습니다.
  function fixSection(s, i){
    if (!s || typeof s !== "object") s = {};
    var m = meterBy(s.meter);
    var ok = s.accents && s.accents.length === m.acc.length;
    return {
      name: (typeof s.name === "string" && s.name) ? s.name.slice(0,10) : autoName(i),
      bars: clampInt(s.bars, 1, MAX_BARS, 8),
      meter: m.label,
      bpm: clampInt(s.bpm, MIN_BPM, MAX_BPM, 100),
      subdiv: 1,
      accents: ok ? s.accents.map(function(a){ return clampInt(a, 0, 3, 0); }) : m.acc.slice()
    };
  }
  function fixSong(x){
    if (!x || !x.sections || !x.sections.length) return blankSong();
    return {
      title: typeof x.title === "string" ? x.title : "",
      loop: x.loop !== false,
      sections: x.sections.slice(0, MAX_SECTIONS).map(fixSection)
    };
  }

  var song = blankSong();
  try {
    var sv = localStorage.getItem("metron.song");
    if (sv){
      var ps = JSON.parse(sv);
      if (ps && ps.sections && ps.sections.length){
        // the old built-in demo, untouched, is replaced rather than carried forward
        var demo = [["도입",4,"3/4",72],["A",16,"3/4",132],["B",8,"4/4",132],["코다",4,"3/4",88]];
        var isDemo = ps.sections.length === demo.length && !(ps.title || "").trim();
        for (var di = 0; isDemo && di < demo.length; di++){
          var sd = ps.sections[di], w = demo[di];
          if (sd.name !== w[0] || sd.bars !== w[1] || sd.meter !== w[2] || sd.bpm !== w[3])
            isDemo = false;
        }
        if (!isDemo) song = fixSong(ps);
      }
    }
  } catch(e){}
  // 구간 칸에 한 글자 칠 때마다 디스크에 쓰지 않고 모아서 한 번 씁니다.
  // 화면을 덮거나 앱을 떠날 때는 즉시 밀어 넣습니다.
  var songTimer = null;
  function flushSong(){
    if (!songTimer) return;
    clearTimeout(songTimer); songTimer = null;
    try{ localStorage.setItem("metron.song", JSON.stringify(song)); }catch(e){}
  }
  function saveSong(){
    if (mode === "song") markFavs();
    if (songTimer) clearTimeout(songTimer);
    songTimer = setTimeout(function(){ songTimer = null;
      try{ localStorage.setItem("metron.song", JSON.stringify(song)); }catch(e){}
    }, 250);
  }
  window.addEventListener("pagehide", flushSong);

  // ---------- audio ----------
  var ctx=null, bus=null, limiter=null, noiseBuf=null, timerId=null;
  var nextNoteTime=0, queue=[], pendingEnd=0;
  // Booking window. Small while you can see the app, so tempo changes are heard at
  // once. Browsers throttle timers in hidden pages to about 1 Hz, so we book much
  // further out there — otherwise beats come due between wake-ups and are missed.
  var LOOKAHEAD_MS=25, AHEAD_FG=0.10, AHEAD_BG=1.60;
  var scheduleAhead = AHEAD_FG;
  var wakeLock=null;
  var cursor = { sec:0, bar:0, beat:0, sub:0 };
  var displaySec = 0, ledSig = "";

  // Pushed well past unity on purpose — the limiter keeps it clean, and the phone's
  // own volume buttons are the volume control.
  var OUTPUT_GAIN = 2.2;

  function ensureAudio(){
    if (ctx) return;
    ctx = new AudioCtx({ latencyHint:"interactive" });

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-2.5, ctx.currentTime);
    limiter.knee.setValueAtTime(0, ctx.currentTime);
    limiter.ratio.setValueAtTime(20, ctx.currentTime);
    limiter.attack.setValueAtTime(0.002, ctx.currentTime);
    limiter.release.setValueAtTime(0.06, ctx.currentTime);

    bus = ctx.createGain();
    bus.gain.value = OUTPUT_GAIN;
    bus.connect(limiter);
    limiter.connect(ctx.destination);

    var len = Math.floor(ctx.sampleRate * 0.06);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i=0;i<len;i++) d[i] = Math.random()*2 - 1;

    // iOS: route through the media channel so the ringer switch is ignored —
    // the web equivalent of a native app's AVAudioSession .playback category
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch(e){}
  }

  // Loudness alone doesn't beat a piano — masking does. Each click is a bandpassed
  // noise transient (2.6–4.2 kHz, where the ear is most sensitive and a piano has
  // comparatively little energy) over a short pitched body that keeps accents legible.
  var WAVE = "triangle";
  var VOICE = {
    3:{ tone:2093, part:3136, tg:.52, nf:4200, nq:.85, ng:.90, d:.052, nd:.014 },
    2:{ tone:1568, part:2349, tg:.40, nf:3400, nq:1.0, ng:.62, d:.045, nd:.013 },
    1:{ tone:1319, part:1976, tg:.30, nf:3000, nq:1.1, ng:.46, d:.040, nd:.012 },
    s:{ tone:1047, part:0,    tg:.13, nf:2600, nq:1.3, ng:.17, d:.026, nd:.009 }
  };

  function click(time, key){
    var v = VOICE[key];

    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(v.nf, time);
    bp.Q.setValueAtTime(v.nq, time);
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, time);
    ng.gain.exponentialRampToValueAtTime(v.ng, time + 0.0006);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + v.nd);
    src.connect(bp); bp.connect(ng); ng.connect(bus);
    src.start(time); src.stop(time + v.nd + 0.03);

    var tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, time);
    tg.gain.exponentialRampToValueAtTime(v.tg, time + 0.0015);
    tg.gain.exponentialRampToValueAtTime(0.0001, time + v.d);
    tg.connect(bus);

    var o1 = ctx.createOscillator();
    o1.type = WAVE;
    o1.frequency.setValueAtTime(v.tone, time);
    o1.connect(tg); o1.start(time); o1.stop(time + v.d + 0.02);

    if (v.part){
      var pg = ctx.createGain(); pg.gain.value = 0.5; pg.connect(tg);
      var o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(v.part, time);
      o2.connect(pg); o2.start(time); o2.stop(time + v.d + 0.02);
    }
  }

  // Practice mode is a song of one endless section, so the transport has one code path.
  // 연습 모드는 끝없는 한 구간짜리 곡입니다. 매번 새로 만들지 않고 한 개를 고쳐 씁니다 —
  // 이 함수는 음 하나 예약할 때마다 세 번 불립니다.
  var BASIC_SEC = { bars:Infinity, bpm:96, subdiv:1, accents:null, meter:"4/4" };
  function secAt(i){
    if (mode === "basic"){
      BASIC_SEC.bpm = state.bpm;
      BASIC_SEC.subdiv = state.subdiv;
      BASIC_SEC.accents = state.accents;
      BASIC_SEC.meter = state.meter.label;
      return BASIC_SEC;
    }
    // 재생 중에 구간을 지우면 커서가 목록 밖을 가리킬 수 있습니다
    return song.sections[i] || song.sections[0];
  }
  function curSec(){ return secAt(cursor.sec); }
  function secCount(){ return mode === "basic" ? 1 : song.sections.length; }
  function stepNow(){ var s = curSec(); return 60 / s.bpm / s.subdiv; }

  function scheduleTick(time){
    var s = curSec();
    var acc = s.accents[cursor.beat];
    if (cursor.sub === 0){ if (acc > 0) click(time, acc); }
    else if (acc !== 0){ click(time, "s"); }

    if (queue.length < 240)
      queue.push({ time:time, sec:cursor.sec, bar:cursor.bar, beat:cursor.beat, sub:cursor.sub });
  }

  // false once the song runs off the end
  function advanceCursor(){
    var s = curSec();
    cursor.sub++;
    if (cursor.sub < s.subdiv) return true;
    cursor.sub = 0;
    cursor.beat++;
    if (cursor.beat < s.accents.length) return true;
    cursor.beat = 0;
    cursor.bar++;
    if (cursor.bar < s.bars) return true;
    cursor.bar = 0;
    cursor.sec++;
    if (cursor.sec < secCount()) return true;
    if (mode === "basic" || song.loop){ cursor.sec = 0; return true; }
    return false;
  }

  // The scheduler never makes a sound itself. It only books notes with the audio
  // clock far enough ahead that timer jitter can never reach them.
  function scheduler(){
    var now = ctx.currentTime;
    while (!pendingEnd && nextNoteTime < now + scheduleAhead){
      // If the timer was throttled we may be behind. Booking an overdue note makes the
      // audio thread fire it at once, so a whole run of them lands on the same instant
      // and stacks into one loud thud — which is what "only the strong beat sounds"
      // actually was. Step over those instead; the grid and bar position stay correct.
      if (nextNoteTime >= now - 0.005) scheduleTick(nextNoteTime);
      nextNoteTime += stepNow();
      if (!advanceCursor()) pendingEnd = nextNoteTime;
    }
  }

  // ---------- transport ----------
  function start(){
    ensureAudio();
    var go = function(){
      state.running = true;
      queue.length = 0; pendingEnd = 0;
      cursor.sec = 0; cursor.bar = 0; cursor.beat = 0; cursor.sub = 0;
      nextNoteTime = ctx.currentTime + 0.08;
      timerId = setInterval(scheduler, LOOKAHEAD_MS);
      scheduler();
      startFrames();
      $("playLabel").textContent = "정지";
      $("playBtn").setAttribute("aria-label", "정지");
      $("playPath").setAttribute("d", "M1.5 1 H5 V14 H1.5 Z M8 1 H11.5 V14 H8 Z");
      $("playBtn").classList.add("running");
      requestWakeLock();
    };
    clearTimeout(idleTimer); idleTimer = null;
    if (ctx.state !== "suspended"){ go(); return; }
    // resume() 이 끝내 답하지 않는 환경이 있습니다. 약속만 믿으면 재생 버튼이
    // 영영 켜지지 않으므로, 짧은 시간 뒤에는 그냥 시작합니다.
    var fired = false;
    var fire = function(){ if (!fired){ fired = true; go(); } };
    try { ctx.resume().then(fire, fire); } catch(e){ fire(); }
    setTimeout(fire, 250);
  }

  // 멈춰 있는 동안에도 살아 있는 AudioContext 는 오디오 장치를 붙잡아 둡니다.
  // 마지막 클릭의 꼬리가 끝난 뒤 재워 두고, 다시 누르면 start() 가 깨웁니다.
  var idleTimer = null;
  function armIdle(){
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){
      idleTimer = null;
      if (!state.running && ctx && ctx.state === "running")
        ctx.suspend().catch(function(){});
    }, 2500);
  }

  function stop(){
    state.running = false;
    stopFrames();
    if (timerId){ clearInterval(timerId); timerId = null; }
    queue.length = 0; pendingEnd = 0;
    $("playLabel").textContent = "시작";
    $("playBtn").setAttribute("aria-label", "시작");
    $("playPath").setAttribute("d", "M1.5 1 L12 7.5 L1.5 14 Z");
    $("playBtn").classList.remove("running");
    var l = $("leds").children, i;
    for (i=0;i<l.length;i++) l[i].classList.remove("on");
    var cards = $("secList").children;
    for (i=0;i<cards.length;i++){
      cards[i].classList.remove("playing");
      if (cards[i].fillEl) cards[i].fillEl.style.width = "0";
    }
    if (mode === "song"){ displaySec = 0; ledSig = ""; renderLeds(); syncSongHeader(0, -1); }
    releaseWakeLock();
    armIdle();
  }

  function toggle(){ state.running ? stop() : start(); }

  function requestWakeLock(){
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(function(l){ wakeLock = l; }).catch(function(){});
  }
  function releaseWakeLock(){ if (wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock = null; } }
  document.addEventListener("visibilitychange", function(){
    var hidden = document.visibilityState === "hidden";
    scheduleAhead = hidden ? AHEAD_BG : AHEAD_FG;
    // 타이머가 느려지기 전에 넓은 창을 한 번 채워둡니다. 다음 호출을 기다리면
    // 그 사이에 만기가 된 박은 이미 놓친 뒤입니다.
    if (hidden && state.running) scheduler();
    if (!hidden && state.running) requestWakeLock();
    if (hidden) flushSong();
  });

  // ---------- tempo ----------
  function syncCaption(){
    $("caption").textContent = tempoName(state.bpm);
    markFavs();
  }
  function setBpm(v, fromInput){
    v = Math.round(v);
    if (isNaN(v)) return;
    if (v < MIN_BPM) v = MIN_BPM;
    if (v > MAX_BPM) v = MAX_BPM;
    if (v === state.bpm && !fromInput) return;
    state.bpm = v;
    if (!fromInput) $("bpmInput").value = v;
    syncCaption();
    $("wheel").setAttribute("aria-valuenow", v);
  }

  var input = $("bpmInput");
  input.addEventListener("focus", function(){
    if (mode !== "basic"){ input.blur(); return; }
    setTimeout(function(){ input.select(); }, 0);
  });
  input.addEventListener("input", function(){
    if (mode !== "basic") return;
    var clean = input.value.replace(/[^0-9]/g,"").slice(0,3);
    if (clean !== input.value) input.value = clean;
    if (clean !== "") setBpm(Number(clean), true);
  });
  input.addEventListener("blur", function(){
    if (mode !== "basic") return;
    var v = Number(input.value.replace(/[^0-9]/g,""));
    setBpm(v || state.bpm);
    input.value = state.bpm;
  });
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter"){ e.preventDefault(); input.blur(); }
    if (e.key === "Escape"){ input.value = state.bpm; input.blur(); }
    e.stopPropagation();
  });

  var wheel = $("wheel");
  var PX_PER_BPM = 6, dragging=false, lastX=0, wheelPx=0, wheelAcc=0;
  function paintWheel(){ wheel.style.backgroundPosition = wheelPx+"px 50%, "+wheelPx+"px 50%"; }
  wheel.addEventListener("pointerdown", function(e){
    dragging = true; lastX = e.clientX;
    wheel.setPointerCapture(e.pointerId);
    wheel.classList.add("grabbing");
    if (document.activeElement === input) input.blur();
  });
  wheel.addEventListener("pointermove", function(e){
    if (!dragging) return;
    var dx = e.clientX - lastX; lastX = e.clientX;
    // 오른쪽으로 끌면 숫자가 내려갑니다. 이미 한계면 눈금도 움직이지 않아야
    // 숫자와 눈금이 어긋나 보이지 않습니다.
    if ((dx > 0 && state.bpm <= MIN_BPM) || (dx < 0 && state.bpm >= MAX_BPM)) return;
    // The scale strip slides under a fixed marker: drag it right and the marker
    // lands on a lower number, exactly like the printed scale on a real metronome.
    wheelPx += dx; wheelAcc -= dx;
    var steps = wheelAcc / PX_PER_BPM;
    steps = steps > 0 ? Math.floor(steps) : Math.ceil(steps);
    if (steps){ wheelAcc -= steps * PX_PER_BPM; setBpm(state.bpm + steps); }
    paintWheel();
  });
  function endDrag(e){
    if (!dragging) return;
    dragging = false; wheel.classList.remove("grabbing");
    try { wheel.releasePointerCapture(e.pointerId); } catch(err){}
  }
  wheel.addEventListener("pointerup", endDrag);
  wheel.addEventListener("pointercancel", endDrag);
  wheel.addEventListener("keydown", function(e){
    if (e.key === "ArrowRight" || e.key === "ArrowUp"){ e.preventDefault(); setBpm(state.bpm+1); }
    if (e.key === "ArrowLeft"  || e.key === "ArrowDown"){ e.preventDefault(); setBpm(state.bpm-1); }
  });

  // hold either stepper to run, and it speeds up after a moment
  function holdRepeat(el, fn){
    var t1=null, t2=null, t3=null;
    function stopRep(){ clearTimeout(t1); clearTimeout(t3); clearInterval(t2); t1=t2=t3=null; }
    el.addEventListener("pointerdown", function(e){
      e.preventDefault();
      if (document.activeElement === input) input.blur();
      fn();
      t1 = setTimeout(function(){
        t2 = setInterval(fn, 110);
        t3 = setTimeout(function(){ if (t2){ clearInterval(t2); t2 = setInterval(fn, 45); } }, 1300);
      }, 420);
    });
    ["pointerup","pointercancel","pointerleave"].forEach(function(ev){
      el.addEventListener(ev, stopRep);
    });
  }
  holdRepeat($("m1"), function(){ setBpm(state.bpm-1); });
  holdRepeat($("p1"), function(){ setBpm(state.bpm+1); });

  var taps=[], tapTimer=null;
  function tap(){
    if (mode !== "basic") return;
    var now = performance.now();
    if (taps.length && now - taps[taps.length-1] > 2200) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    var btn = $("tapBtn");
    btn.classList.add("armed");
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function(){ btn.classList.remove("armed"); taps.length = 0; }, 2200);
    if (taps.length < 2) return;
    var gaps=[], i;
    for (i=1;i<taps.length;i++) gaps.push(taps[i]-taps[i-1]);
    gaps.sort(function(a,b){ return a-b; });
    // median, not mean — one bad tap shouldn't drag the tempo
    var med = gaps.length % 2
      ? gaps[(gaps.length-1)/2]
      : (gaps[gaps.length/2-1] + gaps[gaps.length/2]) / 2;
    setBpm(60000/med);
  }
  $("tapBtn").addEventListener("click", tap);

  // ---------- beat bars ----------
  function ledTarget(){
    return mode === "basic" ? state.accents : song.sections[displaySec].accents;
  }
  function renderLeds(){
    var acc = ledTarget(), k;
    var sig = mode + ":" + displaySec + ":" + acc.length;
    if (sig === ledSig){
      var kids = $("leds").children;
      for (k=0;k<kids.length;k++) kids[k].dataset.acc = acc[k];
      return;
    }
    ledSig = sig;
    var box = $("leds");
    box.innerHTML = "";
    for (var i=0;i<acc.length;i++){
      (function(i){
        var b = document.createElement("button");
        b.className = "led";
        b.dataset.acc = acc[i];
        b.setAttribute("aria-label", (i+1) + "번째 박 강세");
        b.appendChild(document.createElement("i"));
        b.addEventListener("click", function(){
          var target = ledTarget();
          target[i] = (target[i] + 3) % 4;   // 3 → 2 → 1 → 0 → 3
          b.dataset.acc = target[i];
          if (mode === "song") saveSong(); else markFavs();
        });
        box.appendChild(b);
      })(i);
    }
  }
  function setActiveBeat(i){
    var l = $("leds").children;
    for (var k=0;k<l.length;k++) l[k].classList.toggle("on", k === i);
    // 애니메이션을 다시 태우려면 리플로우가 한 번 필요합니다
    var pb = $("playBtn");
    pb.classList.remove("hit"); void pb.offsetWidth; pb.classList.add("hit");
  }

  // ---------- meter / subdivision pickers ----------
  var meterSel = $("meterSel"), subSel = $("subSel");
  METERS.forEach(function(m){
    var o = document.createElement("option");
    o.value = m.label; o.textContent = m.label;
    if (m === state.meter) o.selected = true;
    meterSel.appendChild(o);
  });
  SUBS.forEach(function(s){
    var o = document.createElement("option");
    o.value = s.n; o.textContent = s.name;
    if (s.n === state.subdiv) o.selected = true;
    subSel.appendChild(o);
  });

  meterSel.addEventListener("change", function(){
    var m = meterBy(meterSel.value);
    state.meter = m; state.accents = m.acc.slice();
    $("meterVal").textContent = m.label;
    ledSig = ""; renderLeds(); syncCaption();
  });
  function paintSub(s){
    var el = $("subVal");
    el.innerHTML = NOTE_SVG[s.n];
    el.setAttribute("aria-label", s.name);
  }
  subSel.addEventListener("change", function(){
    var s = subBy(Number(subSel.value));
    state.subdiv = s.n;
    paintSub(s);
  });

  // ---------- favourites ----------
  // One strip, two banks: tempo presets in 연습, whole songs in 곡. Both are keyed
  // so a combination can only ever occupy one slot.
  var favs = [null,null,null,null,null,null];
  var songFavs = [null,null,null,null,null,null];
  function loadBank(key, fallback){
    try {
      var raw = localStorage.getItem(key);
      if (raw){ var p = JSON.parse(raw); if (p && p.length === FAV_SLOTS) return p; }
    } catch(e){}
    return fallback;
  }
  favs = loadBank("metron.favs", favs);
  songFavs = loadBank("metron.songfavs", songFavs);

  function persistFavs(){
    try{
      localStorage.setItem("metron.favs", JSON.stringify(favs));
      localStorage.setItem("metron.songfavs", JSON.stringify(songFavs));
    }catch(e){}
  }

  function activeFavs(){ return mode === "basic" ? favs : songFavs; }

  function songKey(s){
    var t = (s.title || "").trim();
    if (t) return "t:" + t;
    return "s:" + JSON.stringify((s.sections||[]).map(function(x){
      return [x.bars, x.meter, x.bpm, x.subdiv];
    }));
  }
  function curKey(){
    return mode === "basic" ? (state.bpm + "@" + state.meter.label) : songKey(song);
  }
  function keyOf(f){
    if (!f) return null;
    return mode === "basic" ? (f.bpm + "@" + f.meter) : songKey(f);
  }
  function favIndexOfCurrent(){
    var list = activeFavs(), k = curKey();
    for (var i=0;i<FAV_SLOTS;i++) if (keyOf(list[i]) === k) return i;
    return -1;
  }

  // strip duplicates a previous build may have written
  (function(){
    [["basic",favs],["song",songFavs]].forEach(function(pair){
      var was = mode; mode = pair[0];
      var list = pair[1], seen = {};
      for (var i=0;i<FAV_SLOTS;i++){
        var k = keyOf(list[i]);
        if (!k) continue;
        if (seen[k]) list[i] = null; else seen[k] = true;
      }
      mode = was;
    });
  })();

  var HINTS = {
    basic:"빈 칸을 눌러 저장 · 두 번 눌러 지움",
    song:"빈 칸을 눌러 저장 · 두 번 눌러 지움"
  };
  var hintTimer = null;
  function say(msg){
    var el = $("favHint");
    el.textContent = msg;
    el.classList.add("say");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function(){
      el.textContent = HINTS[mode];
      el.classList.remove("say");
    }, 2400);
  }

  function snapshotSong(){
    return {
      title:(song.title||"").trim(),
      loop:!!song.loop,
      sections:song.sections.map(function(s){
        return { name:s.name, bars:s.bars, meter:s.meter, bpm:s.bpm,
                 subdiv:s.subdiv||1, accents:s.accents.slice() };
      })
    };
  }

  function applyFav(i){
    var f = activeFavs()[i];
    if (!f) return;
    if (mode === "basic"){
      var m = meterBy(f.meter);
      state.meter = m;
      state.accents = (f.accents && f.accents.length === m.acc.length)
        ? f.accents.slice() : m.acc.slice();
      state.bpm = f.bpm;
      meterSel.value = m.label;
      $("meterVal").textContent = m.label;
      $("bpmInput").value = f.bpm;
      $("wheel").setAttribute("aria-valuenow", f.bpm);
      ledSig = ""; renderLeds(); syncCaption();
    } else {
      song = fixSong(f);
      $("songTitle").value = song.title;
      $("loopBtn").setAttribute("aria-checked", String(song.loop));
      displaySec = 0; ledSig = "";
      saveSong(); renderSections(); updateTotal(); renderLeds(); syncSongHeader(0, -1);
      markFavs();
    }
  }

  function flashSlot(i){
    var el = $("favs").children[i];
    if (!el) return;
    el.classList.add("flash");
    setTimeout(function(){ el.classList.remove("flash"); }, 360);
  }

  // Every write goes through here, so no path can duplicate a combination.
  function writeFav(slot){
    var dup = favIndexOfCurrent();
    if (dup >= 0 && dup !== slot){ flashSlot(dup); return false; }
    activeFavs()[slot] = (mode === "basic")
      ? { bpm:state.bpm, meter:state.meter.label, accents:state.accents.slice() }
      : snapshotSong();
    persistFavs(); renderFavs(); flashSlot(slot);
    return true;
  }


  // Light and dark follow the system until you press the button; after that your
  // choice is remembered and wins over the system setting.
  var SUN  = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41"
           + "M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41";
  var MOON = "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z";

  function themeNow(){
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark" : "light";
  }
  function paintTheme(){
    var dark = themeNow() === "dark";
    $("themeIcon").setAttribute("d", dark ? SUN : MOON);
    $("themeBtn").setAttribute("aria-label", dark ? "라이트모드로 전환" : "다크모드로 전환");
  }
  $("themeBtn").addEventListener("click", function(){
    var next = themeNow() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("metron.theme", next); } catch(e){}
    paintTheme();
  });
  if (window.matchMedia){
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function(){
      if (!document.documentElement.getAttribute("data-theme")) paintTheme();
    });
  }
  function markFavs(){
    var list = activeFavs(), kids = $("favs").children, k = curKey();
    for (var i=0;i<kids.length;i++)
      kids[i].setAttribute("aria-pressed", String(keyOf(list[i]) === k));
  }

  var EMPTY_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/></svg>';

  function renderFavs(){
    var box = $("favs"), list = activeFavs(), k = curKey();
    box.innerHTML = "";
    for (var i=0;i<FAV_SLOTS;i++){
      (function(i){
        var f = list[i];
        var b = document.createElement("button");
        b.className = "fav " + (f ? "soft" : "empty");
        if (f && mode === "basic"){
          b.innerHTML = '<span class="n">' + f.bpm + '</span><span class="m">' + f.meter + '</span>';
          b.setAttribute("aria-label", f.bpm + " BPM " + f.meter + " 즐겨찾기, 다시 누르면 지움");
        } else if (f){
          var title = f.title || "이름 없음";
          b.innerHTML = '<span class="t"></span><span class="m">'
                      + f.sections.length + '구간</span>';
          b.querySelector(".t").textContent = title;
          b.setAttribute("aria-label", title + " 곡 즐겨찾기");
        } else {
          b.innerHTML = EMPTY_STAR;
          b.setAttribute("aria-label", mode === "basic"
            ? "빈 즐겨찾기, 눌러서 현재 템포 저장" : "빈 즐겨찾기, 눌러서 지금 곡 저장");
        }
        b.setAttribute("aria-pressed", String(keyOf(f) === k));
        b.addEventListener("click", function(){
          var list = activeFavs();
          if (!list[i]){
            if (writeFav(i)) say("즐겨찾기에 저장했습니다");
            else say(mode === "basic" ? "이미 저장된 템포입니다" : "이미 저장된 곡입니다");
            return;
          }
          // Tapping the one already loaded clears it. The old layout used the star
          // button for this; without the star the slot has to carry both actions.
          if (favIndexOfCurrent() === i){
            list[i] = null; persistFavs(); renderFavs();
            say("즐겨찾기에서 지웠습니다");
          } else applyFav(i);
        });
        box.appendChild(b);
      })(i);
    }
  }


  // symbol -> [notes, intervals], rebuilt from the packed table at load
  var CHORDS = {}, CH_SYMS = [];
  (function(){
    var lines = CH_D.split("\n");
    for (var i=0;i<lines.length;i++){
      var parts = lines[i].split("|"), root = parts[0];
      for (var q=0;q<CH_Q.length;q++){
        var sym = root + CH_Q[q];
        CHORDS[sym] = [parts[q+1], CH_I[q]];
        CH_SYMS.push(sym);
      }
    }
    CH_SYMS.sort(function(a,b){ return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); });
  })();

  // Case matters in chord symbols — Cm7 and CM7 are different chords — so only the
  // root letter is forced upper. The rest is passed through as typed.
  function chordNorm(q){
    q = String(q).replace(/\s+/g, "");
    if (!q) return "";
    q = q.replace(/\u266d/g, "b").replace(/\u266f/g, "#")
         .replace(/\u00b0/g, "dim").replace(/\+/g, "aug")
         .replace(/maj/gi, "M").replace(/min/gi, "m");
    return q.charAt(0).toUpperCase() + q.slice(1);
  }

  function chordRender(sym){
    var out = $("chordOut");
    out.innerHTML = "";
    if (!sym) return;
    var hit = CHORDS[sym];
    if (!hit){
      var msg = document.createElement("div");
      msg.className = "chord-msg";
      msg.textContent = "\u0027" + sym + "\u0027 에 해당하는 코드가 없습니다";
      out.appendChild(msg);
      return;
    }
    var head = document.createElement("div");
    head.className = "chord-sym";
    head.textContent = sym;
    out.appendChild(head);

    var notes = hit[0].split("-"), ivals = hit[1].split("-");
    var row = document.createElement("div");
    row.className = "cnotes";
    for (var i=0;i<notes.length;i++){
      var cell = document.createElement("div");
      cell.className = "cn";
      var b = document.createElement("b"); b.textContent = notes[i];
      var n = document.createElement("i"); n.textContent = ivals[i];
      cell.appendChild(b); cell.appendChild(n);
      row.appendChild(cell);
    }
    out.appendChild(row);
  }

  function chordSearch(){
    var raw = $("chordQ").value;
    var q = chordNorm(raw);
    $("chordIn").classList.toggle("filled", raw.length > 0);

    var hits = [];
    if (q){
      for (var i=0;i<CH_SYMS.length && hits.length < 24;i++)
        if (CH_SYMS[i].indexOf(q) === 0) hits.push(CH_SYMS[i]);
    }
    var best = CHORDS[q] ? q : (hits[0] || q);
    chordRender(q ? best : "");

    var sug = $("chordSug");
    sug.innerHTML = "";
    for (var k=0;k<hits.length && k<14;k++){
      if (hits[k] === best) continue;
      (function(sym){
        var b = document.createElement("button");
        b.textContent = sym;
        b.addEventListener("click", function(){
          $("chordQ").value = sym;
          chordSearch();
        });
        sug.appendChild(b);
      })(hits[k]);
    }
  }

  $("chordQ").addEventListener("input", chordSearch);
  $("chordQ").addEventListener("keydown", function(e){
    if (e.key === "Enter"){ e.preventDefault(); this.blur(); }
    if (e.key === "Escape"){ this.value = ""; chordSearch(); this.blur(); }
    e.stopPropagation();
  });
  $("chordClear").addEventListener("click", function(){
    $("chordQ").value = "";
    chordSearch();
    $("chordQ").focus();
  });

  // ---------------- sections ----------------
  function clampInt(v, lo, hi, fb){
    v = parseInt(String(v).replace(/[^0-9]/g,""), 10);
    return isNaN(v) ? fb : Math.max(lo, Math.min(hi, v));
  }

  var MINUS_SVG = '<svg viewBox="0 0 22 22" aria-hidden="true" fill="none" '
    + 'stroke="var(--icon)" stroke-width="1.8" stroke-linecap="round">'
    + '<circle cx="11" cy="11" r="9.1"/><path d="M6.8 11h8.4"/></svg>';

  function renderSections(){
    var list = $("secList");
    list.innerHTML = "";
    song.sections.forEach(function(s, i){
      var card = document.createElement("div");
      card.className = "sec glass";

      var del = document.createElement("button");
      del.className = "sec-del"; del.innerHTML = MINUS_SVG;
      del.setAttribute("aria-label", "구간 삭제");
      del.addEventListener("click", function(){
        if (song.sections.length <= 1) return;
        song.sections.splice(i, 1);
        renumberSections();
        if (cursor.sec >= song.sections.length){ cursor.sec = 0; cursor.bar = 0; }
        if (displaySec >= song.sections.length) displaySec = song.sections.length - 1;
        ledSig = "";
        saveSong(); renderSections(); renderLeds(); syncSongHeader(displaySec, -1); updateTotal();
      });
      var name = document.createElement("input");
      name.className = "sec-name"; name.value = s.name; name.maxLength = 10;
      name.setAttribute("aria-label", "구간 이름");
      name.addEventListener("input", function(){ s.name = name.value; saveSong(); });

      var f1 = document.createElement("div"); f1.className = "fld bars";
      var barsIn = document.createElement("input");
      barsIn.type = "text"; barsIn.inputMode = "numeric"; barsIn.value = s.bars;
      barsIn.setAttribute("aria-label", "마디 수");
      barsIn.addEventListener("input", function(){
        var v = parseInt(barsIn.value.replace(/[^0-9]/g,""), 10);
        if (!isNaN(v)){ s.bars = Math.max(1, Math.min(MAX_BARS, v)); updateTotal(); saveSong(); }
      });
      barsIn.addEventListener("blur", function(){
        s.bars = clampInt(barsIn.value, 1, MAX_BARS, s.bars);
        barsIn.value = s.bars; updateTotal(); saveSong();
      });
      var l1 = document.createElement("span"); l1.textContent = "마디";
      f1.appendChild(barsIn); f1.appendChild(l1);

      var f2 = document.createElement("div"); f2.className = "fld sel";
      var sel = document.createElement("select");
      sel.setAttribute("aria-label", "박자표");
      METERS.forEach(function(m){
        var o = document.createElement("option");
        o.value = m.label; o.textContent = m.label;
        if (m.label === s.meter) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function(){
        s.meter = sel.value;
        s.accents = meterBy(sel.value).acc.slice();
        if (displaySec === i){ ledSig = ""; renderLeds(); }
        updateTotal(); saveSong();
      });
      f2.appendChild(sel);

      var f3 = document.createElement("div"); f3.className = "fld bpm";
      var bpmIn = document.createElement("input");
      bpmIn.type = "text"; bpmIn.inputMode = "numeric"; bpmIn.value = s.bpm;
      bpmIn.setAttribute("aria-label", "구간 템포");
      bpmIn.addEventListener("input", function(){
        var v = parseInt(bpmIn.value.replace(/[^0-9]/g,""), 10);
        if (!isNaN(v)){ s.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, v)); updateTotal(); saveSong(); }
      });
      bpmIn.addEventListener("blur", function(){
        s.bpm = clampInt(bpmIn.value, MIN_BPM, MAX_BPM, s.bpm);
        bpmIn.value = s.bpm; updateTotal(); saveSong();
        if (displaySec === i && !state.running) syncSongHeader(i, -1);
      });
      var l3 = document.createElement("span"); l3.textContent = "BPM";
      f3.appendChild(bpmIn); f3.appendChild(l3);

      var prog = document.createElement("div");
      prog.className = "sec-prog";
      var fill = document.createElement("i");
      prog.appendChild(fill);
      card.fillEl = fill;   // 박마다 찾지 않도록 만들 때 잡아 둡니다

      card.appendChild(del); card.appendChild(name);
      card.appendChild(f1); card.appendChild(f2); card.appendChild(f3);
      card.appendChild(prog);
      card.addEventListener("click", function(e){
        if (e.target.closest("input,select,button")) return;
        if (state.running) return;
        displaySec = i; ledSig = ""; renderLeds(); syncSongHeader(i, -1);
      });
      list.appendChild(card);
    });
  }

  function updateTotal(){
    var t = 0;
    song.sections.forEach(function(s){
      t += s.bars * meterBy(s.meter).acc.length * (60 / s.bpm);
    });
    var m = Math.floor(t/60), sec = Math.round(t%60);
    if (sec === 60){ m++; sec = 0; }
    var bars = song.sections.reduce(function(a,s){ return a + s.bars; }, 0);
    $("totalTime").textContent = song.sections.length + "구간 · " + bars
      + "마디 · " + m + "분 " + sec + "초";
  }

  function syncSongHeader(i, bar){
    var s = song.sections[i];
    if (!s) return;
    $("bpmInput").value = s.bpm;
    $("caption").textContent = bar >= 0
      ? s.name + " · " + s.meter + " · " + (bar+1) + "/" + s.bars + "마디"
      : s.name + " · " + s.meter + " · " + s.bars + "마디";
  }

  $("songTitle").addEventListener("input", function(){
    song.title = this.value;
    saveSong();
  });
  $("songTitle").addEventListener("keydown", function(e){
    if (e.key === "Enter"){ e.preventDefault(); this.blur(); }
    e.stopPropagation();
  });

  $("addSec").addEventListener("click", function(){
    var last = song.sections[song.sections.length-1];
    var ml = last ? last.meter : "4/4";
    song.sections.push({
      name:autoName(song.sections.length), bars:8, meter:ml,
      bpm:last ? last.bpm : 100, subdiv:1, accents:meterBy(ml).acc.slice()
    });
    renumberSections();
    saveSong(); renderSections(); updateTotal();
    $("secList").scrollTop = $("secList").scrollHeight;
  });

  $("loopBtn").addEventListener("click", function(){
    song.loop = !song.loop;
    this.setAttribute("aria-checked", String(song.loop));
    saveSong();
  });

  // ---------- mode ----------
  function setMode(m){
    if (state.running) stop();
    mode = m;
    var basic = (m === "basic");
    $("modeBasic").setAttribute("aria-pressed", String(basic));
    $("modeSong").setAttribute("aria-pressed", String(!basic));
    $("basicPane").hidden = !basic;
    $("songPane").hidden = basic;
    $("tempoRow").hidden = !basic;
    $("picksRow").hidden = !basic;
    input.readOnly = !basic;
    $("favHint").textContent = HINTS[m];
    $("favHint").classList.remove("say");
    ledSig = "";
    if (basic){
      $("bpmInput").value = state.bpm;
      syncCaption();
    } else {
      displaySec = 0;
      $("songTitle").value = song.title || "";
      renderSections(); updateTotal(); syncSongHeader(0, -1);
    }
    renderFavs();
    renderLeds();
  }
  $("modeBasic").addEventListener("click", function(){ setMode("basic"); });
  $("modeSong").addEventListener("click",  function(){ setMode("song"); });

  // ---------- wiring ----------
  $("playBtn").addEventListener("click", function(){
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    toggle();
  });

  document.addEventListener("keydown", function(e){
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;
    if (e.code === "Space"){ e.preventDefault(); toggle(); }
    else if (mode === "basic" && e.key === "ArrowUp"){   e.preventDefault(); setBpm(state.bpm + (e.shiftKey?10:1)); }
    else if (mode === "basic" && e.key === "ArrowDown"){ e.preventDefault(); setBpm(state.bpm - (e.shiftKey?10:1)); }
    else if (e.key === "t" || e.key === "T"){ tap(); }
  });


  // ---------- frame loop ----------
  // Runs only while playing. Stopped, there is nothing to draw, so the loop is
  // cancelled instead of being left spinning at 60 fps.
  var rafId = 0;
  function startFrames(){ if (!rafId) rafId = requestAnimationFrame(frame); }
  function stopFrames(){ if (rafId){ cancelAnimationFrame(rafId); rafId = 0; } }

  function frame(){
    rafId = requestAnimationFrame(frame);
    if (!ctx) return;
    var t = ctx.currentTime;

    while (queue.length && queue[0].time <= t){
      var n = queue.shift();
      if (n.sub !== 0) continue;
      if (t - n.time > 0.15) continue;   // stale after a spell in the background
      if (mode === "song" && n.sec !== displaySec){ displaySec = n.sec; ledSig = ""; renderLeds(); }
      setActiveBeat(n.beat);
      if (mode === "song") paintSongProgress(n.sec, n.bar);
    }

    if (pendingEnd && t >= pendingEnd) stop();
  }

  function paintSongProgress(si, bar){
    var cards = $("secList").children;
    for (var i=0;i<cards.length;i++){
      var on = (i === si);
      cards[i].classList.toggle("playing", on);
      var fill = cards[i].fillEl;
      if (!fill) continue;
      if (on){
        fill.style.width = ((bar+1) / song.sections[i].bars * 100).toFixed(1) + "%";
        if (bar === 0) cards[i].scrollIntoView({ block:"nearest", behavior:"smooth" });
      } else fill.style.width = "0";
    }
    syncSongHeader(si, bar);
  }


  // Safari wipes script storage after 7 days of not using a site. A home screen app
  // has its own counter that using it resets, and persistent mode exempts the origin
  // outright where the browser supports it. Failing is harmless — we just ask.
  if (navigator.storage && navigator.storage.persist)
    navigator.storage.persist().catch(function(){});

  // One-off cleanup of the pre-rename keys so they don't sit in storage forever.
  // Safe to delete this block once everyone has opened the app at least once.
  try {
    ["theme","favs","songfavs","song"].forEach(function(k){
      localStorage.removeItem("maelzel." + k);
    });
  } catch(e){}

  // ---------- search sheet ----------
  function openSearch(){
    $("sheet").classList.add("open");
    setTimeout(function(){ $("chordQ").focus(); }, 180);
  }
  function closeSearch(){
    $("sheet").classList.remove("open");
    $("chordQ").blur();
  }
  $("searchBtn").addEventListener("click", openSearch);
  $("sheetClose").addEventListener("click", closeSearch);
  $("sheetBack").addEventListener("click", closeSearch);
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && $("sheet").classList.contains("open")) closeSearch();
  });

  // 모드 전환은 늘 상단 슬롯에 둡니다
  $("headSlot").appendChild($("modesRow"));

  // ---------- boot ----------
  $("loopBtn").setAttribute("aria-checked", String(song.loop));
  $("songTitle").value = song.title || "";
  $("meterVal").textContent = state.meter.label;
  paintSub(subBy(state.subdiv));
  paintTheme();
  renderFavs();
  renderLeds();
  paintWheel();
  syncCaption();
  chordSearch();
})();
