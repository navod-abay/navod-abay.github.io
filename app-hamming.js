document.addEventListener("DOMContentLoaded", () => {
    // =====================================================================
    // DOM References
    // =====================================================================
    const canvas       = document.getElementById('hammingCanvas');
    const ctx          = canvas.getContext('2d');
    const statusBar    = document.getElementById('editor-status');
    const resultsPanel = document.getElementById('results-panel');
    const nInput        = document.getElementById('n-input');
    const generateBtn   = document.getElementById('generate-btn');

    const modeBtns        = document.querySelectorAll('.tab-btn[data-mode]');
    const generatorPanel  = document.getElementById('generator-panel');
    const codewordsPanel  = document.getElementById('codewords-panel');
    const matrixRows      = document.getElementById('matrix-rows');
    const addRowBtn       = document.getElementById('add-row-btn');
    const showSubspaceBtn = document.getElementById('show-subspace-btn');
    const selectedChips   = document.getElementById('selected-chips');
    const clearSelectionBtn = document.getElementById('clear-selection-btn');
    const calculateSpanBtn  = document.getElementById('calculate-span-btn');

    const emptyState  = document.getElementById('empty-state');
    const resultsBody = document.getElementById('results-body');
    const statN    = document.getElementById('stat-n');
    const statK    = document.getElementById('stat-k');
    const statSize = document.getElementById('stat-size');
    const statD    = document.getElementById('stat-d');
    const codewordList = document.getElementById('codeword-list');

    const NODE_RADIUS  = 14;
    const CANVAS_MIN_H = 400;
    const CANVAS_MAX_H = 700;

    let n = 4;
    let nodes = [];          // { id, x, y }
    let edges = [];          // { u, v }
    let activeMode = 'generator';
    let selectedWords = [];       // integers, in click order (codewords mode)
    let subspace = null;          // Set<number> currently highlighted, or null
    let originalWords = new Set(); // words considered "user-provided" for the current subspace

    // =====================================================================
    // Canvas sizing (mirrors app.js's panel <-> canvas height sync)
    // =====================================================================
    let currentCanvasH = CANVAS_MIN_H;
    const panelResizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const panelH = entry.contentRect.height;
            const newCanvasH = Math.min(CANVAS_MAX_H, Math.max(CANVAS_MIN_H, panelH));
            if (Math.abs(newCanvasH - currentCanvasH) > 4) {
                currentCanvasH = newCanvasH;
                applyCanvasSize();
            }
        }
    });
    panelResizeObserver.observe(resultsPanel);

    function applyCanvasSize() {
        const container = canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.max(100, Math.floor(rect.width - 32));
        const cssH = currentCanvasH;
        canvas.style.width  = cssW + 'px';
        canvas.style.height = cssH + 'px';
        canvas.width  = cssW * dpr;
        canvas.height = cssH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawGraph();
    }
    window.addEventListener('resize', applyCanvasSize);

    // =====================================================================
    // GF(2) linear algebra utilities
    // =====================================================================
    function popcount(x) {
        let c = 0;
        while (x) { c += x & 1; x >>= 1; }
        return c;
    }

    // Reduce a list of integer bitmasks to an independent basis via
    // Gaussian elimination over GF(2) (insert-by-highest-set-bit).
    function gf2Basis(vectors) {
        const basis = [];
        for (let v of vectors) {
            for (const b of basis) {
                if ((v ^ b) < v) v = v ^ b;
            }
            if (v !== 0) basis.push(v);
        }
        return basis.sort((a, b) => b - a);
    }

    // All 2^k XOR-combinations of a basis of size k.
    function gf2Span(vectors) {
        const basis = gf2Basis(vectors);
        const span = new Set([0]);
        for (const b of basis) {
            for (const s of Array.from(span)) span.add(s ^ b);
        }
        return span;
    }

    function minDistance(codewordSet) {
        const words = Array.from(codewordSet);
        if (words.length < 2) return words.length === 1 ? 0 : null;
        let d = Infinity;
        for (let i = 0; i < words.length; i++) {
            for (let j = i + 1; j < words.length; j++) {
                d = Math.min(d, popcount(words[i] ^ words[j]));
            }
        }
        return d;
    }

    function toBits(v) { return v.toString(2).padStart(n, '0'); }

    // =====================================================================
    // Hypercube construction + nested-square layout
    // =====================================================================
    function buildHypercube(newN) {
        n = newN;
        const count = 1 << n;
        nodes = [];
        edges = [];

        // n offset vectors with shrinking radius, spread around a circle.
        const W = 600, H = 500;
        const R = Math.min(W, H) * 0.42;
        const offsets = [];
        for (let k = 0; k < n; k++) {
            const theta = (k * 2 * Math.PI / n) + 0.35;
            const r = R * Math.pow(0.55, k);
            offsets.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
        }

        const cx = W / 2, cy = H / 2;
        for (let id = 0; id < count; id++) {
            let x = cx, y = cy;
            for (let k = 0; k < n; k++) {
                if (id & (1 << k)) { x += offsets[k].x; y += offsets[k].y; }
            }
            nodes.push({ id, x, y });
        }

        for (let u = 0; u < count; u++) {
            for (let k = 0; k < n; k++) {
                const v = u ^ (1 << k);
                if (v > u) edges.push({ u, v });
            }
        }

        selectedWords = [];
        subspace = null;
        originalWords = new Set();
        rebuildMatrixRowsForN();
        renderChips();
        showEmptyResults();
        applyCanvasSize();
        statusBar.textContent = `n = ${n}  |  Nodes: ${count}  |  Edges: ${edges.length}`;
    }

    // =====================================================================
    // Drawing
    // =====================================================================
    function drawGraph() {
        const Wc = canvas.width  / (window.devicePixelRatio || 1);
        const Hc = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, Wc, Hc);
        if (nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(nd => {
            minX = Math.min(minX, nd.x); minY = Math.min(minY, nd.y);
            maxX = Math.max(maxX, nd.x); maxY = Math.max(maxY, nd.y);
        });
        const rangeX = (maxX - minX) || 1, rangeY = (maxY - minY) || 1;
        const pad = 40;
        const scale = Math.min((Wc - pad * 2) / rangeX, (Hc - pad * 2) / rangeY);
        const offX = pad + ((Wc - pad * 2) - rangeX * scale) / 2;
        const offY = pad + ((Hc - pad * 2) - rangeY * scale) / 2;
        const pos = nd => ({ x: offX + (nd.x - minX) * scale, y: offY + (nd.y - minY) * scale });

        const nodeById = id => nodes.find(nd => nd.id === id);
        const inSubspace = id => subspace && subspace.has(id);

        // Edges
        edges.forEach(e => {
            const highlighted = inSubspace(e.u) && inSubspace(e.v);
            const p1 = pos(nodeById(e.u)), p2 = pos(nodeById(e.v));
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            if (highlighted) {
                ctx.strokeStyle = 'rgba(46,160,67,0.9)';
                ctx.lineWidth = 2.5;
                ctx.shadowBlur = 6;
                ctx.shadowColor = 'rgba(46,160,67,0.6)';
            } else {
                ctx.strokeStyle = 'rgba(139,148,158,0.25)';
                ctx.lineWidth = 1.2;
                ctx.shadowBlur = 0;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        });

        const showLabels = n <= 4;
        const selectedSet = new Set(selectedWords);

        nodes.forEach(nd => {
            const p = pos(nd);
            let fill = '#161b22', stroke = '#58a6ff', glow = '#1f6feb';
            if (subspace) {
                if (inSubspace(nd.id)) {
                    if (originalWords.has(nd.id)) { stroke = '#2ea043'; glow = '#2ea043'; }
                    else { stroke = '#d29922'; glow = '#d29922'; }
                } else {
                    stroke = 'rgba(139,148,158,0.35)'; glow = 'transparent';
                }
            } else if (selectedSet.has(nd.id)) {
                stroke = '#2ea043'; glow = '#2ea043';
            }

            ctx.shadowBlur = glow === 'transparent' ? 0 : 8;
            ctx.shadowColor = glow;
            ctx.beginPath(); ctx.arc(p.x, p.y, NODE_RADIUS, 0, 2 * Math.PI);
            ctx.fillStyle = fill; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
            ctx.shadowBlur = 0;

            if (showLabels) {
                ctx.fillStyle = '#e6edf3';
                ctx.font = '10px "JetBrains Mono", monospace';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(toBits(nd.id), p.x, p.y);
            }
        });

        canvas.dataset.layout = JSON.stringify({ minX, minY, rangeX, rangeY, pad, scale, offX, offY });
    }

    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function getNodeAtScreen(x, y) {
        const Wc = canvas.width  / (window.devicePixelRatio || 1);
        const Hc = canvas.height / (window.devicePixelRatio || 1);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(nd => {
            minX = Math.min(minX, nd.x); minY = Math.min(minY, nd.y);
            maxX = Math.max(maxX, nd.x); maxY = Math.max(maxY, nd.y);
        });
        const rangeX = (maxX - minX) || 1, rangeY = (maxY - minY) || 1;
        const pad = 40;
        const scale = Math.min((Wc - pad * 2) / rangeX, (Hc - pad * 2) / rangeY);
        const offX = pad + ((Wc - pad * 2) - rangeX * scale) / 2;
        const offY = pad + ((Hc - pad * 2) - rangeY * scale) / 2;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const nd = nodes[i];
            const px = offX + (nd.x - minX) * scale, py = offY + (nd.y - minY) * scale;
            const dx = px - x, dy = py - y;
            if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return nd;
        }
        return null;
    }

    canvas.addEventListener('click', e => {
        if (activeMode !== 'codewords') return;
        const pos = getMousePos(e);
        const hit = getNodeAtScreen(pos.x, pos.y);
        if (!hit) return;
        const idx = selectedWords.indexOf(hit.id);
        if (idx >= 0) selectedWords.splice(idx, 1);
        else selectedWords.push(hit.id);
        subspace = null;
        renderChips();
        showEmptyResults();
        drawGraph();
    });

    // =====================================================================
    // Mode switching
    // =====================================================================
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeMode = btn.dataset.mode;
            generatorPanel.classList.toggle('active', activeMode === 'generator');
            codewordsPanel.classList.toggle('active', activeMode === 'codewords');
        });
    });

    // =====================================================================
    // Generator matrix mode
    // =====================================================================
    function rebuildMatrixRowsForN() {
        matrixRows.innerHTML = '';
        addMatrixRow();
        addMatrixRow();
    }

    function addMatrixRow(value = '') {
        const row = document.createElement('div');
        row.className = 'matrix-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = n;
        input.placeholder = '0'.repeat(n);
        input.value = value;
        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^01]/g, '').slice(0, n);
            input.classList.toggle('invalid', input.value.length > 0 && input.value.length !== n);
        });
        const removeBtn = document.createElement('button');
        removeBtn.className = 'row-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => row.remove());
        row.appendChild(input);
        row.appendChild(removeBtn);
        matrixRows.appendChild(row);
    }

    addRowBtn.addEventListener('click', () => addMatrixRow());

    showSubspaceBtn.addEventListener('click', () => {
        const inputs = Array.from(matrixRows.querySelectorAll('input[type="text"]'));
        const rows = [];
        for (const inp of inputs) {
            if (inp.value.length === 0) continue;
            if (inp.value.length !== n) {
                statusBar.textContent = `Each row must be exactly ${n} bits.`;
                inp.classList.add('invalid');
                return;
            }
            rows.push(parseInt(inp.value, 2));
        }
        if (rows.length === 0) {
            statusBar.textContent = 'Enter at least one generator row.';
            return;
        }
        subspace = gf2Span(rows);
        originalWords = new Set(rows);
        selectedWords = [];
        renderResults(subspace, originalWords);
        drawGraph();
    });

    // =====================================================================
    // Codeword click mode
    // =====================================================================
    function renderChips() {
        selectedChips.innerHTML = '';
        selectedWords.forEach(w => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.innerHTML = `<span>${toBits(w)}</span>`;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                selectedWords = selectedWords.filter(x => x !== w);
                subspace = null;
                renderChips();
                showEmptyResults();
                drawGraph();
            });
            chip.appendChild(removeBtn);
            selectedChips.appendChild(chip);
        });
    }

    clearSelectionBtn.addEventListener('click', () => {
        selectedWords = [];
        subspace = null;
        renderChips();
        showEmptyResults();
        drawGraph();
    });

    calculateSpanBtn.addEventListener('click', () => {
        if (selectedWords.length === 0) {
            statusBar.textContent = 'Click at least one node first.';
            return;
        }
        subspace = gf2Span(selectedWords);
        originalWords = new Set(selectedWords);
        renderResults(subspace, originalWords);
        drawGraph();
    });

    // =====================================================================
    // Results rendering
    // =====================================================================
    function showEmptyResults() {
        emptyState.classList.remove('hidden');
        resultsBody.classList.add('hidden');
        resultsBody.style.display = 'none';
        emptyState.style.display = 'flex';
    }

    function renderResults(span, original) {
        emptyState.classList.add('hidden');
        emptyState.style.display = 'none';
        resultsBody.classList.remove('hidden');
        resultsBody.style.display = 'flex';

        const k = Math.round(Math.log2(span.size));
        const d = minDistance(span);

        statN.textContent = n;
        statK.textContent = k;
        statSize.textContent = span.size;
        statD.textContent = d === null ? '–' : d;

        codewordList.innerHTML = '';
        Array.from(span).sort((a, b) => a - b).forEach(w => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (original.has(w) ? '' : ' added');
            chip.textContent = toBits(w);
            codewordList.appendChild(chip);
        });

        statusBar.textContent = `Subspace: [${n}, ${k}, ${d === null ? '–' : d}], ${span.size} codewords.`;
    }

    // =====================================================================
    // n input / generate
    // =====================================================================
    generateBtn.addEventListener('click', () => {
        let val = parseInt(nInput.value, 10);
        if (isNaN(val)) val = 4;
        val = Math.max(1, Math.min(6, val));
        nInput.value = val;
        buildHypercube(val);
    });

    // =====================================================================
    // Init
    // =====================================================================
    buildHypercube(n);
});
