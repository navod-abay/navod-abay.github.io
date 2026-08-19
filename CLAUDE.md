# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, single-page web app that visualizes two graph-theory theorems side by side: Kirchhoff's Matrix Tree Theorem (spanning tree counting via the Laplacian) and Sachs' Theorem (adjacency matrix determinant via cycle/matching decomposition). No build step, no package manager, no dependencies beyond CDN-loaded MathJax and Google Fonts.

Files:
- `index.html` — page structure, canvas editor panel, tabbed results panel, theorem reference section
- `app.js` — all application logic (single `DOMContentLoaded` listener wrapping everything)
- `style.css` — all styling

## Running locally

No build/install step. Serve the directory and open in a browser:

```bash
python3 -m http.server 8080
# visit http://localhost:8080
```

There is no test suite, linter, or bundler configured in this repo.

## Architecture (app.js)

Everything lives in one closure in `app.js`, organized into clearly commented sections (search for `// ====` banners to navigate):

1. **Canvas graph editor** — mutable `nodes`/`edges` arrays hold user-authored graph state. Click on the canvas to add a node (max 9, enforced by `MAX_NODES`), drag from one node to another to add an edge. `drawGraph()` is the single render function for the main canvas, called after every mutation.
2. **Panel/canvas height sync** — a `ResizeObserver` on `resultsPanel` clamps and mirrors the canvas height so the two columns stay visually even.
3. **Math core**:
   - `buildLaplacian` / `calcDet` (Gaussian elimination with partial pivoting) compute the Laplacian and its cofactor determinant for Kirchhoff.
   - `enumerateSpanningTrees` uses union-find + backtracking over the edge list to enumerate all spanning trees explicitly (exponential — fine at 9-node scale, not beyond).
   - `enumerateSachsSubgraphs` backtracks over "first unmatched vertex", at each step either pairing it into a K₂ edge or extending it into a simple cycle (`findSimpleCycles`), until all vertices are covered — this enumerates all spanning Sachs subgraphs. `computeSachsDeterminant` sums `(-1)^p * 2^c` over them.
4. **Rendering** — `renderKirchhoffAnalysis`/`renderSachsAnalysis` build HTML+LaTeX strings for the matrices/formulas (auto-collapsed into `<details>` when `n >= COLLAPSE_THRESHOLD`, currently 6) and call `typesetElement` to re-run MathJax on them. `renderSpanningTrees`/`renderSachsSubgraphs` draw one mini-canvas per enumerated subgraph/tree, reusing the main graph's node layout via `computeLayout`.

Key invariant: node identity is `node.id` (assigned as array index at creation, stable thereafter), not array position — always look up nodes via `nodes.find(n => n.id === ...)` when following edges.

When making changes, keep the same structure: this file intentionally has no framework or module system, and new features should extend the existing section-based organization rather than introducing a build pipeline.
