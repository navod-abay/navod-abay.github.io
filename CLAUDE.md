# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, multi-page web app with three independent graph-theory visualizers sharing one design system (`style.css`). No build step, no package manager, no dependencies beyond CDN-loaded MathJax and Google Fonts.

Pages:
- **`index.html` / `app.js`** — visualizes Kirchhoff's Matrix Tree Theorem (spanning tree counting via the Laplacian) and Sachs' Theorem (adjacency matrix determinant via cycle/matching decomposition) on a user-drawn graph.
- **`hamming.html` / `app-hamming.js`** — visualizes binary codewords of length `n` (1–6) as the hypercube graph `Q_n` (nodes = bitstrings, edges = Hamming distance 1), with linear-subspace (binary code) highlighting and its orthogonal complement (dual code).
- **`hypergraph.html` / `app-hypergraph.js`** — an interactive hypergraph editor (up to 15 nodes, arbitrary-size hyperedges) with random-hypergraph generation and a live incidence matrix / degree display, laying the groundwork for hypergraph signal-processing operators built on top of the incidence matrix.

Each page is a fully self-contained single `DOMContentLoaded` closure with its own JS file; they share only `style.css` and CSS custom properties. There's a `.site-nav` in each page's header linking to the others. `sitemap.xml` lists all pages — add a new `<url>` entry there for any new page.

## Running locally

No build/install step. Serve the directory and open in a browser:

```bash
python3 -m http.server 8080
# visit http://localhost:8080/index.html or /hamming.html
```

There is no test suite, linter, or bundler configured in this repo.

## Architecture (app.js — Kirchhoff/Sachs page)

Organized into clearly commented sections (search for `// ====` banners to navigate):

1. **Canvas graph editor** — mutable `nodes`/`edges` arrays hold user-authored graph state. Click on the canvas to add a node (max 9, enforced by `MAX_NODES`), drag from one node to another to add an edge. `drawGraph()` is the single render function for the main canvas, called after every mutation.
2. **Panel/canvas height sync** — a `ResizeObserver` on `resultsPanel` clamps and mirrors the canvas height so the two columns stay visually even.
3. **Math core**:
   - `buildLaplacian` / `calcDet` (Gaussian elimination with partial pivoting) compute the Laplacian and its cofactor determinant for Kirchhoff.
   - `enumerateSpanningTrees` uses union-find + backtracking over the edge list to enumerate all spanning trees explicitly (exponential — fine at 9-node scale, not beyond).
   - `enumerateSachsSubgraphs` backtracks over "first unmatched vertex", at each step either pairing it into a K₂ edge or extending it into a simple cycle (`findSimpleCycles`), until all vertices are covered — this enumerates all spanning Sachs subgraphs. `computeSachsDeterminant` sums `(-1)^p * 2^c` over them.
4. **Rendering** — `renderKirchhoffAnalysis`/`renderSachsAnalysis` build HTML+LaTeX strings for the matrices/formulas (auto-collapsed into `<details>` when `n >= COLLAPSE_THRESHOLD`, currently 6) and call `typesetElement` to re-run MathJax on them. `renderSpanningTrees`/`renderSachsSubgraphs` draw one mini-canvas per enumerated subgraph/tree, reusing the main graph's node layout via `computeLayout`.

Key invariant: node identity is `node.id` (assigned as array index at creation, stable thereafter), not array position — always look up nodes via `nodes.find(n => n.id === ...)` when following edges.

## Architecture (app-hamming.js — Hamming cube page)

1. **Hypercube construction** (`buildHypercube`) — for a given `n`, generates all `2^n` node ids (0 to 2^n−1, each a bitstring) and connects `u`–`v` when `popcount(u^v) === 1`. Laid out via a recursive "nested squares" projection: `n` offset vectors with shrinking radius/rotating angle, and a node's position is the sum of the offsets for its set bits — this is what makes `Q_n` render as a recognizable nested-cube figure instead of a force-directed mess.
2. **GF(2) linear algebra** — `gf2Basis` (Gaussian elimination by highest set bit) reduces a list of codewords to an independent basis; `gf2Span` XOR-combines the basis into the full subspace (`Set<number>`); `gf2Orthogonal` brute-forces all `2^n` vectors to find the dual code (orthogonal complement) — cheap at this scale (n ≤ 6); `minDistance` is pairwise Hamming distance over a codeword set.
3. **Two subspace-input modes**, switched via `.tab-switcher`/`data-mode` buttons: a generator-matrix row editor (`matrix-rows`), and click-to-select nodes on the canvas (`selectedWords`) with a "Calculate Span" button. Both funnel into `gf2Span`/`gf2Basis` and `renderResults`.
4. **Orthogonal complement toggle** — once a subspace exists, a checkbox recomputes `gf2Orthogonal` against the current `subspaceBasis` and renders a parallel stats/codeword panel; `drawGraph()` colors subspace nodes/edges green (or amber for span-closure additions) and dual-code nodes/edges in the shared `--accent` blue, with subspace membership taking visual priority on overlap.

## Architecture (app-hypergraph.js — Hypergraph Signal Processing page)

