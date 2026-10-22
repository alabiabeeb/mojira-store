// Helpers shared by the storefront and the owner dashboard.
const money = n => '₦' + Number(n || 0).toLocaleString('en-NG');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  'women-shoes': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 44c0-6 2-14 6-20 3 0 5 2 7 6 4 7 12 10 22 11 9 1 17 3 17 7v2H24l-4-6-4 6h-6l-1-6"/><path d="M12 24c-2 5-3 12-3 20M16 50l-3 8"/></svg>',
  'women-bags': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24h44l-4 32H14L10 24Z"/><path d="M22 24c0-8 4-14 10-14s10 6 10 14"/><path d="M28 34h8"/></svg>',
  'women-watches': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="12"/><path d="M32 26v6l4 3M26 21l2-13h8l2 13M26 43l2 13h8l2-13"/><circle cx="32" cy="32" r="15" stroke-dasharray="2 3"/></svg>',
  'men-watches': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="18" width="28" height="28" rx="8"/><path d="M32 25v7l5 3M22 18l2-12h16l2 12M22 46l2 12h16l2-12M46 30h4v4h-4"/></svg>',
};

function productImage(p) {
  return p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
    : `<div class="placeholder">${ICONS[p.category] || ICONS['women-bags']}</div>`;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}
