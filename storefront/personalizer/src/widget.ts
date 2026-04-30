import { renderPreviewSvg, type PreviewField, type PreviewTemplate } from './render';

const API_BASE = (window as any).__RP_API_BASE__ || 'https://app.riccardiparis.com';

// Extended field shape that includes storefront-only metadata from the API
interface StorefrontField extends PreviewField {
  required?: boolean | number;
  placeholder?: string | null;
  max_chars?: number | null;
}

// Extended template shape that includes id + updated_at from the API
interface StorefrontTemplate extends PreviewTemplate {
  id?: number;
  updated_at?: string;
}

interface MountSpec {
  el: HTMLElement;
  productHandle: string;
  productId: string;
}

async function init() {
  const mounts: MountSpec[] = [];
  document.querySelectorAll<HTMLElement>('#rp-personalizer, [data-rp-personalizer]').forEach((el) => {
    const productHandle = el.getAttribute('data-product-handle') || '';
    const productId = el.getAttribute('data-product-id') || '';
    if (!productHandle) return;
    mounts.push({ el, productHandle, productId });
  });
  await Promise.all(mounts.map(mount));
}

async function mount({ el, productHandle }: MountSpec) {
  let payload: any;
  try {
    const res = await fetch(`${API_BASE}/api/personalizer/template/${encodeURIComponent(productHandle)}`);
    if (!res.ok) return;
    payload = await res.json();
    if (!payload?.found) return;
  } catch { return; }

  const template: StorefrontTemplate = payload.template;
  const fields: StorefrontField[] = payload.fields || [];

  const initialValues: Record<string, string> = {};
  for (const f of fields) initialValues[String(f.id)] = f.default_value || '';

  el.innerHTML = `
    <div class="rp-pz">
      <style>
        .rp-pz { display:grid; grid-template-columns: 1fr 1fr; gap:24px; padding:16px 0; font-family: inherit; }
        @media (max-width: 720px) { .rp-pz { grid-template-columns: 1fr; } }
        .rp-pz-preview svg { width:100%; height:auto; }
        .rp-pz-row { margin-bottom:14px; }
        .rp-pz-row label { display:block; font-size: 11px; letter-spacing:.14em; text-transform:uppercase; color:#666; margin-bottom:6px; }
        .rp-pz-row input[type=text] { width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:6px; font-size:14px; box-sizing:border-box; }
        .rp-pz-row .rp-pz-count { font-size:11px; color:#888; margin-top:4px; text-align:right; }
        .rp-pz-row input[type=file] { font-size:13px; }
        .rp-pz-error { color:#c0392b; font-size:12px; margin-top:6px; }
      </style>
      <div class="rp-pz-preview" data-preview></div>
      <div class="rp-pz-fields" data-fields></div>
    </div>
  `;

  const previewEl = el.querySelector<HTMLDivElement>('[data-preview]')!;
  const fieldsEl = el.querySelector<HTMLDivElement>('[data-fields]')!;

  function rerender() {
    previewEl.innerHTML = renderPreviewSvg({ template, fields, values: initialValues });
  }

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'rp-pz-row';

    const labelEl = document.createElement('label');
    labelEl.textContent = f.label + (f.required ? ' *' : '');
    row.appendChild(labelEl);

    if (f.field_kind === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.name = `properties[${f.label}]`;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.default_value) input.value = f.default_value;
      if (f.max_chars) input.maxLength = f.max_chars;
      input.addEventListener('input', () => {
        initialValues[String(f.id)] = input.value;
        const count = row.querySelector<HTMLDivElement>('.rp-pz-count');
        if (count) count.textContent = `${input.value.length} / ${f.max_chars || '∞'}`;
        rerender();
      });
      row.appendChild(input);
      const count = document.createElement('div');
      count.className = 'rp-pz-count';
      count.textContent = `${(f.default_value || '').length} / ${f.max_chars || '∞'}`;
      row.appendChild(count);
    } else if (f.field_kind === 'image') {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.addEventListener('change', async () => {
        const f0 = file.files?.[0];
        if (!f0) return;
        const fd = new FormData();
        fd.append('file', f0);
        const r = await fetch(`${API_BASE}/api/personalizer/upload`, { method: 'POST', body: fd });
        if (!r.ok) {
          const err = row.querySelector<HTMLDivElement>('.rp-pz-error');
          if (err) err.textContent = 'Upload failed';
          return;
        }
        const j: { url: string } = await r.json();
        const fullUrl = j.url.startsWith('http') ? j.url : `${API_BASE}${j.url}`;
        initialValues[String(f.id)] = fullUrl;
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = `properties[${f.label}]`;
        hidden.value = fullUrl;
        row.appendChild(hidden);
        rerender();
      });
      row.appendChild(file);
      const err = document.createElement('div');
      err.className = 'rp-pz-error';
      row.appendChild(err);
    }

    fieldsEl.appendChild(row);
  }

  // Hidden metadata properties
  const cartForm = el.closest('form[action*="/cart/add"]') as HTMLFormElement | null;
  if (cartForm) {
    addHidden(cartForm, '_template_id', String(template.id || (template as any).template_id || payload.template?.id));
    addHidden(cartForm, '_template_updated_at', String(template.updated_at || ''));
    cartForm.addEventListener('submit', () => {
      let preview = '';
      for (const f of fields) {
        const v = initialValues[String(f.id)];
        if (v && f.field_kind === 'text') preview += `${f.label}=${v} · `;
      }
      addHidden(cartForm, '_spec_preview', preview.replace(/ · $/, ''));
    });
  }

  rerender();
}

function addHidden(form: HTMLFormElement, name: string, value: string) {
  let el = form.querySelector<HTMLInputElement>(`input[name="properties[${name}]"]`);
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden';
    el.name = `properties[${name}]`;
    form.appendChild(el);
  }
  el.value = value;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
