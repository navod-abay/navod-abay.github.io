document.addEventListener("DOMContentLoaded", () => {
    // =====================================================================
    // DOM References
    // =====================================================================
    const canvas       = document.getElementById('hypergraphCanvas');
    const ctx          = canvas.getContext('2d');
    const statusBar    = document.getElementById('editor-status');
    const resultsPanel = document.getElementById('results-panel');

    const randomBtn        = document.getElementById('random-btn');
    const dropdownToggle    = document.getElementById('random-dropdown-toggle');
    const dropdownMenu      = document.getElementById('random-dropdown-menu');
    const randomSameNodesBtn      = document.getElementById('random-same-nodes');
    const randomSameNodesEdgesBtn = document.getElementById('random-same-nodes-edges');

    const addHyperedgeBtn   = document.getElementById('add-hyperedge-btn');
    const clearSelectionBtn = document.getElementById('clear-selection-btn');
    const clearAllBtn       = document.getElementById('clear-all-btn');

    const edgeCountBadge = document.getElementById('edge-count-badge');
    const hyperedgeList  = document.getElementById('hyperedge-list');
    const degreeList     = document.getElementById('degree-list');
    const incidenceSection = document.getElementById('incidence-section');
    const operatorsSection = document.getElementById('operators-section');
    const spectralMatrixSelect = document.getElementById('spectral-matrix-select');
    const spectralSection = document.getElementById('spectral-section');
    const signalRows = document.getElementById('signal-rows');
    const filterGainRows = document.getElementById('filter-gain-rows');
    const filterResult = document.getElementById('filter-result');

    const MAX_NODES   = 15;
    const NODE_RADIUS = 16;
    const CANVAS_MIN_H = 400;
    const CANVAS_MAX_H = 700;
    const COLLAPSE_THRESHOLD = 8;

    const PALETTE = ['#58a6ff', '#a371f7', '#f78166', '#3fb950', '#e3b341', '#db61a2', '#39c5cf', '#ff7b72'];

    let nodes = [];            // { id, x, y, signal }
    let hyperedges = [];       // { id, nodeIds: [...], color, weight }
    let selectedForEdge = [];  // node ids currently selected to form a new hyperedge
    let nodeIdCounter = 0;
    let edgeIdCounter = 0;
    let currentOperators = null; // cached { Dv, De, W, A, L, Theta, Lnorm, S } from the last computeOperators()
    let filterGains = [];         // one gain per eigenvalue slot (ascending order), length === nodes.length

    // =====================================================================
    // Canvas sizing (panel <-> canvas height sync, same pattern as other pages)
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
    applyCanvasSize();

    // =====================================================================
    // Matrix utilities (dense arrays) — foundation for upcoming hypergraph
    // signal-processing operators (Laplacians, shift operators, filters).
    // =====================================================================
    function matMul(A, B) {
        const rowsA = A.length, colsA = A.length ? A[0].length : 0;
        const rowsB = B.length, colsB = B.length ? B[0].length : 0;
        if (colsA !== rowsB) throw new Error('matMul: dimension mismatch');
        const result = Array.from({ length: rowsA }, () => new Array(colsB).fill(0));
        for (let i = 0; i < rowsA; i++) {
            for (let k = 0; k < colsA; k++) {
                const a = A[i][k];
                if (a === 0) continue;
                for (let j = 0; j < colsB; j++) result[i][j] += a * B[k][j];
            }
        }
        return result;
    }

    function transpose(A) {
        if (A.length === 0) return [];
        return A[0].map((_, j) => A.map(row => row[j]));
    }

    function identity(size) {
        return Array.from({ length: size }, (_, i) =>
            Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))
        );
    }

    function diag(vec) {
        return vec.map((v, i) => vec.map((_, j) => (i === j ? v : 0)));
    }

    function subtract(A, B) {
        return A.map((row, i) => row.map((v, j) => v - B[i][j]));
    }

    function matVec(M, v) {
        return M.map(row => row.reduce((s, x, j) => s + x * v[j], 0));
    }

    // General matrix inverse via Gauss-Jordan elimination with partial
    // pivoting. Used to invert the eigenvector matrix V for the graph
    // Fourier transform — V is orthogonal for the symmetric operators (L,
    // normalized Laplacian), but not necessarily for the shift operator's
    // rescaled eigenvectors, so we don't assume V^{-1} = V^T.
    function invertMatrix(matrix) {
        const n = matrix.length;
        const M = matrix.map((row, i) => [...row, ...identity(n)[i]]);
        for (let col = 0; col < n; col++) {
            let pivotRow = col;
            for (let r = col + 1; r < n; r++) {
                if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
            }
            if (Math.abs(M[pivotRow][col]) < 1e-10) continue; // near-singular column, skip
            [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
            const pivotVal = M[col][col];
            for (let k = 0; k < 2 * n; k++) M[col][k] /= pivotVal;
            for (let r = 0; r < n; r++) {
                if (r === col) continue;
                const factor = M[r][col];
                if (factor === 0) continue;
                for (let k = 0; k < 2 * n; k++) M[r][k] -= factor * M[col][k];
            }
        }
        return M.map(row => row.slice(n));
    }

    // Elementwise reciprocal of a vector meant as diagonal entries; 0 stays 0
    // (pseudo-inverse convention for isolated vertices / degenerate degrees).
    function diagInv(vec) {
        return vec.map(v => (v > 0 ? 1 / v : 0));
    }

    function diagInvSqrt(vec) {
        return vec.map(v => (v > 0 ? 1 / Math.sqrt(v) : 0));
    }

    // Round to avoid noisy floating-point tails in the rendered LaTeX.
    function fmt(x) {
        const r = Math.round(x * 1000) / 1000;
        return Object.is(r, -0) ? 0 : r;
    }
    function roundMatrix(m) { return m.map(row => row.map(fmt)); }
    function roundVector(v) { return v.map(fmt); }

    // Cyclic Jacobi eigenvalue algorithm for real symmetric matrices — fine
    // at n <= 15. Returns { values: [asc...], vectors: [v1, v2, ...] } where
    // vectors[i] (a plain array) is the eigenvector for values[i], unit norm.
    function jacobiEigen(matrix, maxSweeps = 100, tol = 1e-10) {
        const n = matrix.length;
        if (n === 0) return { values: [], vectors: [] };
        const A = matrix.map(row => row.slice());
        let V = identity(n);

        for (let sweep = 0; sweep < maxSweeps; sweep++) {
            let offDiagSum = 0;
            for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) offDiagSum += A[i][j] * A[i][j];
            if (offDiagSum < tol) break;

            for (let p = 0; p < n - 1; p++) {
                for (let q = p + 1; q < n; q++) {
                    if (Math.abs(A[p][q]) < 1e-14) continue;
                    const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
                    const t = theta === 0 ? 1 : Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                    const c = 1 / Math.sqrt(t * t + 1);
                    const s = t * c;

                    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
                    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
                    A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
                    A[p][q] = 0; A[q][p] = 0;

                    for (let i = 0; i < n; i++) {
                        if (i === p || i === q) continue;
                        const aip = A[i][p], aiq = A[i][q];
                        A[i][p] = A[p][i] = c * aip - s * aiq;
                        A[i][q] = A[q][i] = s * aip + c * aiq;
                    }
                    for (let i = 0; i < n; i++) {
                        const vip = V[i][p], viq = V[i][q];
                        V[i][p] = c * vip - s * viq;
                        V[i][q] = s * vip + c * viq;
                    }
                }
            }
        }

        const pairs = Array.from({ length: n }, (_, i) => ({
            value: A[i][i],
            vector: V.map(row => row[i]),
        }));
        pairs.sort((a, b) => a.value - b.value);
        return { values: pairs.map(p => p.value), vectors: pairs.map(p => p.vector) };
    }

    // n x m incidence matrix: H[i][j] = 1 iff nodes[i] belongs to hyperedges[j]
    function buildIncidenceMatrix() {
        return nodes.map(nd =>
            hyperedges.map(he => (he.nodeIds.includes(nd.id) ? 1 : 0))
        );
    }

    function nodeDegrees(H) {
        return H.map(row => row.reduce((a, b) => a + b, 0));
    }

    function edgeCardinalities(H) {
        if (H.length === 0) return hyperedges.map(he => he.nodeIds.length);
        return H[0].map((_, j) => H.reduce((sum, row) => sum + row[j], 0));
    }

    // Weighted vertex degree: D_v(i,i) = sum over hyperedges e containing i of w(e).
    function weightedVertexDegrees(H) {
        const weights = hyperedges.map(he => he.weight);
        return H.map(row => row.reduce((sum, h, j) => sum + h * weights[j], 0));
    }

    function matrixToTex(m) {
        if (m.length === 0) return '\\begin{bmatrix}\\end{bmatrix}';
        return `\\begin{bmatrix}${m.map(r => r.join('&')).join('\\\\')}\\end{bmatrix}`;
    }

    function vectorToTex(v) {
        return `\\begin{bmatrix}${v.join('&')}\\end{bmatrix}`;
    }

    // =====================================================================
    // Random hypergraph generation
    // =====================================================================
    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function shuffledIndices(count) {
        const arr = Array.from({ length: count }, (_, i) => i);
        for (let i = arr.length - 1; i > 0; i--) {
            const j = randomInt(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function layoutCircle(count) {
        nodes = [];
        nodeIdCounter = 0;
        const W = 600, H = 480;
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) * 0.38;
        for (let i = 0; i < count; i++) {
            const theta = (i * 2 * Math.PI / count) - Math.PI / 2;
            nodes.push({ id: nodeIdCounter++, x: cx + R * Math.cos(theta), y: cy + R * Math.sin(theta), signal: 1 });
        }
    }

    function generateRandomHyperedges(edgeCount) {
        hyperedges = [];
        edgeIdCounter = 0;
        const n = nodes.length;
        if (n < 2) return;
        const maxSize = Math.min(4, n);
        for (let i = 0; i < edgeCount; i++) {
            const size = randomInt(2, maxSize);
            const picked = shuffledIndices(n).slice(0, size).map(idx => nodes[idx].id);
            hyperedges.push({ id: edgeIdCounter++, nodeIds: picked, color: PALETTE[hyperedges.length % PALETTE.length], weight: 1 });
        }
    }

    function randomHypergraphFull() {
        const count = randomInt(5, MAX_NODES);
        layoutCircle(count);
        const edgeCount = randomInt(Math.ceil(count / 2), count);
        generateRandomHyperedges(edgeCount);
        selectedForEdge = [];
        afterMutation(`Generated a random hypergraph: ${count} nodes, ${hyperedges.length} hyperedges.`);
    }

    function randomHypergraphSameNodes() {
        if (nodes.length === 0) { statusBar.textContent = 'Add nodes first.'; return; }
        const edgeCount = randomInt(Math.ceil(nodes.length / 2), nodes.length);
        generateRandomHyperedges(edgeCount);
        selectedForEdge = [];
        afterMutation(`Randomized hyperedges: ${nodes.length} nodes (unchanged), ${hyperedges.length} hyperedges.`);
    }

    function randomHypergraphSameNodesAndEdges() {
        if (nodes.length === 0) { statusBar.textContent = 'Add nodes first.'; return; }
        if (hyperedges.length === 0) { statusBar.textContent = 'Add hyperedges first, or use "Random" instead.'; return; }
        const edgeCount = hyperedges.length;
        generateRandomHyperedges(edgeCount);
        selectedForEdge = [];
        afterMutation(`Randomized hyperedges: ${nodes.length} nodes and ${hyperedges.length} hyperedges (both unchanged).`);
    }

    randomBtn.addEventListener('click', randomHypergraphFull);
    randomSameNodesBtn.addEventListener('click', () => { closeDropdown(); randomHypergraphSameNodes(); });
    randomSameNodesEdgesBtn.addEventListener('click', () => { closeDropdown(); randomHypergraphSameNodesAndEdges(); });

    // =====================================================================
    // Dropdown menu
    // =====================================================================
    function closeDropdown() {
        dropdownMenu.classList.remove('open');
        dropdownToggle.setAttribute('aria-expanded', 'false');
    }
    dropdownToggle.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdownMenu.classList.toggle('open');
        dropdownToggle.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', e => {
        if (!dropdownMenu.contains(e.target) && e.target !== dropdownToggle) closeDropdown();
    });

    // =====================================================================
    // Canvas interaction: click empty space = add node, click node = toggle
    // selection, double-click node = delete it.
    // =====================================================================
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function getNodeAt(x, y) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const nd = nodes[i];
            const dx = nd.x - x, dy = nd.y - y;
            if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return nd;
        }
        return null;
    }

    canvas.addEventListener('click', e => {
        const pos = getMousePos(e);
        const hit = getNodeAt(pos.x, pos.y);
        if (hit) {
            const idx = selectedForEdge.indexOf(hit.id);
            if (idx >= 0) selectedForEdge.splice(idx, 1);
            else selectedForEdge.push(hit.id);
            drawGraph();
            return;
        }
        if (nodes.length >= MAX_NODES) {
            statusBar.textContent = `Max ${MAX_NODES} nodes reached!`;
            return;
        }
        const tooClose = nodes.some(nd => {
            const dx = nd.x - pos.x, dy = nd.y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS * 2.2;
        });
        if (tooClose) { statusBar.textContent = 'Too close to existing node!'; return; }
        nodes.push({ id: nodeIdCounter++, x: pos.x, y: pos.y, signal: 1 });
        afterMutation(`Nodes: ${nodes.length} / ${MAX_NODES}  |  Hyperedges: ${hyperedges.length}`);
    });

    canvas.addEventListener('dblclick', e => {
        const pos = getMousePos(e);
        const hit = getNodeAt(pos.x, pos.y);
        if (!hit) return;
        nodes = nodes.filter(nd => nd.id !== hit.id);
        hyperedges = hyperedges
            .map(he => ({ ...he, nodeIds: he.nodeIds.filter(id => id !== hit.id) }))
            .filter(he => he.nodeIds.length >= 2);
        selectedForEdge = selectedForEdge.filter(id => id !== hit.id);
        afterMutation(`Deleted node. Nodes: ${nodes.length} / ${MAX_NODES}  |  Hyperedges: ${hyperedges.length}`);
    });

    // =====================================================================
    // Hyperedge / selection controls
    // =====================================================================
    addHyperedgeBtn.addEventListener('click', () => {
        if (selectedForEdge.length < 2) {
            statusBar.textContent = 'Select at least 2 nodes to form a hyperedge.';
            return;
        }
        hyperedges.push({
            id: edgeIdCounter++,
            nodeIds: [...selectedForEdge],
            color: PALETTE[hyperedges.length % PALETTE.length],
            weight: 1,
        });
        selectedForEdge = [];
        afterMutation(`Added hyperedge. Nodes: ${nodes.length} / ${MAX_NODES}  |  Hyperedges: ${hyperedges.length}`);
    });

    clearSelectionBtn.addEventListener('click', () => {
        selectedForEdge = [];
        drawGraph();
    });

    clearAllBtn.addEventListener('click', () => {
        nodes = [];
        hyperedges = [];
        selectedForEdge = [];
        nodeIdCounter = 0;
        edgeIdCounter = 0;
        afterMutation('Cleared. Click the canvas to add nodes.');
    });

    function afterMutation(message) {
        statusBar.textContent = message;
        renderHyperedgeList();
        renderSignalRows();
        renderDegrees();
        renderIncidenceMatrix();
        recomputeMath();
        drawGraph();
    }

    // =====================================================================
    // Drawing
    // =====================================================================
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function convexHull(pts) {
        if (pts.length < 3) return pts.slice();
        const points = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (const p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        return lower.concat(upper);
    }

    function expandOutward(hull, dist) {
        if (hull.length === 0) return hull;
        const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
        const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
        return hull.map(p => {
            const dx = p.x - cx, dy = p.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
        });
    }

    function drawHyperedge(he) {
        const pts = he.nodeIds.map(id => nodes.find(nd => nd.id === id)).filter(Boolean);
        if (pts.length < 2) return;
        const pad = NODE_RADIUS + 14;

        if (pts.length === 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            ctx.lineCap = 'round';
            ctx.lineWidth = pad * 1.1;
            ctx.strokeStyle = hexToRgba(he.color, 0.22);
            ctx.stroke();
            ctx.lineWidth = 2;
            ctx.strokeStyle = hexToRgba(he.color, 0.8);
            ctx.stroke();
            ctx.lineCap = 'butt';
            return;
        }

        const hull = expandOutward(convexHull(pts), pad);
        ctx.beginPath();
        ctx.moveTo(hull[0].x, hull[0].y);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(he.color, 0.16);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = hexToRgba(he.color, 0.75);
        ctx.stroke();
    }

    function drawGraph() {
        const W = canvas.width / (window.devicePixelRatio || 1);
        const H = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        hyperedges.forEach(drawHyperedge);

        const selectedSet = new Set(selectedForEdge);
        nodes.forEach((node, idx) => {
            const isSelected = selectedSet.has(node.id);
            ctx.shadowBlur = 10;
            ctx.shadowColor = isSelected ? '#e3b341' : '#1f6feb';
            ctx.beginPath(); ctx.arc(node.x, node.y, NODE_RADIUS, 0, 2 * Math.PI);
            ctx.fillStyle = '#161b22'; ctx.fill();
            ctx.lineWidth = isSelected ? 3 : 2.5;
            ctx.strokeStyle = isSelected ? '#e3b341' : '#58a6ff';
            if (isSelected) ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#e6edf3';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), node.x, node.y);
        });

        edgeCountBadge.textContent = `${hyperedges.length} edge${hyperedges.length !== 1 ? 's' : ''}`;
    }

    // =====================================================================
    // Results rendering
    // =====================================================================
    function renderHyperedgeList() {
        if (hyperedges.length === 0) {
            hyperedgeList.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem;">No hyperedges yet — select 2+ nodes and click "Add Hyperedge".</p>';
            return;
        }
        hyperedgeList.innerHTML = '';
        hyperedges.forEach(he => {
            const row = document.createElement('div');
            row.className = 'hyperedge-row';
            const labels = he.nodeIds
                .map(id => nodes.findIndex(nd => nd.id === id) + 1)
                .sort((a, b) => a - b)
                .join(', ');
            row.innerHTML = `
                <div class="hyperedge-swatch" style="background:${he.color}"></div>
                <div class="hyperedge-members">{ ${labels} }</div>
            `;

            const weightInput = document.createElement('input');
            weightInput.type = 'number';
            weightInput.min = '0';
            weightInput.step = '0.1';
            weightInput.value = he.weight;
            weightInput.title = 'Hyperedge weight w(e)';
            weightInput.addEventListener('input', () => {
                const v = parseFloat(weightInput.value);
                he.weight = Number.isFinite(v) && v >= 0 ? v : 0;
                recomputeMath();
            });
            row.appendChild(weightInput);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'row-remove-btn';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                hyperedges = hyperedges.filter(x => x.id !== he.id);
                afterMutation(`Removed hyperedge. Hyperedges: ${hyperedges.length}`);
            });
            row.appendChild(removeBtn);
            hyperedgeList.appendChild(row);
        });
    }

    function renderDegrees() {
        const H = buildIncidenceMatrix();
        const degrees = nodeDegrees(H);
        degreeList.innerHTML = '';
        if (nodes.length === 0) {
            degreeList.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem;">No nodes yet.</p>';
            return;
        }
        nodes.forEach((nd, idx) => {
            const chip = document.createElement('div');
            chip.className = 'degree-chip';
            chip.textContent = `v${idx + 1}: ${degrees[idx]}`;
            degreeList.appendChild(chip);
        });
    }

    function typesetElement(el) {
        if (!window.MathJax) return;
        MathJax.typesetClear([el]);
        MathJax.typesetPromise([el]).catch(console.error);
    }

    function renderIncidenceMatrix() {
        if (nodes.length === 0 || hyperedges.length === 0) {
            incidenceSection.innerHTML = `
                <div class="math-section">
                    <h3>Incidence Matrix H (n × m)</h3>
                    <p style="color:var(--text-secondary); font-size:0.85rem;">Add nodes and at least one hyperedge to see the incidence matrix.</p>
                </div>`;
            return;
        }

        const H = buildIncidenceMatrix();
        const degrees = nodeDegrees(H);
        const cardinalities = edgeCardinalities(H);
        const collapse = nodes.length >= COLLAPSE_THRESHOLD || hyperedges.length >= COLLAPSE_THRESHOLD;

        const body = `
            <div class="matrix-display">\\[H = ${matrixToTex(H)}\\]</div>
            <div class="matrix-display" style="margin-top:0.75rem">\\[\\deg(v) = ${vectorToTex(degrees)}^T \\qquad |e| = ${vectorToTex(cardinalities)}\\]</div>
        `;

        incidenceSection.innerHTML = collapse
            ? `<details class="collapsible-matrix">
                  <summary>Incidence Matrix H (${nodes.length} × ${hyperedges.length})</summary>
                  <div class="details-body">${body}</div>
               </details>`
            : `<div class="math-section">
                  <h3>Incidence Matrix H (${nodes.length} × ${hyperedges.length})</h3>
                  ${body}
               </div>`;

        typesetElement(incidenceSection);
    }

    // =====================================================================
    // Hypergraph signal-processing operators (real-time, driven by
    // nodes/hyperedges/weights) — combinatorial Laplacian, normalized
    // Laplacian, and the random-walk shift operator.
    // =====================================================================
    function computeOperators() {
        if (nodes.length === 0 || hyperedges.length === 0) return null;

        const H  = buildIncidenceMatrix();
        const Ht = transpose(H);
        const Dv = weightedVertexDegrees(H);
        const De = edgeCardinalities(H);
        const W  = diag(hyperedges.map(he => he.weight));
        const DeInv = diag(diagInv(De));

        // A = H W D_e^{-1} H^T — the weighted adjacency-like term shared by all three operators.
        const A = matMul(matMul(matMul(H, W), DeInv), Ht);

        const L = subtract(diag(Dv), A);

        const DvInvSqrt = diag(diagInvSqrt(Dv));
        const Theta = matMul(matMul(DvInvSqrt, A), DvInvSqrt);
        const Lnorm = subtract(identity(nodes.length), Theta);

        const DvInv = diag(diagInv(Dv));
        const S = matMul(DvInv, A);

        return { Dv, De, W, A, L, Theta, Lnorm, S, DvInvSqrt };
    }

    function renderOperatorMatrices(ops) {
        if (!ops) {
            operatorsSection.innerHTML = `
                <div class="math-section">
                    <h3>Hypergraph Operators</h3>
                    <p style="color:var(--text-secondary); font-size:0.85rem;">Add nodes and at least one hyperedge to compute the Laplacian and shift operator.</p>
                </div>`;
            return;
        }

        const collapse = nodes.length >= COLLAPSE_THRESHOLD;
        const wrapMatrix = (title, tex) => collapse
            ? `<details class="collapsible-matrix">
                  <summary>${title}</summary>
                  <div class="details-body"><div class="matrix-display">\\[${tex}\\]</div></div>
               </details>`
            : `<div class="math-section">
                  <h3>${title}</h3>
                  <div class="matrix-display">\\[${tex}\\]</div>
               </div>`;

        operatorsSection.innerHTML =
            wrapMatrix('Hypergraph Laplacian L = D_v − H W D_e⁻¹ Hᵀ', `L = ${matrixToTex(roundMatrix(ops.L))}`) +
            wrapMatrix('Normalized Hypergraph Laplacian Δ = I − Θ', `\\Delta = ${matrixToTex(roundMatrix(ops.Lnorm))}`) +
            wrapMatrix('Hypergraph Shift Operator S = D_v⁻¹ H W D_e⁻¹ Hᵀ', `S = ${matrixToTex(roundMatrix(ops.S))}`);

        typesetElement(operatorsSection);
    }

    // =====================================================================
    // Spectral properties (eigenvalues/eigenvectors of the selected operator)
    // =====================================================================
    function computeSpectral(ops) {
        if (!ops) return null;
        const choice = spectralMatrixSelect.value;
        let values, vectors, symbol;

        if (choice === 'laplacian') {
            ({ values, vectors } = jacobiEigen(ops.L));
            symbol = 'L';
        } else if (choice === 'normalized') {
            ({ values, vectors } = jacobiEigen(ops.Lnorm));
            symbol = '\\Delta';
        } else {
            // S = D_v^{-1/2} Theta D_v^{1/2} (similarity transform), so S and
            // Theta share eigenvalues; S's eigenvectors are D_v^{-1/2} times
            // Theta's (renormalized to unit length).
            const eig = jacobiEigen(ops.Theta);
            values = eig.values;
            const dvInvSqrtDiag = ops.DvInvSqrt.map((row, i) => row[i]);
            vectors = eig.vectors.map(vec => {
                const scaled = vec.map((v, i) => v * dvInvSqrtDiag[i]);
                const norm = Math.sqrt(scaled.reduce((s, v) => s + v * v, 0)) || 1;
                return scaled.map(v => v / norm);
            });
            symbol = 'S';
        }

        return { values, vectors, symbol };
    }

    function renderSpectral(ops) {
        const spectral = computeSpectral(ops);
        if (!spectral) {
            spectralSection.innerHTML = `<p style="color:var(--text-secondary); font-size:0.85rem;">Add nodes and at least one hyperedge to see spectral properties.</p>`;
            renderFilterPanel(null);
            return;
        }

        const { values, vectors, symbol } = spectral;
        const n = values.length;
        const collapse = n >= COLLAPSE_THRESHOLD;

        const eigenvalueChips = values
            .map((v, i) => `<div class="eigenvalue-chip">λ${i + 1} = ${fmt(v)}</div>`)
            .join('');

        // Columns of the display matrix are the eigenvectors, ordered by increasing eigenvalue.
        const eigenvectorMatrix = Array.from({ length: n }, (_, row) =>
            vectors.map(vec => fmt(vec[row]))
        );

        const vectorBody = `
            <div class="matrix-display">\\[V = ${matrixToTex(eigenvectorMatrix)}\\]</div>
            <p style="color:var(--text-secondary); font-size:0.78rem; margin-top:0.5rem;">Columns are unit eigenvectors of ${symbol}, ordered by increasing eigenvalue.</p>
        `;

        const vectorSection = collapse
            ? `<details class="collapsible-matrix">
                  <summary>Eigenvectors of ${symbol}</summary>
                  <div class="details-body">${vectorBody}</div>
               </details>`
            : `<div class="math-section">
                  <h3>Eigenvectors of ${symbol}</h3>
                  ${vectorBody}
               </div>`;

        spectralSection.innerHTML = `
            <div class="math-section">
                <h3>Eigenvalues of ${symbol}</h3>
                <div class="eigenvalue-list">${eigenvalueChips}</div>
            </div>
            ${vectorSection}
        `;

        typesetElement(spectralSection);
        renderFilterPanel(spectral);
    }

    spectralMatrixSelect.addEventListener('change', () => renderSpectral(currentOperators));

    function recomputeMath() {
        currentOperators = computeOperators();
        renderOperatorMatrices(currentOperators);
        renderSpectral(currentOperators);
    }

    // =====================================================================
    // Node-domain signal input (feeds the spectral filter below)
    // =====================================================================
    function renderSignalRows() {
        if (nodes.length === 0) {
            signalRows.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem;">No nodes yet.</p>';
            return;
        }
        signalRows.innerHTML = '';
        nodes.forEach((nd, idx) => {
            const row = document.createElement('div');
            row.className = 'weight-row';

            const label = document.createElement('div');
            label.className = 'weight-label';
            label.innerHTML = `<span>x(v${idx + 1})</span>`;

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.value = nd.signal;
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                nd.signal = Number.isFinite(v) ? v : 0;
                renderFilterResult(computeSpectral(currentOperators));
            });

            row.appendChild(label);
            row.appendChild(input);
            signalRows.appendChild(row);
        });
    }

    // =====================================================================
    // Spectral filter: user-specified gain per eigenvalue, applied via
    // x' = V diag(g) V^{-1} x (graph Fourier transform -> filter -> inverse).
    // =====================================================================
    function ensureFilterGains(n) {
        if (filterGains.length === n) return;
        const next = new Array(n).fill(1);
        for (let i = 0; i < Math.min(n, filterGains.length); i++) next[i] = filterGains[i];
        filterGains = next;
    }

    function renderFilterPanel(spectral) {
        if (!spectral || nodes.length === 0) {
            filterGainRows.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem;">Add nodes and hyperedges first.</p>';
            filterResult.innerHTML = '';
            return;
        }

        ensureFilterGains(spectral.values.length);
        filterGainRows.innerHTML = '';
        spectral.values.forEach((lambda, i) => {
            const row = document.createElement('div');
            row.className = 'weight-row';

            const label = document.createElement('div');
            label.className = 'weight-label';
            label.innerHTML = `<span>g(λ${i + 1} = ${fmt(lambda)})</span>`;

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.value = filterGains[i];
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                filterGains[i] = Number.isFinite(v) ? v : 0;
                renderFilterResult(spectral);
            });

            row.appendChild(label);
            row.appendChild(input);
            filterGainRows.appendChild(row);
        });

        renderFilterResult(spectral);
    }

    function renderFilterResult(spectral) {
        if (!spectral || nodes.length === 0) { filterResult.innerHTML = ''; return; }

        const n = nodes.length;
        ensureFilterGains(n);

        // V's columns are the eigenvectors (ascending eigenvalue order).
        const V = Array.from({ length: n }, (_, row) => spectral.vectors.map(vec => vec[row]));
        const Vinv = invertMatrix(V);

        const x = nodes.map(nd => nd.signal);
        const xHat = matVec(Vinv, x);
        const xHatFiltered = xHat.map((v, i) => v * filterGains[i]);
        const xFiltered = matVec(V, xHatFiltered);

        filterResult.innerHTML = `
            <div class="math-section">
                <h3>Filtered Signal</h3>
                <div class="matrix-display">\\[\\hat{x} = V^{-1}x = ${vectorToTex(roundVector(xHat))}^T\\]</div>
                <div class="matrix-display" style="margin-top:0.6rem">\\[\\hat{x}' = g \\odot \\hat{x} = ${vectorToTex(roundVector(xHatFiltered))}^T\\]</div>
                <div class="matrix-display" style="margin-top:0.6rem">\\[x' = V\\hat{x}' = ${vectorToTex(roundVector(xFiltered))}^T\\]</div>
            </div>
        `;
        typesetElement(filterResult);
    }

    // =====================================================================
    // Init
    // =====================================================================
    afterMutation('Click the canvas to add nodes (max 15).');
});
