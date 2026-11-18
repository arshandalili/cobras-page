/* Page chrome: KaTeX rendering, the table of contents, and the BibTeX copy button. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // TeX macros shared by every formula on the page (the paper's notation)
  const MACROS = {
    '\\Sph': '\\mathcal{S}',
    '\\KL': '\\mathrm{KL}',
    '\\nablaS': '\\nabla_{\\mathcal{S}}',
    '\\bx': '\\boldsymbol{x}',
    '\\bh': '\\boldsymbol{h}',
    '\\bv': '\\boldsymbol{v}',
    '\\bmu': '\\boldsymbol{\\mu}',
  };
  // render in small chunks, top of the article first, so typesetting ~230 formulas never blocks the page
  const OPTS = {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
    macros: MACROS,
    throwOnError: false,
    ignoredClasses: ['citation-block', 'glabels'],
  };
  function renderMath() {
    if (!window.renderMathInElement) return;
    const article = $('article.content');
    const queue = [...$$('.post-heading, .post-cover'), ...(article ? [...article.children] : [])];
    const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 8 }), 1));
    const step = deadline => {
      while (queue.length && deadline.timeRemaining() > 2) window.renderMathInElement(queue.shift(), OPTS);
      if (queue.length) idle(step);
    };
    window.renderMathInElement(queue.shift(), OPTS);
    idle(step);
  }
  renderMath();

  // highlight the section being read
  const links = $$('.left-toc a');
  const heads = $$('.content h2[id]');
  if ('IntersectionObserver' in window && links.length) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle('is-active', a.dataset.sec === e.target.id));
    }), { rootMargin: '-12% 0px -78% 0px' });
    heads.forEach(h => io.observe(h));
  }

  // copy BibTeX
  const copy = $('.copy');
  if (copy) copy.addEventListener('click', async () => {
    const txt = $('.bib').textContent;
    try { await navigator.clipboard.writeText(txt); copy.textContent = 'copied ✓'; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents($('.bib'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = 'selected';
    }
    setTimeout(() => { copy.textContent = 'copy'; }, 1600);
  });
})();
