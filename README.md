# GraphVisualizations

An interactive web application that visualizes two fundamental graph-theoretic theorems side by side.

## Features

### ⬡ Kirchhoff's Matrix Tree Theorem
Construct a graph and instantly see:
- The **Laplacian matrix** _L = D − A_
- The **reduced Laplacian** determinant = number of spanning trees
- All **spanning trees** enumerated and drawn as mini-graph cards

### ∮ Sachs' Theorem
Visualize the combinatorial interpretation of **det(A)** (adjacency matrix determinant):
- The **Sachs subgraph** formula: `det(A) = (−1)ⁿ · Σ (−1)^p(S) · 2^c(S)`
- Every **spanning Sachs subgraph** drawn — K₂ edges (purple) and cycles (orange-red)
- Per-subgraph contribution breakdown in a collapsible table
- For large graphs (n ≥ 6), matrices auto-collapse into expandable `<details>` sections

### Theorem Reference Section
Full background on both theorems at the bottom of the page, including:
- Mathematical statements and worked examples
- Historical notes
- Academic references

## Usage

1. Open `index.html` in any modern browser (or serve locally):
   ```bash
   python3 -m http.server 8080
   # then visit http://localhost:8080
   ```
2. Click on the canvas to add nodes (max 9)
3. Drag from one node to another to add an edge
4. Click **Calculate & Visualize**
5. Toggle between **Kirchhoff** and **Sachs** tabs in the Analysis panel
6. Scroll down to read the full theorem references

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no build step required
- [MathJax 3](https://www.mathjax.org/) for LaTeX rendering
- [Google Fonts — Inter & JetBrains Mono](https://fonts.google.com/)

## Mathematical Background

### Kirchhoff (1847)
> The number of spanning trees of a connected graph equals the determinant of any cofactor of the graph's Laplacian matrix.

### Sachs (1964)
> The coefficients of the characteristic polynomial of a graph's adjacency matrix can be expressed as a sum over "Sachs subgraphs" — spanning subgraphs whose components are all K₂ edges or simple cycles.

## References

- Kirchhoff, G. (1847). *Über die Auflösung der Gleichungen…* Ann. Phys. Chem. **72**, 497–508.
- Sachs, H. (1964). *Beziehungen zwischen den in einem Graphen enthaltenen Kreisen und seinem charakteristischen Polynom.* Publ. Math. Debrecen **11**, 119–134.
- Biggs, N. (1993). *Algebraic Graph Theory* (2nd ed.). Cambridge University Press.
- Godsil, C. & Royle, G. (2001). *Algebraic Graph Theory.* Springer.

## License

MIT
