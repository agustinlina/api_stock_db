(() => {
  const API_BASE = window.location.origin;

  const depositoEl = document.getElementById('deposito');
  const modeHint = document.getElementById('modeHint');
  const searchEl = document.getElementById('search');
  const reloadBtn = document.getElementById('reloadBtn');
  const statusEl = document.getElementById('status');
  const thead = document.getElementById('thead');
  const tbody = document.getElementById('tbody');

  let allItems = [];
  let filtered = [];
  let currentDeposito = depositoEl.value; // olav por defecto

  // Helpers -----------------------------------------------------
  async function fetchJSON(path, options) {
    const res = await fetch(API_BASE + path, { credentials: 'same-origin', ...options });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Respuesta no-JSON (${res.status}). Primeros bytes: ${text.slice(0,120)}`);
    }
    return res.json();
  }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  function setHeadFor(deposito) {
    if (deposito === 'prices') {
      thead.innerHTML = `
        <tr>
          <th>Código</th>
          <th>Precio</th>
        </tr>
      `;
      modeHint.textContent = 'Colección de precios (editable).';
    } else {
      thead.innerHTML = `
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th>Rubro</th>
          <th>Stock</th>
        </tr>
      `;
      modeHint.textContent = 'Colección de stock (editable).';
    }
  }

  // Render ------------------------------------------------------
  function makeEditableCell(tr, field, value, originalCodigo) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'cell-wrap';

    const span = document.createElement('span');
    span.textContent = value ?? '';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn icon';
    editBtn.title = `Editar ${field}`;
    editBtn.textContent = '✎';

    let editing = false;

    function cancelEdit() {
      editing = false;
      wrap.innerHTML = '';
      const v = (field === 'precio' && typeof span.textContent === 'number')
        ? String(span.textContent)
        : span.textContent;
      span.textContent = v;
      wrap.appendChild(span);
      wrap.appendChild(editBtn);
    }

    async function saveEdit(newValRaw) {
      statusEl.textContent = 'Guardando…';
      statusEl.className = 'hint saving';

      const update = {};
      if (field === 'precio') {
        // aceptar tanto "123,45" como "123.45" o "123.450,00"
        const normalized = String(newValRaw).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        const num = Number(normalized);
        update.precio = Number.isNaN(num) ? newValRaw : num;
      } else {
        update[field] = newValRaw;
      }

      try {
        const res = await fetch(API_BASE + '/api/stock/item', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deposito: currentDeposito,         // usa el seleccionado
            originalCodigo: String(originalCodigo).trim(),
            update
          })
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          const t = await res.text();
          throw new Error(`Respuesta no-JSON (${res.status}) ${t.slice(0,120)}`);
        }
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error desconocido');

        // Actualizar en memoria
        const idx = allItems.findIndex(x => String(x.codigo) === String(originalCodigo));
        if (idx >= 0) {
          if (field === 'codigo') {
            allItems[idx].codigo = newValRaw;
            tr.dataset.codigo = newValRaw;
            originalCodigo = newValRaw;
          } else if (field === 'precio') {
            allItems[idx].precio = update.precio;
          } else {
            allItems[idx][field] = newValRaw;
          }
        }

        // Actualizar vista
        span.textContent = (field === 'precio' && typeof update.precio === 'number')
          ? String(update.precio)
          : String(newValRaw ?? '');

        statusEl.textContent = 'Guardado ✔';
        statusEl.className = 'hint saved';
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'hint'; }, 1200);
      } catch (e) {
        statusEl.textContent = 'Error al guardar: ' + e.message;
        statusEl.className = 'hint error';
      }
    }

    editBtn.addEventListener('click', () => {
      if (editing) return;
      editing = true;

      const inputEl = document.createElement('input');
      inputEl.type = (currentDeposito === 'prices' && field === 'precio') ? 'text' : 'text';
      inputEl.value = span.textContent;

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn primary';
      saveBtn.textContent = 'Guardar';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancelar';

      wrap.innerHTML = '';
      wrap.appendChild(inputEl);
      wrap.appendChild(saveBtn);
      wrap.appendChild(cancelBtn);

      inputEl.focus();
      inputEl.select();

      saveBtn.addEventListener('click', async () => {
        const newVal = inputEl.value.trim();
        if (newVal === span.textContent) { cancelEdit(); return; }
        await saveEdit(newVal);
        cancelEdit();
      });

      cancelBtn.addEventListener('click', () => cancelEdit());

      inputEl.addEventListener('keydown', async (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const newVal = inputEl.value.trim();
          if (newVal === span.textContent) { cancelEdit(); return; }
          await saveEdit(newVal);
          cancelEdit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancelEdit();
        }
      });
    });

    wrap.appendChild(span);
    wrap.appendChild(editBtn);
    td.appendChild(wrap);
    return td;
  }

  function renderTable(rows) {
    tbody.innerHTML = '';
    const isPrices = currentDeposito === 'prices';

    for (const it of rows) {
      const tr = document.createElement('tr');
      tr.dataset.codigo = it.codigo;

      if (isPrices) {
        // Editable: codigo, precio
        tr.appendChild(makeEditableCell(tr, 'codigo', it.codigo, it.codigo));
        tr.appendChild(makeEditableCell(tr, 'precio', it.precio, it.codigo));
      } else {
        // Editable: codigo, descripcion, rubro, stock
        tr.appendChild(makeEditableCell(tr, 'codigo', it.codigo, it.codigo));
        tr.appendChild(makeEditableCell(tr, 'descripcion', it.descripcion, it.codigo));
        tr.appendChild(makeEditableCell(tr, 'rubro', it.rubro, it.codigo));
        tr.appendChild(makeEditableCell(tr, 'stock', it.stock, it.codigo));
      }

      tbody.appendChild(tr);
    }

    statusEl.textContent = `${rows.length} ítems`;
    statusEl.className = 'hint';
  }

  // Filtro ------------------------------------------------------
  function applyFilter() {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) {
      filtered = allItems.slice();
    } else {
      const fields = currentDeposito === 'prices'
        ? ['codigo', 'precio']
        : ['codigo', 'descripcion', 'rubro', 'stock'];
      filtered = allItems.filter(x =>
        fields.map(f => x[f]).filter(Boolean)
          .some(v => String(v).toLowerCase().includes(q))
      );
    }
    renderTable(filtered);
  }

  // Carga -------------------------------------------------------
  async function loadCollection() {
    try {
      statusEl.textContent = 'Cargando…';
      statusEl.className = 'hint';

      setHeadFor(currentDeposito);

      const data = await fetchJSON(`/api/stock?deposito=${encodeURIComponent(currentDeposito)}`);
      const items =
        Array.isArray(data) ? data :
        (data && Array.isArray(data.items)) ? data.items :
        [];

      allItems = items;
      applyFilter();
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.className = 'hint error';
      tbody.innerHTML = '';
      console.error(e);
    }
  }

  // Eventos -----------------------------------------------------
  depositoEl.addEventListener('change', () => {
    currentDeposito = depositoEl.value;
    searchEl.value = '';
    loadCollection();
  });

  reloadBtn.addEventListener('click', loadCollection);
  searchEl.addEventListener('input', applyFilter);

  // Init --------------------------------------------------------
  setHeadFor(currentDeposito);
  loadCollection();
})();
