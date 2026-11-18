# COBRAS project page

Static project page for *Conditional Optimal Bridge for Riemannian Activation Steering* (NeurIPS 2026, [arXiv:2607.10517](https://arxiv.org/abs/2607.10517)). No build step: plain HTML, CSS and JavaScript. KaTeX and the fonts load from public CDNs.

## Preview locally

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

Open it through a server rather than as a `file://` URL, so that fonts and scripts load the same way they will on GitHub Pages.

## Deploy on GitHub Pages

The page is served at <https://cobras-steer.github.io/> from the repository `cobras-steer/cobras-steer.github.io` (an organization site, so the page sits at the root of the domain). Push this folder to that repository's `main` branch; if *Settings → Pages* shows no source, choose *Deploy from a branch*, `main`, `/ (root)`. The empty `.nojekyll` file tells Pages to serve the files as they are, without a Jekyll build.

The social-preview tags in `index.html` (`og:url`, `og:image`, `twitter:image`) use absolute URLs on that domain, because link previews need them. Change them if the address changes.

## Layout

| Path | Contents |
|---|---|
| `index.html` | The article. All math is TeX between `$…$` / `$$…$$`, typeset by KaTeX; shared macros live in `static/js/page.js`. |
| `static/css/site.css` | Typography, layout, figure and chart styles. Colors are CSS variables at the top. |
| `static/js/toy.js` | COBRAS on a toy 2-sphere: exp/log maps, Sinkhorn potentials, the steering field, alignment coefficient, support gate, and geodesic Euler steps. |
| `static/js/globe.js` | The sphere figures (cover, fitting the bridge, steering field, step-size map). |
| `static/js/charts.js` | Result charts and the sample-generation explorer. Every number is copied from the paper's tables. |
| `static/img/` | Logo, favicon, social preview (`cover.png`), and the paper's two OOD figures. |

The sphere figures run the method itself on about 50 points per population, with ε and bandwidths chosen for a 2-sphere (see `OPTS` in `globe.js`). The paper's settings for real models are listed in the article.
