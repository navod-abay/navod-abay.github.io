document.addEventListener("DOMContentLoaded", () => {
    // =====================================================================
    // DOM References
    // =====================================================================
    const canvas      = document.getElementById('graphCanvas');
    const ctx         = canvas.getContext('2d');
    const clearBtn    = document.getElementById('clear-btn');
    const calcBtn     = document.getElementById('calc-btn');
    const statusBar   = document.getElementById('editor-status');
    const editorPanel = document.getElementById('editor-panel');
    const resultsPanel = document.getElementById('results-panel');

    // Kirchhoff
    const kirchhoffContent = document.getElementById('kirchhoff-content');
    const treesGrid        = document.getElementById('trees-grid');
    const treeCountBadge   = document.getElementById('tree-count-badge');
    const kirchhoffBottom  = document.getElementById('kirchhoff-bottom');

    // Sachs
    const sachsContent     = document.getElementById('sachs-content');
    const sachsGrid        = document.getElementById('sachs-grid');
    const sachsCountBadge  = document.getElementById('sachs-count-badge');
    const sachsBottom      = document.getElementById('sachs-bottom');

    const tabBtns = document.querySelectorAll('.tab-btn');

    const MAX_NODES   = 9;
    const NODE_RADIUS = 20;
    // Canvas height thresholds
    const CANVAS_MIN_H  = 400;
    const CANVAS_MAX_H  = 700;
    // Node count above which matrices are auto-collapsed
    const COLLAPSE_THRESHOLD = 6;

    let nodes      = [];
    let edges      = [];
    let isDragging = false;
    let dragStartNode = null;
    let mousePos   = { x: 0, y: 0 };
    let activeTab  = 'kirchhoff';

    // =====================================================================
    // Analysis-panel ↔ Canvas height sync (ResizeObserver)
    // =====================================================================
    // We clamp the canvas height to [CANVAS_MIN_H, CANVAS_MAX_H] to match
    // the results panel so the two columns look even.
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

    let currentCanvasH = CANVAS_MIN_H;

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
    // Analysis-panel Tabs
    // =====================================================================
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            document.getElementById(`${activeTab}-content`).classList.add('active');
            kirchhoffBottom.classList.toggle('hidden', activeTab !== 'kirchhoff');
            sachsBottom.classList.toggle('hidden',    activeTab !== 'sachs');
        });
    });

    // =====================================================================
    // Theorem section tabs (bottom)
    // =====================================================================
    document.querySelectorAll('.theorem-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.theorem-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.theorem-content').forEach(tc => tc.classList.remove('active'));
            document.getElementById(btn.dataset.theorem).classList.add('active');
            // Re-typeset the newly visible content
            if (window.MathJax) MathJax.typesetPromise([document.getElementById(btn.dataset.theorem)]).catch(console.error);
        });
    });

    // =====================================================================
    // Mouse helpers
    // =====================================================================
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function getNodeAt(x, y) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const nd = nodes[i];
            const dx = nd.x - x, dy = nd.y - y;
            if (dx*dx + dy*dy <= NODE_RADIUS*NODE_RADIUS) return nd;
        }
        return null;
    }

    // =====================================================================
    // Drawing
    // =====================================================================
    function drawGraph() {
        const W = canvas.width  / (window.devicePixelRatio || 1);
        const H = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        ctx.lineWidth = 3;
        ctx.strokeStyle = '#8b949e';
        edges.forEach(edge => {
            const u = nodes.find(n => n.id === edge.u);
            const v = nodes.find(n => n.id === edge.v);
            if (u && v) {
                ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y); ctx.stroke();
            }
        });

        if (isDragging && dragStartNode) {
            ctx.strokeStyle = 'rgba(88,166,255,0.5)';
            ctx.setLineDash([6,4]); ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(dragStartNode.x, dragStartNode.y);
            ctx.lineTo(mousePos.x, mousePos.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        nodes.forEach((node, idx) => {
            ctx.shadowBlur  = 12;
            ctx.shadowColor = '#1f6feb';
            ctx.beginPath(); ctx.arc(node.x, node.y, NODE_RADIUS, 0, 2*Math.PI);
            ctx.fillStyle = '#161b22'; ctx.fill();
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#58a6ff'; ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#e6edf3';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), node.x, node.y);
        });

        statusBar.textContent = `Nodes: ${nodes.length} / ${MAX_NODES}  |  Edges: ${edges.length}`;
        calcBtn.disabled = nodes.length < 2;
    }

    // =====================================================================
    // Canvas events
    // =====================================================================
    canvas.addEventListener('mousedown', e => {
        const pos = getMousePos(e);
        const hit = getNodeAt(pos.x, pos.y);
        if (hit) {
            isDragging = true; dragStartNode = hit; mousePos = pos;
        } else {
            if (nodes.length >= MAX_NODES) { statusBar.textContent = `Max ${MAX_NODES} nodes reached!`; return; }
            const tooClose = nodes.some(nd => {
                const dx = nd.x - pos.x, dy = nd.y - pos.y;
                return Math.sqrt(dx*dx + dy*dy) < NODE_RADIUS*2.5;
            });
            if (tooClose) { statusBar.textContent = 'Too close to existing node!'; return; }
            nodes.push({ id: nodes.length, x: pos.x, y: pos.y });
            drawGraph();
        }
    });

    canvas.addEventListener('mousemove', e => {
        if (isDragging) { mousePos = getMousePos(e); drawGraph(); }
    });

    canvas.addEventListener('mouseup', e => {
        if (isDragging) {
            const pos  = getMousePos(e);
            const drop = getNodeAt(pos.x, pos.y);
            if (drop && drop !== dragStartNode) {
                const u = dragStartNode.id, v = drop.id;
                const exists = edges.some(ed => (ed.u===u&&ed.v===v)||(ed.u===v&&ed.v===u));
                if (!exists) edges.push({ u, v });
            }
            isDragging = false; dragStartNode = null; drawGraph();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging) { isDragging = false; dragStartNode = null; drawGraph(); }
    });

    // =====================================================================
    // Clear
    // =====================================================================
    clearBtn.addEventListener('click', () => {
        nodes = []; edges = [];
        drawGraph();
        resetResults();
    });

    function resetResults() {
        kirchhoffContent.innerHTML = `
            <div class="empty-state">
                <div class="icon-placeholder">✨</div>
                <p>Construct a graph and click Calculate to see Kirchhoff's Theorem in action.</p>
            </div>`;
        sachsContent.innerHTML = `
            <div class="empty-state">
                <div class="icon-placeholder">∮</div>
                <p>Construct a graph and click Calculate to see Sachs' Theorem in action.</p>
            </div>`;
        treesGrid.innerHTML = '';
        sachsGrid.innerHTML = '';
        treeCountBadge.textContent = '0';
        sachsCountBadge.textContent = '0';
    }

    // =====================================================================
    // CALCULATE
    // =====================================================================
    calcBtn.addEventListener('click', calculateAll);

    function calculateAll() {
        const n = nodes.length;
        if (n < 2) return;
        statusBar.textContent = 'Calculating…';

        const adj = Array.from({length: n}, () => new Array(n).fill(0));
        const deg = new Array(n).fill(0);
        edges.forEach(e => {
            adj[e.u][e.v] = 1; adj[e.v][e.u] = 1;
            deg[e.u]++; deg[e.v]++;
        });

        // --- Kirchhoff ---
        const L    = buildLaplacian(n, adj, deg);
        const R    = L.slice(1).map(row => row.slice(1));
        const kDet = (n === 1) ? 0 : calcDet(R, n-1);
        const trees = enumerateSpanningTrees(n, edges);
        renderKirchhoffAnalysis(L, R, kDet, trees.length, n);
        renderSpanningTrees(trees, n);

        // --- Sachs ---
        const sachs = enumerateSachsSubgraphs(n, edges);
        const sDet  = computeSachsDeterminant(n, sachs);
        renderSachsAnalysis(adj, sachs, sDet, n);
        renderSachsSubgraphs(sachs, n);

        statusBar.textContent = `Done! Kirchhoff: ${trees.length} spanning tree${trees.length!==1?'s':''}. Sachs det(A) = ${sDet}.`;
    }

    // =====================================================================
    // Math utilities
    // =====================================================================
    function buildLaplacian(n, adj, deg) {
        return Array.from({length:n}, (_, i) =>
            Array.from({length:n}, (__, j) => i===j ? deg[i] : adj[i][j] ? -1 : 0)
        );
    }

    function calcDet(matrix, size) {
        if (size === 0) return 0;
        if (size === 1) return matrix[0][0];
        const m = matrix.map(r => [...r]);
        let sign = 1;
        for (let col = 0; col < size; col++) {
            let pivot = col;
            for (let row = col+1; row < size; row++)
                if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
            if (pivot !== col) { [m[col], m[pivot]] = [m[pivot], m[col]]; sign *= -1; }
            if (Math.abs(m[col][col]) < 1e-9) return 0;
            for (let row = col+1; row < size; row++) {
                const f = m[row][col] / m[col][col];
                for (let k = col; k < size; k++) m[row][k] -= f * m[col][k];
            }
        }
        let det = sign;
        for (let i = 0; i < size; i++) det *= m[i][i];
        return Math.round(det);
    }

    function matrixToTex(m) {
        return `\\begin{bmatrix}${m.map(r => r.join('&')).join('\\\\')}\\end{bmatrix}`;
    }

    // =====================================================================
    // Kirchhoff: spanning tree enumeration
    // =====================================================================
    class UnionFind {
        constructor(n) { this.p = Array.from({length:n},(_,i)=>i); this.r = new Array(n).fill(0); }
        find(x) { if (this.p[x]!==x) this.p[x]=this.find(this.p[x]); return this.p[x]; }
        union(a,b) {
            const ra=this.find(a), rb=this.find(b);
            if (ra===rb) return false;
            if (this.r[ra]<this.r[rb]) this.p[ra]=rb;
            else if (this.r[ra]>this.r[rb]) this.p[rb]=ra;
            else { this.p[rb]=ra; this.r[ra]++; }
            return true;
        }
    }

    function enumerateSpanningTrees(n, edgeList) {
        const results = [];
        function bt(idx, tree) {
            if (tree.length === n-1) { results.push([...tree]); return; }
            if (idx >= edgeList.length) return;
            if (edgeList.length - idx < (n-1) - tree.length) return;
            const uf = new UnionFind(n);
            for (const e of tree) uf.union(e.u, e.v);
            if (uf.union(edgeList[idx].u, edgeList[idx].v)) {
                tree.push(edgeList[idx]); bt(idx+1, tree); tree.pop();
            }
            bt(idx+1, tree);
        }
        bt(0, []);
        return results;
    }

    // =====================================================================
    // Sachs: subgraph enumeration
    // =====================================================================
    function enumerateSachsSubgraphs(n, edgeList) {
        const adjList = Array.from({length:n}, () => []);
        edgeList.forEach(e => { adjList[e.u].push(e.v); adjList[e.v].push(e.u); });

        const results = [];
        const matched = new Array(n).fill(false);

        function findFirstUnmatched() {
            for (let i=0;i<n;i++) if (!matched[i]) return i;
            return -1;
        }

        function findSimpleCycles(start) {
            const cycles  = [];
            const visited = new Array(n).fill(false);
            visited[start] = true;

            function dfs(current, path) {
                for (const nb of adjList[current]) {
                    if (nb === start && path.length >= 3) {
                        // Canonical direction: path[1] < path[last]
                        if (path[1] < path[path.length-1]) {
                            cycles.push([...path]);
                        }
                        continue;
                    }
                    if (nb <= start) continue;
                    if (visited[nb] || matched[nb]) continue;
                    visited[nb] = true;
                    path.push(nb);
                    dfs(nb, path);
                    path.pop();
                    visited[nb] = false;
                }
            }
            dfs(start, [start]);
            return cycles;
        }

        function backtrack(edgePairs, cycles) {
            const v = findFirstUnmatched();
            if (v === -1) {
                results.push({
                    edgePairs: edgePairs.map(ep => ({u:ep.u, v:ep.v})),
                    cycles:    cycles.map(c => [...c]),
                    p: edgePairs.length + cycles.length,
                    c: cycles.length,
                });
                return;
            }
            // (a) K₂ edge
            for (const nb of adjList[v]) {
                if (matched[nb]) continue;
                matched[v] = matched[nb] = true;
                edgePairs.push({u:v, v:nb});
                backtrack(edgePairs, cycles);
                edgePairs.pop();
                matched[v] = matched[nb] = false;
            }
            // (b) Cycle through v
            for (const cycle of findSimpleCycles(v)) {
                cycle.forEach(vc => { matched[vc] = true; });
                cycles.push(cycle);
                backtrack(edgePairs, cycles);
                cycles.pop();
                cycle.forEach(vc => { matched[vc] = false; });
            }
        }

        backtrack([], []);
        return results;
    }

    function computeSachsDeterminant(n, sachs) {
        let sum = 0;
        for (const S of sachs) sum += Math.pow(-1, S.p) * Math.pow(2, S.c);
        return Math.round(Math.pow(-1, n) * sum);
    }

    // =====================================================================
    // MathJax helper: clear old math then re-typeset
    // =====================================================================
    function typesetElement(el) {
        if (!window.MathJax) return;
        // Clear MathJax's cached data so it re-processes fresh HTML
        MathJax.typesetClear([el]);
        MathJax.typesetPromise([el]).catch(console.error);
    }

    // =====================================================================
    // RENDER: Kirchhoff analysis
    // =====================================================================
    function renderKirchhoffAnalysis(L, R, det, treeCount, n) {
        const collapse = n >= COLLAPSE_THRESHOLD;

        const wrapMatrix = (title, texBody) => collapse
            ? `<details class="collapsible-matrix animate-fade-in">
                  <summary>${title}</summary>
                  <div class="details-body">
                      <div class="matrix-display">\\[${texBody}\\]</div>
                  </div>
               </details>`
            : `<div class="math-section animate-fade-in">
                  <h3>${title}</h3>
                  <div class="matrix-display">\\[${texBody}\\]</div>
               </div>`;

        kirchhoffContent.innerHTML =
            wrapMatrix('Laplacian Matrix L = D − A', `L = ${matrixToTex(L)}`) +
            wrapMatrix('Reduced Laplacian L₁₁ (row &amp; col 0 removed)', `L_{11} = ${matrixToTex(R)}`) +
            `<div class="determinant-result animate-fade-in" style="animation-delay:.15s">
                <span style="font-size:.95rem; color:var(--text-secondary)">
                    \\(\\det(L_{11})\\) &nbsp;=&nbsp;
                </span>
                <div>
                    <span class="highlight-value">${det}</span>
                    <span style="color:var(--text-secondary); font-size:.88rem; margin-left:.5rem">
                        = ${treeCount} spanning tree${treeCount!==1?'s':''} ✓
                    </span>
                </div>
            </div>`;

        typesetElement(kirchhoffContent);
    }

    // =====================================================================
    // RENDER: Spanning Trees
    // =====================================================================
    function renderSpanningTrees(trees, _n) {
        treeCountBadge.textContent = trees.length;
        treesGrid.innerHTML = '';

        if (trees.length === 0) {
            treesGrid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--text-secondary)">
                No spanning trees found. The graph may be disconnected.</div>`;
            return;
        }

        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        nodes.forEach(n => {
            minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
            maxX=Math.max(maxX,n.x); maxY=Math.max(maxY,n.y);
        });
        const rangeX = maxX-minX || 1, rangeY = maxY-minY || 1;

        trees.forEach((treeEdges, i) => {
            const card = document.createElement('div');
            card.className = 'tree-card animate-fade-in';
            card.style.animationDelay = `${Math.min(0.5, i*0.04)}s`;

            const W=180, H=140, PAD=20;
            const mini = createMiniCanvas(W, H);
            card.appendChild(mini.el);
            const mx = mini.ctx;

            const {miniPos} = computeLayout(W, H, PAD, rangeX, rangeY, minX, minY);

            mx.strokeStyle = 'rgba(139,148,158,0.15)'; mx.lineWidth = 1;
            edges.forEach(e => drawLine(mx, miniPos(nodes.find(n=>n.id===e.u)), miniPos(nodes.find(n=>n.id===e.v))));

            mx.strokeStyle = '#3fb950'; mx.lineWidth = 2.5;
            treeEdges.forEach(e => drawLine(mx, miniPos(nodes.find(n=>n.id===e.u)), miniPos(nodes.find(n=>n.id===e.v))));

            drawNodes(mx, nodes, miniPos, '#58a6ff');

            const lbl = document.createElement('span');
            lbl.textContent = `Tree ${i+1}`;
            card.appendChild(lbl);
            treesGrid.appendChild(card);
        });
    }

    // =====================================================================
    // RENDER: Sachs analysis
    // =====================================================================
    function renderSachsAnalysis(adj, sachs, detA, n) {
        const count    = sachs.length;
        const collapse = n >= COLLAPSE_THRESHOLD;
        const innerSum = sachs.reduce((acc, S) => acc + Math.pow(-1,S.p)*Math.pow(2,S.c), 0);

        // Contribution table (up to 8 rows)
        let tableRows = '';
        const shown = Math.min(count, 8);
        for (let i=0; i<shown; i++) {
            const S    = sachs[i];
            const term = Math.pow(-1,S.p)*Math.pow(2,S.c);
            const sign = term >= 0 ? '+' : '−';
            tableRows += `<tr>
                <td>S${i+1}</td>
                <td>${S.edgePairs.length}&thinsp;K₂, ${S.cycles.length}&thinsp;cycle${S.cycles.length!==1?'s':''}</td>
                <td>${S.p}</td><td>${S.c}</td>
                <td style="color:var(--sachs-color);font-weight:600">${sign}${Math.abs(term)}</td>
            </tr>`;
        }
        if (count > 8) tableRows += `<tr><td colspan="5" style="color:var(--text-secondary);font-style:italic">… and ${count-8} more</td></tr>`;
        tableRows += `<tr>
            <td colspan="4" style="text-align:right">Σ&thinsp;(inner sum)&nbsp;</td>
            <td>${innerSum}</td>
        </tr>`;

        const wrapMatrix = (title, texBody) => collapse
            ? `<details class="collapsible-matrix animate-fade-in">
                  <summary>${title}</summary>
                  <div class="details-body">
                      <div class="matrix-display">\\[${texBody}\\]</div>
                  </div>
               </details>`
            : `<div class="math-section animate-fade-in">
                  <h3>${title}</h3>
                  <div class="matrix-display">\\[${texBody}\\]</div>
               </div>`;

        const wrapTable = (title, body) => collapse
            ? `<details class="collapsible-matrix animate-fade-in">
                  <summary>${title}</summary>
                  <div class="details-body">${body}</div>
               </details>`
            : `<div class="math-section animate-fade-in" style="animation-delay:.15s">
                  <h3>${title}</h3>
                  ${body}
               </div>`;

        sachsContent.innerHTML =
            `<div class="sachs-formula-box animate-fade-in">
                <p>Sachs' Theorem connects the structure of a graph's cycles and matchings to the determinant of its adjacency matrix via:</p>
                <div class="matrix-display" style="margin:.6rem 0">
                    \\[\\det(A) = (-1)^n \\sum_{S \\in \\mathcal{S}_n} (-1)^{p(S)}\\cdot 2^{c(S)}\\]
                </div>
                <p>where \\(\\mathcal{S}_n\\) = all spanning Sachs subgraphs, \\(p(S)\\) = #components, \\(c(S)\\) = #cycle components.</p>
            </div>` +

            wrapMatrix('Adjacency Matrix A', `A = ${matrixToTex(adj)}`) +

            (count > 0 ? wrapTable('Sachs Subgraph Contributions',
                `<table class="sachs-sum-table">
                    <thead><tr><th></th><th>Components</th><th>p(S)</th><th>c(S)</th><th>(−1)ᵖ·2ᶜ</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>`) : '') +

            `<div class="determinant-result animate-fade-in" style="animation-delay:.25s">
                <span style="font-size:.95rem;color:var(--text-secondary)">
                    \\(\\det(A) = (-1)^{${n}} \\cdot (${innerSum})\\) &nbsp;=&nbsp;
                </span>
                <div>
                    <span class="highlight-value sachs">${detA}</span>
                    ${count===0 ? `<span style="color:var(--text-secondary);font-size:.85rem;margin-left:.5rem">(no spanning Sachs subgraphs → det = 0)</span>` : ''}
                </div>
            </div>`;

        typesetElement(sachsContent);
    }

    // =====================================================================
    // RENDER: Sachs Subgraph cards
    // =====================================================================
    function renderSachsSubgraphs(sachs, _n) {
        sachsCountBadge.textContent = sachs.length;
        sachsGrid.innerHTML = '';

        if (sachs.length === 0) {
            sachsGrid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--text-secondary)">
                No spanning Sachs subgraphs found (det(A) = 0).</div>`;
            return;
        }

        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        nodes.forEach(n => {
            minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
            maxX=Math.max(maxX,n.x); maxY=Math.max(maxY,n.y);
        });
        const rangeX=maxX-minX||1, rangeY=maxY-minY||1;

        sachs.forEach((S, i) => {
            const card = document.createElement('div');
            card.className = 'tree-card sachs-card animate-fade-in';
            card.style.animationDelay = `${Math.min(0.5, i*0.05)}s`;

            const W=180, H=140, PAD=22;
            const mini = createMiniCanvas(W, H);
            card.appendChild(mini.el);
            const mx = mini.ctx;

            const {miniPos} = computeLayout(W, H, PAD, rangeX, rangeY, minX, minY);

            // Faint background edges
            mx.strokeStyle = 'rgba(139,148,158,0.12)'; mx.lineWidth = 1;
            edges.forEach(e => drawLine(mx, miniPos(nodes.find(n=>n.id===e.u)), miniPos(nodes.find(n=>n.id===e.v))));

            // K₂ edges (purple)
            mx.strokeStyle = '#a371f7'; mx.lineWidth = 2.5;
            S.edgePairs.forEach(ep => drawLine(mx, miniPos(nodes.find(n=>n.id===ep.u)), miniPos(nodes.find(n=>n.id===ep.v))));

            // Cycle edges (orange-red, glowing)
            S.cycles.forEach(cycle => {
                mx.strokeStyle = '#f78166'; mx.lineWidth = 2.5;
                mx.shadowBlur = 5; mx.shadowColor = 'rgba(247,129,102,0.6)';
                mx.beginPath();
                for (let j=0; j<cycle.length; j++) {
                    const a = miniPos(nodes.find(n=>n.id===cycle[j]));
                    const b = miniPos(nodes.find(n=>n.id===cycle[(j+1)%cycle.length]));
                    mx.moveTo(a.x,a.y); mx.lineTo(b.x,b.y);
                }
                mx.stroke();
                mx.shadowBlur = 0;
            });

            drawNodes(mx, nodes, miniPos, '#58a6ff');

            // Labels
            const lbl = document.createElement('span');
            lbl.textContent = `S${i+1}: p=${S.p}, c=${S.c}`;
            card.appendChild(lbl);

            const contrib = Math.pow(-1,S.p)*Math.pow(2,S.c);
            const cEl = document.createElement('span');
            cEl.className = 'sachs-contribution';
            cEl.textContent = `(−1)${supNum(S.p)} · 2${supNum(S.c)} = ${contrib>0?'+':''}${contrib}`;
            card.appendChild(cEl);

            const tags = document.createElement('div');
            tags.className = 'sachs-types';
            if (S.edgePairs.length > 0) {
                const t = document.createElement('span');
                t.className = 'sachs-type-tag edge';
                t.textContent = `${S.edgePairs.length} K₂`;
                tags.appendChild(t);
            }
            if (S.cycles.length > 0) {
                const t = document.createElement('span');
                t.className = 'sachs-type-tag cycle';
                t.textContent = `${S.cycles.length} cycle${S.cycles.length>1?'s':''}`;
                tags.appendChild(t);
            }
            card.appendChild(tags);
            sachsGrid.appendChild(card);
        });
    }

    // =====================================================================
    // Drawing utility helpers
    // =====================================================================
    function createMiniCanvas(W, H) {
        const dpr = window.devicePixelRatio || 1;
        const el  = document.createElement('canvas');
        el.style.width  = W + 'px';
        el.style.height = H + 'px';
        el.width  = W * dpr;
        el.height = H * dpr;
        const mxCtx = el.getContext('2d');
        mxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { el, ctx: mxCtx };
    }

    function computeLayout(W, H, PAD, rangeX, rangeY, minX, minY) {
        const scaleX = (W - PAD*2) / rangeX;
        const scaleY = (H - PAD*2) / rangeY;
        const scale  = Math.min(scaleX, scaleY);
        const offX   = PAD + ((W - PAD*2) - rangeX*scale) / 2;
        const offY   = PAD + ((H - PAD*2) - rangeY*scale) / 2;
        const miniPos = nd => ({ x: offX + (nd.x - minX)*scale, y: offY + (nd.y - minY)*scale });
        return { scale, miniPos };
    }

    function drawLine(cx, a, b) {
        cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
    }

    function drawNodes(cx, nodeList, miniPos, strokeColor) {
        nodeList.forEach(nd => {
            const p = miniPos(nd);
            cx.beginPath(); cx.arc(p.x, p.y, 6, 0, 2*Math.PI);
            cx.fillStyle = '#161b22'; cx.fill();
            cx.lineWidth = 1.5; cx.strokeStyle = strokeColor; cx.stroke();
        });
    }

    function supNum(n) {
        const sups = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
        return String(n).split('').map(c => sups[c]||c).join('');
    }
});
