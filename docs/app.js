(() => {
  'use strict';

  const ALGOS = [
    { id: 'els', name: 'ELS', color: '--series-1' },
    { id: 'tomita', name: 'Tomita', color: '--series-2' },
    { id: 'chiba', name: 'Chiba', color: '--series-3' },
  ];
  const CHIBA_CALL_LIMIT = 4e6;

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmtInt = (x) => x.toLocaleString('en-US');

  // ---------- algorithms (ports of the C++ in /src) ----------

  // Bron-Kerbosch with Tomita pivot: pivot u in P ∪ X maximising |P ∩ N(u)|.
  function bkPivot(adj, R, P, X, out, ctr) {
    ctr.calls++;
    if (P.size === 0) {
      if (X.size === 0) out.push(R.slice());
      return;
    }
    let pivot = -1, best = -1;
    for (const S of [P, X]) {
      for (const u of S) {
        let c = 0;
        for (const w of P) if (adj[u].has(w)) c++;
        if (c > best) { best = c; pivot = u; }
      }
    }
    for (const v of [...P]) {
      if (adj[pivot].has(v)) continue;
      const Nv = adj[v];
      const P2 = new Set(), X2 = new Set();
      for (const w of P) if (Nv.has(w)) P2.add(w);
      for (const w of X) if (Nv.has(w)) X2.add(w);
      R.push(v);
      bkPivot(adj, R, P2, X2, out, ctr);
      R.pop();
      P.delete(v);
      X.add(v);
    }
  }

  function degeneracyOrder(adj) {
    const n = adj.length;
    const deg = adj.map((s) => s.size);
    const done = new Array(n).fill(false);
    const order = [];
    for (let k = 0; k < n; k++) {
      let v = -1;
      for (let u = 0; u < n; u++) if (!done[u] && (v < 0 || deg[u] < deg[v])) v = u;
      done[v] = true;
      order.push(v);
      for (const w of adj[v]) if (!done[w]) deg[w]--;
    }
    return order;
  }

  function runEls(adj) {
    const out = [], ctr = { calls: 0 };
    const order = degeneracyOrder(adj);
    const rank = new Array(adj.length);
    order.forEach((v, i) => { rank[v] = i; });
    for (const v of order) {
      const P = new Set(), X = new Set();
      for (const w of adj[v]) (rank[w] > rank[v] ? P : X).add(w);
      bkPivot(adj, [v], P, X, out, ctr);
    }
    return { cliques: out, calls: ctr.calls };
  }

  function runTomita(adj) {
    const out = [], ctr = { calls: 0 };
    for (let v = 0; v < adj.length; v++) {
      const P = new Set(), X = new Set();
      for (const w of adj[v]) (w > v ? P : X).add(w);
      bkPivot(adj, [v], P, X, out, ctr);
    }
    return { cliques: out, calls: ctr.calls };
  }

  // Include/exclude each vertex in degree order, keep cliques that are maximal at the leaves.
  function runChiba(adj) {
    const n = adj.length;
    const order = [...adj.keys()].sort((a, b) => adj[b].size - adj[a].size || a - b);
    const out = [], C = [];
    let calls = 0, aborted = false;
    const isMaximal = () => {
      for (let v = 0; v < n; v++) {
        if (C.includes(v)) continue;
        if (C.every((u) => adj[u].has(v))) return false;
      }
      return true;
    };
    const update = (i) => {
      if (aborted) return;
      if (++calls > CHIBA_CALL_LIMIT) { aborted = true; return; }
      if (i === n) {
        if (C.length && isMaximal()) out.push(C.slice());
        return;
      }
      const v = order[i];
      if (C.every((u) => adj[u].has(v))) {
        C.push(v);
        update(i + 1);
        C.pop();
      }
      update(i + 1);
    };
    update(0);
    return { cliques: out, calls, aborted };
  }

  const RUNNERS = { els: runEls, tomita: runTomita, chiba: runChiba };

  // ---------- step-by-step versions (generators that yield one event per search step) ----------

  const ANIM_EVENT_LIMIT = 60000;
  const setStr = (s) => `{${[...s].join(', ')}}`;
  const ev = (kind, R, P, X, focus, msg) => ({ kind, R: [...R], P: [...P], X: [...X], focus, msg });

  function* bkGen(adj, R, P, X, st) {
    st.calls++;
    yield ev('call', R, P, X, -1, `Call ${st.calls}: R = ${setStr(R)}, P = ${setStr(P)}, X = ${setStr(X)}.`);
    if (P.size === 0) {
      if (X.size === 0) {
        st.found++;
        yield ev('found', R, P, X, -1, `P and X are both empty, so ${setStr(R)} is a maximal clique.`);
      } else {
        yield ev('dead', R, P, X, -1, `P is empty but X is not: ${setStr(R)} can still grow with a vertex already covered, so it is not reported.`);
      }
      return;
    }
    let pivot = -1, best = -1;
    for (const S of [P, X]) for (const u of S) {
      let c = 0;
      for (const w of P) if (adj[u].has(w)) c++;
      if (c > best) { best = c; pivot = u; }
    }
    yield ev('pivot', R, P, X, pivot, `Pivot ${pivot} has ${best} neighbour${best === 1 ? '' : 's'} in P, so only the non-neighbours of ${pivot} need a branch.`);
    for (const v of [...P]) {
      if (adj[pivot].has(v)) continue;
      yield ev('branch', R, P, X, v, `Branch: add ${v} to R and keep only its neighbours in P and X.`);
      const P2 = new Set(), X2 = new Set();
      for (const w of P) if (adj[v].has(w)) P2.add(w);
      for (const w of X) if (adj[v].has(w)) X2.add(w);
      R.push(v);
      yield* bkGen(adj, R, P2, X2, st);
      R.pop();
      P.delete(v);
      X.add(v);
    }
  }

  function* elsGen(adj, st) {
    const order = degeneracyOrder(adj);
    const rank = new Array(adj.length);
    order.forEach((v, i) => { rank[v] = i; });
    for (const v of order) {
      const P = new Set(), X = new Set();
      for (const w of adj[v]) (rank[w] > rank[v] ? P : X).add(w);
      yield ev('outer', [v], P, X, v, `Start at vertex ${v} (position ${rank[v] + 1} in degeneracy order). Later neighbours go in P, earlier ones in X.`);
      yield* bkGen(adj, [v], P, X, st);
    }
  }

  function* tomitaGen(adj, st) {
    for (let v = 0; v < adj.length; v++) {
      const P = new Set(), X = new Set();
      for (const w of adj[v]) (w > v ? P : X).add(w);
      yield ev('outer', [v], P, X, v, `Start at vertex ${v}. Neighbours with a larger id go in P, smaller ones in X.`);
      yield* bkGen(adj, [v], P, X, st);
    }
  }

  function* chibaGen(adj, st) {
    const n = adj.length;
    const order = [...adj.keys()].sort((a, b) => adj[b].size - adj[a].size || a - b);
    const C = [];
    const skipped = [];
    const cands = (i) => order.slice(i).filter((w) => C.every((u) => adj[u].has(w)));
    function* update(i) {
      st.calls++;
      if (i === n) {
        if (!C.length) return;
        const ext = adj.findIndex((_, w) => !C.includes(w) && C.every((u) => adj[u].has(w)));
        if (ext < 0) {
          st.found++;
          yield ev('found', C, [], skipped, -1, `Leaf: nothing can extend ${setStr(C)}, so it is a maximal clique.`);
        } else {
          yield ev('dead', C, [], skipped, ext, `Leaf: ${setStr(C)} is not maximal, vertex ${ext} is adjacent to all of it.`);
        }
        return;
      }
      const v = order[i];
      const fits = C.every((u) => adj[u].has(v));
      yield ev('branch', C, cands(i), skipped, v, fits
        ? `Vertex ${v} is adjacent to all of ${setStr(C)}: try with it, then without it.`
        : `Vertex ${v} is not adjacent to all of ${setStr(C)}: skip it.`);
      if (fits) {
        C.push(v);
        yield* update(i + 1);
        C.pop();
      }
      skipped.push(v);
      yield* update(i + 1);
      skipped.pop();
    }
    yield* update(0);
  }

  const GENS = { els: elsGen, tomita: tomitaGen, chiba: chibaGen };

  // ---------- graph state ----------

  const MAX_NODES = 40;
  const state = { n: 0, adj: [], pos: [], vel: [], cliques: [], selected: 0, picked: -1, physics: true };

  function randomGraph(n, p) {
    const adj = Array.from({ length: n }, () => new Set());
    for (let u = 0; u < n; u++)
      for (let v = u + 1; v < n; v++)
        if (Math.random() < p) { adj[u].add(v); adj[v].add(u); }
    return adj;
  }

  function layout(adj) {
    const n = adj.length;
    const pos = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return { x: 0.5 + 0.35 * Math.cos(a) + (Math.random() - 0.5) * 0.05, y: 0.5 + 0.35 * Math.sin(a) + (Math.random() - 0.5) * 0.05 };
    });
    for (let it = 0; it < 300; it++) forceStep(pos, adj, null, 0.08 * Math.pow(0.985, it));
    return pos;
  }

  // One step of a force-directed layout in the unit square. Returns the largest move.
  function forceStep(pos, adj, pinned, maxStep) {
    const n = pos.length;
    if (!n) return 0;
    const k = 0.95 / Math.sqrt(Math.max(n, 2));
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-4) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        let f = (k * k) / d;
        if (adj[i].has(j)) f -= (d * d) / k;
        dx = (dx / d) * f; dy = (dy / d) * f;
        disp[i].x += dx; disp[i].y += dy;
        disp[j].x -= dx; disp[j].y -= dy;
      }
      disp[i].x += (0.5 - pos[i].x) * 0.12;
      disp[i].y += (0.5 - pos[i].y) * 0.12;
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (i === pinned) continue;
      const d = Math.hypot(disp[i].x, disp[i].y) || 1;
      const s = Math.min(d, maxStep) / d;
      const nx = Math.min(2, Math.max(-1, pos[i].x + disp[i].x * s));
      const ny = Math.min(2, Math.max(-1, pos[i].y + disp[i].y * s));
      moved = Math.max(moved, Math.hypot(nx - pos[i].x, ny - pos[i].y));
      pos[i].x = nx; pos[i].y = ny;
    }
    return moved;
  }

  // ---------- live physics loop ----------

  let physicsRaf = 0, calmFrames = 0, heat = 0.02;
  function kick(amount = 0.02) {
    heat = Math.max(heat, amount);
    calmFrames = 0;
    if (!physicsRaf && state.physics) physicsRaf = requestAnimationFrame(physicsTick);
  }
  function physicsTick() {
    physicsRaf = 0;
    if (!state.physics) return;
    const moved = forceStep(state.pos, state.adj, drag && drag.moved ? drag.i : null, heat);
    heat = Math.max(0.004, heat * 0.97);
    draw();
    calmFrames = moved < 0.0008 ? calmFrames + 1 : 0;
    if (calmFrames < 20 || (drag && drag.moved)) physicsRaf = requestAnimationFrame(physicsTick);
  }

  // ---------- compute + render panel ----------

  const canonical = (cl) => cl.map((c) => c.slice().sort((a, b) => a - b)).sort((a, b) => b.length - a.length || a.join() .localeCompare(b.join(), undefined, { numeric: true }));
  const keyOf = (list) => list.map((c) => c.join(',')).join('|');
  const cliqueKey = (c) => c.slice().sort((a, b) => a - b).join(',');

  function recompute() {
    resetAnim();
    const results = ALGOS.map((a) => {
      const t0 = performance.now();
      const r = RUNNERS[a.id](state.adj);
      r.ms = performance.now() - t0;
      r.sorted = canonical(r.cliques);
      return { ...a, ...r };
    });
    state.cliques = results[0].sorted;
    state.cliqueIndex = new Map(state.cliques.map((c, i) => [c.join(','), i]));
    state.selected = state.cliques.length ? 0 : -1;

    const ref = keyOf(results[0].sorted);
    $('compareBody').innerHTML = results.map((r) => {
      const ok = r.aborted || keyOf(r.sorted) === ref;
      const largest = r.sorted.length ? r.sorted[0].length : 0;
      const time = r.ms < 1 ? '<1 ms' : `${r.ms.toFixed(r.ms < 10 ? 1 : 0)} ms`;
      return `<tr data-algo="${r.id}" class="${r.id === anim.algo ? 'active' : ''}"><td><span class="dot" style="background:var(${r.color})"></span>${r.name}${ok ? '' : ' ⚠'}</td>
        <td>${r.aborted ? '–' : fmtInt(r.sorted.length)}</td><td>${r.aborted ? '–' : largest}</td>
        <td>${r.aborted ? '&gt; ' + fmtInt(CHIBA_CALL_LIMIT) : fmtInt(r.calls)}</td><td>${r.aborted ? 'stopped' : time}</td></tr>`;
    }).join('');

    renderCliqueList();
    renderMiniHist();
    updateNodeButtons();
    draw();
  }

  function renderCliqueList() {
    const list = state.cliques;
    $('cliqueCount').textContent = `(${list.length})`;
    const shown = list.slice(0, 300);
    $('cliqueList').innerHTML = shown.map((c, i) =>
      `<button class="chip" role="option" data-i="${i}" aria-selected="${i === state.selected}">{${c.join(', ')}}</button>`
    ).join('') + (list.length > shown.length ? `<span class="muted">+${list.length - shown.length} more</span>` : '');
    renderHint();
  }

  function renderHint() {
    const c = state.cliques[state.selected];
    $('hint').textContent = c
      ? `Highlighted: {${c.join(', ')}}, a maximal clique of size ${c.length}.`
      : state.n ? 'No edges yet. Click two nodes to connect them.' : 'No nodes. Double-click the canvas or press Add node.';
  }

  function renderMiniHist() {
    const counts = {};
    for (const c of state.cliques) counts[c.length] = (counts[c.length] || 0) + 1;
    const sizes = Object.keys(counts).map(Number);
    if (!sizes.length) { $('miniHist').innerHTML = ''; return; }
    const max = Math.max(...Object.values(counts));
    let html = '';
    for (let s = Math.min(...sizes); s <= Math.max(...sizes); s++) {
      const v = counts[s] || 0;
      html += `<div class="col" data-tip="${fmtInt(v)} maximal clique${v === 1 ? '' : 's'} of size ${s}">
        <span class="val">${v || ''}</span><div class="bar" style="height:${v ? Math.max(3, (v / max) * 62) : 0}px"></div><span class="lab">${s}</span></div>`;
    }
    $('miniHist').innerHTML = html;
  }

  // ---------- step-by-step animation ----------

  const SPEEDS = [1, 2, 4, 8, 16, 40, 120];
  const anim = { algo: 'els', gen: null, cur: null, st: null, steps: 0, done: false, playing: false, timer: 0, found: new Set(), flash: 0 };

  function resetAnim() {
    clearTimeout(anim.timer);
    Object.assign(anim, { gen: null, cur: null, st: null, steps: 0, done: false, playing: false, timer: 0, found: new Set(), flash: 0 });
    renderAnimUi();
  }
  function ensureGen() {
    if (anim.gen) return;
    anim.st = { calls: 0, found: 0 };
    anim.gen = GENS[anim.algo](state.adj, anim.st);
    state.picked = -1;
  }
  function advance() {
    ensureGen();
    if (anim.done) return false;
    const r = anim.gen.next();
    if (r.done || anim.steps >= ANIM_EVENT_LIMIT) {
      anim.done = true;
      anim.playing = false;
      anim.cur = r.done
        ? { kind: 'end', R: [], P: [], X: [], focus: -1, msg: `Done. ${ALGOS.find((a) => a.id === anim.algo).name} found ${fmtInt(anim.st.found)} maximal clique${anim.st.found === 1 ? '' : 's'} in ${fmtInt(anim.st.calls)} search steps.` }
        : { kind: 'end', R: [], P: [], X: [], focus: -1, msg: `Stopped after ${fmtInt(ANIM_EVENT_LIMIT)} steps. Try a smaller graph.` };
      return false;
    }
    anim.steps++;
    anim.cur = r.value;
    if (r.value.kind === 'found') {
      const key = cliqueKey(r.value.R);
      anim.found.add(key);
      anim.flash = performance.now();
      const i = state.cliqueIndex.get(key);
      const chip = i !== undefined && $('cliqueList').querySelector(`.chip[data-i="${i}"]`);
      if (chip) chip.classList.add('found');
    }
    return true;
  }
  function renderAnimUi() {
    const a = ALGOS.find((x) => x.id === anim.algo);
    $('animPlay').textContent = anim.playing ? 'Pause' : anim.gen && !anim.done ? 'Resume' : anim.done ? 'Replay' : 'Run step by step';
    $('animStep').disabled = anim.done;
    $('animFinish').disabled = anim.done;
    $('animReset').disabled = !anim.gen;
    for (const b of $('algoPick').querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.algo === anim.algo);
    for (const tr of $('compareBody').querySelectorAll('tr')) tr.classList.toggle('active', tr.dataset.algo === anim.algo);
    const box = $('animStatus');
    $('playground').classList.toggle('anim-on', !!anim.gen);
    if (!anim.gen) {
      box.hidden = true;
      for (const c of $('cliqueList').querySelectorAll('.chip.found')) c.classList.remove('found');
      return;
    }
    box.hidden = false;
    box.style.setProperty('--accent', `var(${a.color})`);
    $('animCounts').innerHTML = `<b>${fmtInt(anim.st.found)}</b> of ${fmtInt(state.cliques.length)} cliques found · ${fmtInt(anim.st.calls)} search steps`;
    $('animMsg').textContent = anim.cur ? anim.cur.msg : 'Ready.';
  }
  function tick() {
    if (!anim.playing) return;
    const sp = SPEEDS[Number($('speedIn').value)];
    // at high speeds take several steps per frame so big graphs still finish
    const batch = sp > 40 ? Math.ceil(sp / 40) : 1;
    let ok = true;
    for (let k = 0; k < batch && ok; k++) {
      ok = advance();
      if (ok && anim.cur.kind === 'found' && sp <= 8) break;
    }
    renderAnimUi();
    draw();
    if (!ok) { anim.playing = false; renderAnimUi(); return; }
    const pause = anim.cur.kind === 'found' ? Math.max(1000 / sp, sp <= 8 ? 650 : 0) : 1000 / Math.min(sp, 40);
    anim.timer = setTimeout(tick, pause);
  }
  function play() {
    if (anim.done) resetAnim();
    ensureGen();
    anim.playing = true;
    renderAnimUi();
    tick();
  }
  function pause() {
    anim.playing = false;
    clearTimeout(anim.timer);
    renderAnimUi();
  }

  $('animPlay').addEventListener('click', () => (anim.playing ? pause() : play()));
  $('animStep').addEventListener('click', () => { pause(); advance(); renderAnimUi(); draw(); });
  $('animFinish').addEventListener('click', () => { pause(); while (advance()); renderAnimUi(); draw(); });
  $('animReset').addEventListener('click', () => { resetAnim(); draw(); });
  $('algoPick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    anim.algo = b.dataset.algo;
    resetAnim();
    draw();
  });
  $('compareBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    anim.algo = tr.dataset.algo;
    resetAnim();
    draw();
  });
  $('speedIn').addEventListener('input', (e) => { $('speedOut').textContent = `${SPEEDS[e.target.value]} steps/s`; });

  // ---------- canvas ----------

  const canvas = $('graph');
  const ctx = canvas.getContext('2d');
  let colors = {};
  const readColors = () => {
    colors = { edge: css('--edge'), node: css('--node'), stroke: css('--node-stroke'), text: css('--text'), text2: css('--text-2'),
      hl: css('--series-1'), hlEdge: css('--hl-edge'), pick: css('--pick'), bg: css('--surface-2'), ok: css('--series-3') };
    for (const a of ALGOS) colors[a.id] = css(a.color);
  };

  const PAD = 26;
  const R_NODE = () => (state.n > 26 ? 11 : 13);
  // The view follows the graph's bounding box so it always fills the canvas.
  // It eases toward the target and holds still while a node is being dragged.
  let view = null, viewRaf = 0;
  function targetView() {
    if (!state.n) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of state.pos) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const fix = (a, b) => { const m = (a + b) / 2, h = Math.max((b - a) / 2, 0.15); return [m - h, m + h]; };
    [x0, x1] = fix(x0, x1); [y0, y1] = fix(y0, y1);
    return { x0, x1, y0, y1 };
  }
  function updateView() {
    const t = targetView();
    if (!view) { view = t; return; }
    if (drag && drag.moved) return;
    let off = 0;
    for (const k of ['x0', 'x1', 'y0', 'y1']) { view[k] += (t[k] - view[k]) * 0.18; off = Math.max(off, Math.abs(t[k] - view[k])); }
    if (off > 0.002 && !viewRaf) viewRaf = requestAnimationFrame(() => { viewRaf = 0; draw(); });
  }
  function toPx(p) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return { x: PAD + ((p.x - view.x0) / (view.x1 - view.x0)) * (w - 2 * PAD), y: PAD + ((p.y - view.y0) / (view.y1 - view.y0)) * (h - 2 * PAD) };
  }
  function fromPx(x, y) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cx = Math.min(w - PAD / 2, Math.max(PAD / 2, x)), cy = Math.min(h - PAD / 2, Math.max(PAD / 2, y));
    return { x: view.x0 + ((cx - PAD) / (w - 2 * PAD)) * (view.x1 - view.x0), y: view.y0 + ((cy - PAD) / (h - 2 * PAD)) * (view.y1 - view.y0) };
  }
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  const ring = (p, r) => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.stroke(); };

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    updateView();
    const P = state.pos.map(toPx);
    const r = R_NODE();
    const cur = anim.gen ? anim.cur : null;
    const animOn = !!anim.gen;
    const accent = colors[anim.algo];

    // what to emphasise
    const inR = new Set(animOn ? (cur ? cur.R : []) : state.cliques[state.selected] || []);
    const inP = new Set(cur ? cur.P : []);
    const inX = new Set(cur ? cur.X : []);
    const focus = cur ? cur.focus : -1;
    const isFound = cur && cur.kind === 'found';
    const isDead = cur && cur.kind === 'dead';
    const strong = animOn ? (isFound ? colors.ok : accent) : colors.hlEdge;

    ctx.lineCap = 'round';
    for (let u = 0; u < state.n; u++) {
      for (const v of state.adj[u]) {
        if (v < u || (inR.has(u) && inR.has(v))) continue;
        const faded = animOn && cur && (inX.has(u) || inX.has(v)) && !inR.has(u) && !inR.has(v) && !inP.has(u) && !inP.has(v);
        ctx.globalAlpha = faded ? 0.35 : 1;
        ctx.strokeStyle = colors.edge; ctx.lineWidth = 1.5;
        line(P[u], P[v]);
      }
    }
    ctx.globalAlpha = 1;
    // edges from the vertex being considered to the current clique
    if (focus >= 0 && cur && cur.kind !== 'pivot') {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = isDead ? colors.pick : accent; ctx.lineWidth = 2;
      for (const u of inR) if (state.adj[focus].has(u)) line(P[focus], P[u]);
      ctx.setLineDash([]);
    }
    for (const u of inR) for (const v of inR) {
      if (v <= u || !state.adj[u].has(v)) continue;
      ctx.strokeStyle = strong; ctx.lineWidth = isFound ? 4 : 3;
      line(P[u], P[v]);
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${r > 11 ? 12 : 11}px Inter, system-ui, sans-serif`;
    const pulse = isFound ? Math.max(0, 1 - (performance.now() - anim.flash) / 500) : 0;
    for (let u = 0; u < state.n; u++) {
      const hl = inR.has(u);
      const fade = animOn && cur && cur.kind !== 'end' && !hl && !inP.has(u) && u !== focus;
      ctx.globalAlpha = fade ? (inX.has(u) ? 0.55 : 0.3) : 1;
      ctx.beginPath(); ctx.arc(P[u].x, P[u].y, r + (hl ? pulse * 4 : 0), 0, 2 * Math.PI);
      ctx.fillStyle = hl ? strong : colors.node; ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hl ? colors.bg : inP.has(u) ? accent : colors.stroke;
      if (inX.has(u) && !hl) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (inP.has(u) && !hl) { ctx.lineWidth = 2; ctx.strokeStyle = accent; ring(P[u], r + 3); }
      ctx.globalAlpha = 1;
      if (u === focus) { ctx.lineWidth = 2.5; ctx.strokeStyle = colors.pick; ring(P[u], r + 6); }
      if (u === state.picked) { ctx.lineWidth = 2.5; ctx.strokeStyle = colors.pick; ring(P[u], r + 5); }
      ctx.globalAlpha = fade ? 0.6 : 1;
      ctx.fillStyle = hl ? '#ffffff' : colors.text;
      ctx.fillText(String(u), P[u].x, P[u].y + 0.5);
      ctx.globalAlpha = 1;
    }
    if (pulse > 0) requestAnimationFrame(draw);
  }

  function nodeAt(x, y) {
    const r = R_NODE() + 6;
    let best = -1, bd = Infinity;
    state.pos.forEach((p, i) => {
      const q = toPx(p);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < r && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ---------- editing ----------

  function updateNodeButtons() {
    $('addNode').disabled = state.n >= MAX_NODES;
    $('delNode').disabled = state.picked < 0;
    $('delNode').textContent = state.picked < 0 ? 'Remove node' : `Remove node ${state.picked}`;
  }
  function setPicked(i) { state.picked = i; updateNodeButtons(); draw(); }

  function addNode(p) {
    if (state.n >= MAX_NODES) return;
    state.adj.push(new Set());
    state.pos.push(p || { x: 0.5 + (Math.random() - 0.5) * 0.3, y: 0.5 + (Math.random() - 0.5) * 0.3 });
    state.n++;
    state.picked = state.n - 1;
    recompute();
    kick(0.03);
  }
  function removeNode(i) {
    if (i < 0) return;
    const map = (v) => (v > i ? v - 1 : v);
    state.adj = state.adj.filter((_, u) => u !== i).map((s) => new Set([...s].filter((v) => v !== i).map(map)));
    state.pos.splice(i, 1);
    state.n--;
    state.picked = -1;
    recompute();
    kick(0.03);
  }
  function toggleEdge(u, v) {
    if (state.adj[u].has(v)) { state.adj[u].delete(v); state.adj[v].delete(u); }
    else { state.adj[u].add(v); state.adj[v].add(u); }
    recompute();
    kick(0.03);
  }

  let drag = null;
  const local = (e) => { const rect = canvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = local(e);
    const i = nodeAt(x, y);
    if (i < 0) { if (state.picked >= 0) setPicked(-1); return; }
    drag = { i, x0: x, y0: y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { x, y } = local(e);
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) > 4) { drag.moved = true; canvas.classList.add('dragging'); }
    if (drag.moved) { state.pos[drag.i] = fromPx(x, y); if (state.physics) kick(0.012); else draw(); }
  });
  const endDrag = () => {
    if (!drag) return;
    const { i, moved } = drag;
    drag = null;
    canvas.classList.remove('dragging');
    if (moved) { kick(0.012); return; }
    if (state.picked < 0) return setPicked(i);
    if (state.picked === i) return setPicked(-1);
    const u = state.picked;
    state.picked = -1;
    toggleEdge(u, i);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => {
    const { x, y } = local(e);
    if (nodeAt(x, y) < 0) addNode(fromPx(x, y));
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.picked >= 0 && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      e.preventDefault();
      removeNode(state.picked);
    }
  });
  $('addNode').addEventListener('click', () => addNode());
  $('delNode').addEventListener('click', () => removeNode(state.picked));
  $('physicsIn').addEventListener('change', (e) => { state.physics = e.target.checked; if (state.physics) kick(0.03); });

  $('cliqueList').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (anim.gen) resetAnim();
    state.selected = Number(b.dataset.i);
    for (const c of $('cliqueList').querySelectorAll('.chip')) c.setAttribute('aria-selected', c === b);
    renderHint();
    draw();
  });

  function newGraph() {
    state.n = Number($('nIn').value);
    state.adj = randomGraph(state.n, Number($('pIn').value));
    state.pos = layout(state.adj);
    state.picked = -1;
    view = null;
    recompute();
    kick(0.01);
  }
  $('nIn').addEventListener('input', (e) => { $('nOut').textContent = e.target.value; });
  $('pIn').addEventListener('input', (e) => { $('pOut').textContent = Number(e.target.value).toFixed(2); });
  $('nIn').addEventListener('change', newGraph);
  $('pIn').addEventListener('change', newGraph);
  $('regen').addEventListener('click', newGraph);
  $('clear').addEventListener('click', () => {
    state.adj = Array.from({ length: state.n }, () => new Set());
    state.picked = -1;
    recompute();
    kick(0.04);
  });

  // ---------- tooltip ----------

  const tip = $('tip');
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });

  // ---------- benchmark section ----------

  const D = window.RESULTS;
  const fmtTime = (s) => {
    if (s < 60) return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
    if (s < 3600) return `${(s / 60).toFixed(1)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  };
  const fmtCompact = (x) => (x >= 1e6 ? +(x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? +(x / 1e3).toFixed(1) + 'K' : String(x));

  $('datasetStats').innerHTML = D.datasets.map((d) => `
    <div class="stat"><div class="name">${d.name}</div><div class="what">${d.what}</div>
      <dl><dt>Nodes</dt><dd>${fmtInt(d.nodes)}</dd><dt>Edges</dt><dd>${fmtInt(d.edges)}</dd>
      <dt>Maximal cliques</dt><dd>${fmtInt(d.cliques)}</dd><dt>Largest clique</dt><dd>${d.largest}</dd></dl></div>`).join('');

  $('timeLegend').innerHTML = ALGOS.map((a) => `<span><span class="dot" style="background:var(${a.color})"></span>${a.name}</span>`).join('');

  function timeChart() {
    const W = 760, rowH = 22, groupGap = 14, left = 96, right = 92, top = 8;
    const ticks = [1, 10, 60, 600, 3600, 36000, 86400];
    const tickLab = ['1 s', '10 s', '1 min', '10 min', '1 h', '10 h', '1 day'];
    const lo = Math.log10(0.8), hi = Math.log10(100000);
    const X = (s) => left + ((Math.log10(s) - lo) / (hi - lo)) * (W - left - right);
    const H = top + D.datasets.length * (ALGOS.length * rowH + groupGap) + 22;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sequential running time per algorithm and dataset, log scale">`;
    ticks.forEach((t, i) => {
      s += `<line class="gridline" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 20}"/>`;
      s += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${tickLab[i]}</text>`;
    });
    let y = top;
    D.datasets.forEach((d) => {
      s += `<text class="rowlabel" x="0" y="${y + (ALGOS.length * rowH) / 2 + 4}">${d.name}</text>`;
      ALGOS.forEach((a) => {
        const [seq, par] = D.times[a.id][d.id];
        const lb = D.lowerBound[a.id] && D.lowerBound[a.id][d.id];
        const cy = y + rowH / 2;
        const x = X(seq);
        const label = lb ? `> ${fmtTime(seq)}, stopped` : fmtTime(seq);
        const tipText = `${a.name} on ${d.name}: ${lb ? 'stopped after ' + fmtTime(seq) : fmtTime(seq)}${par ? `, ${fmtTime(par)} with OpenMP` : ''}`;
        s += `<g data-tip="${tipText}">`;
        s += `<rect x="${left - 4}" y="${y}" width="${W - left}" height="${rowH}" fill="transparent"/>`;
        s += `<line x1="${X(0.8)}" x2="${x}" y1="${cy}" y2="${cy}" stroke="var(${a.color})" stroke-width="2" stroke-linecap="round" ${lb ? 'stroke-dasharray="3 4"' : ''}/>`;
        s += lb
          ? `<circle cx="${x}" cy="${cy}" r="5" fill="var(--surface)" stroke="var(${a.color})" stroke-width="2"/>`
          : `<circle cx="${x}" cy="${cy}" r="5" fill="var(${a.color})" stroke="var(--surface)" stroke-width="2"/>`;
        s += `<text x="${x + 10}" y="${cy + 4}" style="fill:var(--text)">${label}</text></g>`;
        y += rowH;
      });
      y += groupGap;
    });
    $('timeChart').innerHTML = s + '</svg>';

    let t = '<thead><tr><th>Algorithm</th>' + D.datasets.map((d) => `<th>${d.name}</th><th>${d.name} (OpenMP)</th>`).join('') + '</tr></thead><tbody>';
    ALGOS.forEach((a) => {
      t += `<tr><td>${a.name}</td>` + D.datasets.map((d) => {
        const [seq, par] = D.times[a.id][d.id];
        const lb = D.lowerBound[a.id] && D.lowerBound[a.id][d.id];
        return `<td>${lb ? '&gt; ' : ''}${fmtTime(seq)}</td><td>${par ? fmtTime(par) : '–'}</td>`;
      }).join('') + '</tr>';
    });
    $('timeTable').innerHTML = t + '</tbody>';
  }

  function distChart(id) {
    const d = D.datasets.find((x) => x.id === id);
    const entries = Object.entries(d.dist).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
    const W = 760, H = 260, left = 48, right = 8, top = 22, bottom = 26;
    const maxV = Math.max(...entries.map((e) => e[1]));
    const mag = Math.pow(10, Math.floor(Math.log10(maxV / 4)));
    const tick = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => t * 4 >= maxV);
    const niceMax = tick * 4;
    const n = entries.length;
    const bw = (W - left - right) / n;
    const Y = (v) => top + (1 - v / niceMax) * (H - top - bottom);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Maximal clique size distribution for ${d.name}">`;
    for (let k = 0; k <= 4; k++) {
      const v = (niceMax / 4) * k;
      s += `<line class="gridline" x1="${left}" x2="${W - right}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      s += `<text x="${left - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtCompact(v)}</text>`;
    }
    const labelEvery = n > 30 ? 5 : n > 16 ? 2 : 1;
    const peak = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    entries.forEach(([size, v], i) => {
      const x = left + i * bw;
      const gap = Math.min(2, bw * 0.2);
      const w = bw - gap;
      const h = Math.max(1, H - bottom - Y(v));
      const rad = Math.min(4, w / 2, h);
      const y0 = H - bottom;
      s += `<g data-tip="Size ${size}: ${fmtInt(v)} maximal cliques">`;
      s += `<rect x="${x}" y="${top}" width="${bw}" height="${H - top - bottom}" fill="transparent"/>`;
      s += `<path d="M${x + gap / 2},${y0} V${y0 - h + rad} q0,-${rad} ${rad},-${rad} H${x + gap / 2 + w - rad} q${rad},0 ${rad},${rad} V${y0} Z" fill="var(--seq)"/>`;
      s += '</g>';
      if (size % labelEvery === 0 || n <= 16) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${size}</text>`;
      if (size === peak[0]) s += `<text x="${x + bw / 2}" y="${Y(v) - 6}" text-anchor="middle" style="fill:var(--text)">${fmtInt(v)}</text>`;
    });
    $('distChart').innerHTML = s + '</svg>';
  }

  $('distTabs').innerHTML = D.datasets.map((d, i) =>
    `<button role="tab" data-id="${d.id}" aria-selected="${i === 0}">${d.name}</button>`).join('');
  $('distTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $('distTabs').children) x.setAttribute('aria-selected', x === b);
    distChart(b.dataset.id);
  });

  // ---------- boot ----------

  readColors();
  timeChart();
  distChart(D.datasets[0].id);
  newGraph();
  window.addEventListener('resize', draw);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
})();
