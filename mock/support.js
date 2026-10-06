/*
 * Renderizador mínimo dos arquivos .dc.html do mock, para abrir as telas
 * direto no navegador (sem o editor de design).
 * Suporta: {{holes}}, <sc-for>, <sc-if>, <helmet> e a classe Component/renderVals.
 */
(function () {
  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(patch) {
      this.state = Object.assign({}, this.state, patch);
      if (this.__rerender) this.__rerender();
    }
    forceUpdate() {
      if (this.__rerender) this.__rerender();
    }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function resolve(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    const parts = path.split('.');
    let cur = scope;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, (_, p) => {
      const v = resolve(p, scope);
      return v == null || v === false ? '' : String(v);
    });
  }

  function renderChildren(src, dest, scope) {
    for (const child of Array.from(src.childNodes)) renderNode(child, dest, scope);
  }

  function renderNode(node, dest, scope) {
    if (node.nodeType === Node.TEXT_NODE) {
      dest.appendChild(document.createTextNode(interpolate(node.textContent, scope)));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'helmet') {
      for (const child of Array.from(node.children)) document.head.appendChild(child.cloneNode(true));
      return;
    }
    if (tag === 'sc-for') {
      const list = resolve((node.getAttribute('list') || '').replace(HOLE, '$1'), scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => {
        const inner = Object.create(scope);
        inner[as] = item;
        inner.$index = i;
        renderChildren(node, dest, inner);
      });
      return;
    }
    if (tag === 'sc-if') {
      const v = resolve((node.getAttribute('value') || '').replace(HOLE, '$1'), scope);
      if (v) renderChildren(node, dest, scope);
      return;
    }

    const ns = node.namespaceURI;
    const el = ns && ns !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(ns, node.tagName)
      : document.createElement(tag);
    for (const attr of Array.from(node.attributes)) {
      const whole = attr.value.match(WHOLE);
      if (whole && /^on/i.test(attr.name)) {
        const fn = resolve(whole[1], scope);
        if (typeof fn === 'function') el.addEventListener(attr.name.slice(2).toLowerCase(), fn);
        continue;
      }
      el.setAttribute(attr.name, interpolate(attr.value, scope));
    }
    renderChildren(node, el, scope);
    dest.appendChild(el);
  }

  function boot() {
    const host = document.querySelector('x-dc');
    const script = document.querySelector('script[data-dc-script]');
    if (!host) return;
    const template = document.createElement('template');
    template.innerHTML = host.innerHTML;
    host.remove();

    let instance = null;
    if (script) {
      const Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
      instance = new Component({});
    }
    const root = document.createElement('div');
    root.id = 'dc-root';
    document.body.insertBefore(root, document.body.firstChild);

    const render = () => {
      root.innerHTML = '';
      const vals = instance && instance.renderVals ? instance.renderVals() : {};
      renderChildren(template.content, root, vals);
    };
    if (instance) instance.__rerender = render;
    render();
  }

  const hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none}';
  document.head.appendChild(hide);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