1. **Editor interaction** — click empty canvas to place a node (`MAX_NODES = 15`, positioned wherever clicked, unlike the fixed layouts on the other pages); click an existing node to toggle it into `selectedForEdge`; "Add Hyperedge" turns the current selection (≥2 nodes) into a hyperedge with a palette color; double-click a node deletes it (and prunes it from any hyperedges, dropping edges that fall below size 2). Node/hyperedge ids are monotonic counters (`nodeIdCounter`/`edgeIdCounter`), not array indices, since nodes can be deleted — always resolve by id via `nodes.find`/`.filter`, same invariant as `app.js`.
2. **Random generation** (`randomHypergraphFull`, `randomHypergraphSameNodes`, `randomHypergraphSameNodesAndEdges`) — the split "Random" button + dropdown (`.dropdown-menu`) drive these three variants: full reset with a new node count laid out via `layoutCircle`, same-node-count with regenerated hyperedges, and same-node-and-edge-count with regenerated hyperedge membership only. All funnel through `generateRandomHyperedges(edgeCount)`.
3. **Hyperedge rendering** — `drawHyperedge` special-cases size-2 hyperedges as a thick translucent line; size ≥3 hyperedges are drawn as a filled blob via `convexHull` (monotone chain) expanded outward from its centroid (`expandOutward`) so the blob clears the node circles.
4. **Matrix core** (generic, reusable for signal-processing math) — `matMul`, `transpose`, `identity`, `diag`, `subtract`, `diagInv`/`diagInvSqrt` (elementwise reciprocal/rsqrt of a vector meant as diagonal entries; 0 stays 0, the pseudo-inverse convention for isolated/degenerate degrees) are plain dense-array utilities; `roundMatrix`/`roundVector` (via `fmt`) round to 3 decimals before anything is turned into LaTeX. `buildIncidenceMatrix()` produces the n×m incidence matrix H (rows = nodes, cols = hyperedges), with `nodeDegrees`/`edgeCardinalities` as row/column sums and `weightedVertexDegrees` weighting rows by each hyperedge's `weight`. `renderIncidenceMatrix()` renders H (and degree/cardinality vectors) as LaTeX via MathJax, auto-collapsing past `COLLAPSE_THRESHOLD`.
5. **Hyperedge weights + operators** — each hyperedge carries a `weight` (default 1, editable via the collapsible "Hyperedge Weights" panel, `renderWeightsPanel()`). `computeOperators()` builds and returns (not renders) all three matrices: the combinatorial hypergraph Laplacian `L = D_v − H W D_e⁻¹ Hᵀ`, the normalized Laplacian `Δ = I − Θ` (Zhou/Huang/Schölkopf 2006 symmetric normalization, `Θ = D_v^{-1/2} H W D_e^{-1} H^T D_v^{-1/2}`), and the shift operator `S = D_v⁻¹ H W D_e⁻¹ Hᵀ` (row-stochastic random-walk operator). The result is cached in module-level `currentOperators` since both the matrix-display panel and the spectral panel read from it. `recomputeMath()` is the single choke point that calls `computeOperators()` then `renderOperatorMatrices()`/`renderSpectral()` — `afterMutation()` calls it after every structural edit, and a weight input's own `input` listener calls it directly (not `afterMutation()`) so retyping a weight doesn't rebuild the weight-input DOM out from under the focused field.
6. **Spectral properties (3rd column)** — `jacobiEigen(matrix)` is a cyclic Jacobi eigenvalue solver for real symmetric matrices (fine at n ≤ 15), returning ascending eigenvalues with unit eigenvectors. `computeSpectral(ops)` reads the `#spectral-matrix-select` dropdown and returns `{values, vectors, symbol}`: for `L` or `Δ` (both symmetric) it diagonalizes directly; for the shift operator `S` (not symmetric in general) it diagonalizes `Θ` instead and recovers `S`'s eigenpairs via the similarity transform `S = D_v^{-1/2} Θ D_v^{1/2}` — same eigenvalues, eigenvectors scaled by `D_v^{-1/2}` and renormalized. `renderSpectral(ops)` calls it and renders the eigenvalue/eigenvector display, then hands the same `spectral` result to `renderFilterPanel()` so the filter panel never recomputes the decomposition itself.
7. **Spectral filter** — below the spectral display, a node-domain signal `x` (each node carries a `signal` field, default 1, editable in `renderSignalRows()`) and a per-eigenvalue gain vector `filterGains` (default 1 each, length always kept in sync with the node count via `ensureFilterGains()`, editable in `renderFilterPanel()`) drive `renderFilterResult()`: it builds `V` from the current spectral decomposition's eigenvectors, inverts it with `invertMatrix()` (general Gauss-Jordan — `V` is orthogonal for `L`/`Δ` but not necessarily for `S`'s rescaled eigenvectors, so plain transpose isn't assumed), then computes `x̂ = V⁻¹x` → `x̂' = g⊙x̂` → `x' = Vx̂'` (graph Fourier transform, filter, inverse transform). `matVec()` is the generic matrix-vector product used throughout. Editing a signal or gain value only calls `renderFilterResult()` directly (not `afterMutation()`/`recomputeMath()`), so it doesn't rebuild the input DOM under the focused field; switching the operator dropdown or any structural edit flows through `renderSpectral()` → `renderFilterPanel()` instead, since the eigenbasis itself changed.

When making changes, keep the same structure: these files intentionally have no framework or module system, and new features should extend the existing section-based organization rather than introducing a build pipeline.
