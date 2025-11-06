 // ====== Палитра ======
  const palette = [
    {name:'white',hex:'#ffffff'},
    {name:'yellow',hex:'#ffeb3b'},
    {name:'orange',hex:'#ff9800'},
    {name:'red',hex:'#f44336'},
    {name:'green',hex:'#4caf50'},
    {name:'cyan',hex:'#00bcd4'},
    {name:'blue',hex:'#2196f3'},
    {name:'violet',hex:'#9c27b0'},
    {name:'brown',hex:'#795548'},
    {name:'black',hex:'#212121'}
  ];
  let chosen = palette[0];

  // ====== DOM ======
  const $ = sel => document.querySelector(sel);
  const paletteEl = $('#palette');
  const curColorNameEl = $('#curColorName');
  const selCountEl = $('#selCount');
  const btnCheck = $('#btnCheck');
  const pzInner = $('#pzInner');
  const mapStage = $('#mapStage');

  // ====== Размеры сцены из встроенной конфигурации ======
  const config = JSON.parse(document.getElementById('mapConfig').textContent);
  let MAP_W = config.meta?.width ?? config.meta?.iw ?? 1000;
  let MAP_H = config.meta?.height ?? config.meta?.ih ?? 700;

  mapStage.style.setProperty('--map-w', MAP_W + 'px');
  mapStage.style.setProperty('--map-h', MAP_H + 'px');
  mapStage.style.width  = MAP_W + 'px';
  mapStage.style.height = MAP_H + 'px';

  // ====== Модель ======
  const areas = [];           // [{ id, name, type:'mask'|'poly', img?|points?, color, correctColor, el }]
  const selected = new Set(); // множество выбранных id

  // ====== Палитра ======
  function selectPaletteByName(name){
    const c = palette.find(p=>p.name===name) || palette[0];
    chosen = c;
    curColorNameEl.textContent = c.name;
    paletteEl.querySelectorAll('.sw').forEach(sw=>{
      sw.classList.toggle('selected', sw.dataset.name === c.name);
    });
  }

  function buildPalette(){
    paletteEl.innerHTML = '';
    for(const c of palette){
      const sw = document.createElement('div');
      sw.className = 'sw'+(c===chosen?' selected':'');
      sw.dataset.name = c.name;
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.addEventListener('click', ()=>{
        // выбрать цвет в палитре
        selectPaletteByName(c.name);
        // перекрасить все выделенные области
        if (selected.size){
          for (const a of areas){
            if (selected.has(a.id)) paintArea(a, c);
          }
        }
      });
      paletteEl.appendChild(sw);
    }
    selectPaletteByName(chosen.name);
  }

  // ====== Выделение ======
  const ACTIVE_STROKE = getComputedStyle(document.documentElement).getPropertyValue('--active').trim() || '#2563eb';

  function reflectSelection(){
    for (const a of areas){
      if (a.type === 'mask'){
        a.el.classList.toggle('active', selected.has(a.id));
      } else {
        // ВАЖНО: больше не игнорируем помеченные (после проверки) —
        // всегда приводим stroke к состоянию выбора
        const on = selected.has(a.id);
        a.el.setAttribute('stroke', on ? ACTIVE_STROKE : '#333');
        a.el.setAttribute('stroke-width', on ? '2.5' : '1.5');
      }
    }
    selCountEl.textContent = String(selected.size);

    // если ровно одна область выделена — синхроним палитру с её цветом
    if (selected.size === 1){
      const id = [...selected][0];
      const area = areas.find(x=>x.id===id);
      selectPaletteByName(area?.color || 'white');
    }
  }

  function setActiveOnly(id){
    selected.clear();
    if (id) selected.add(id);
    reflectSelection();
  }
  function toggleInSelection(id){
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    reflectSelection();
  }
  function clearSelection(){
    selected.clear();
    reflectSelection();
  }
  window.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') clearSelection(); });

  // ====== Перекраска ======
  function paintArea(a, colorObj){
    a.color = colorObj.name;
    if (a.type === 'mask') {
      a.el.style.setProperty('--fill', colorObj.hex);
      // Снять свечение проверки
      a.el.classList.remove('correct','wrong');
    } else {
      a.el.setAttribute('fill', colorObj.hex);
      // Снять свечение проверки
      a.el.removeAttribute('data-mark');
      a.el.removeAttribute('filter');
      // Обновить обводку по текущему выбору
      const on = selected.has(a.id);
      a.el.setAttribute('stroke', on ? ACTIVE_STROKE : '#333');
      a.el.setAttribute('stroke-width', on ? '2.5' : '1.5');
    }
  }

  // ====== Проверка (свечение вместо обводки) ======
  function checkAll(){
    const okColor  = (getComputedStyle(document.documentElement).getPropertyValue('--ok').trim()  || '#22c55e').toLowerCase();
    const badColor = (getComputedStyle(document.documentElement).getPropertyValue('--bad').trim() || '#ef4444').toLowerCase();

    for (const a of areas){
      const ok = a.correctColor ? (a.color === a.correctColor) : null;

      if (a.type === 'mask') {
        // Сначала убрать прошлые метки
        a.el.classList.remove('correct','wrong');
        // Затем поставить новую
        if (ok !== null) a.el.classList.add(ok ? 'correct' : 'wrong');
      } else {
        // Нормализуем stroke под текущее выделение (чтобы «синий» не зависал)
        const on = selected.has(a.id);
        a.el.setAttribute('stroke', on ? ACTIVE_STROKE : '#333');
        a.el.setAttribute('stroke-width', on ? '2.5' : '1.5');

        // Сбросить прежние метки/свечения
        a.el.removeAttribute('data-mark');
        a.el.removeAttribute('filter');

        if (ok !== null) {
          const svg = a.el.ownerSVGElement;
          ensureSvgGlowDefs(svg, okColor, badColor);
          a.el.setAttribute('filter', ok ? 'url(#glow-ok)' : 'url(#glow-bad)');
          a.el.setAttribute('data-mark', ok ? 'correct' : 'wrong');
        }
      }
    }
  }

  // Добавляем в SVG фильтры для «внутреннего+внешнего» свечения
function ensureSvgGlowDefs(svg, okHex, badHex){
  if (!svg || svg.__glowDefsV2) return;

  const el = (name, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  const defs = el('defs', {});

  const makeBoth = (id, color) => {
    const f = el('filter', {
      id,
      x: '-25%', y: '-25%', width: '150%', height: '150%',
      'color-interpolation-filters': 'sRGB'
    });

    // --- Внешнее свечение ---
    const oBlur  = el('feGaussianBlur', { in:'SourceAlpha', stdDeviation:'3', result:'o-blur' });
    const oFlood = el('feFlood', { 'flood-color': color, 'flood-opacity':'1', result:'o-col' });
    const oComp  = el('feComposite', { in:'o-col', in2:'o-blur', operator:'in', result:'outerGlow' });

    // --- Внутренняя кайма: SourceAlpha - erode(SourceAlpha) ---
    const iCore  = el('feMorphology', { in:'SourceAlpha', operator:'erode', radius:'1.6', result:'i-core' });
    const iRing  = el('feComposite', { in:'SourceAlpha', in2:'i-core', operator:'out', result:'i-ring' });
    const iBlur  = el('feGaussianBlur', { in:'i-ring', stdDeviation:'2.5', result:'i-blur' });
    const iFlood = el('feFlood', { 'flood-color': color, 'flood-opacity':'1', result:'i-col' });
    const iComp  = el('feComposite', { in:'i-col', in2:'i-blur', operator:'in', result:'innerGlow' });

    // --- Слои: внешнее -> графика -> внутреннее (чтобы inner было поверх) ---
    const merge = el('feMerge', {});
    merge.appendChild(el('feMergeNode', { in:'outerGlow' }));
    merge.appendChild(el('feMergeNode', { in:'SourceGraphic' }));
    merge.appendChild(el('feMergeNode', { in:'innerGlow' }));

    f.append(oBlur, oFlood, oComp, iCore, iRing, iBlur, iFlood, iComp, merge);
    return f;
  };

  defs.appendChild(makeBoth('glow-ok',  okHex));
  defs.appendChild(makeBoth('glow-bad', badHex));
  svg.insertBefore(defs, svg.firstChild);
  svg.__glowDefsV2 = true;
}


  // ====== Panzoom ======
  const pz = Panzoom(pzInner, { maxScale:6, minScale:.5, contain:'outside' });
  pzInner.parentElement.addEventListener('wheel', pz.zoomWithWheel, { passive: false });

  // Клик по пустому месту: ЛКМ -> если не было движения — снимаем выделение; иначе панорамирование
  (function bindEmptyClickDetector(){
    const CLICK_TOL = 6; // px
    let down = null;

    pzInner.addEventListener('pointerdown', (e)=>{
      if (e.button !== 0) return;
      down = { x:e.clientX, y:e.clientY, target:e.target, moved:false };
    }, { passive:true });

    pzInner.addEventListener('pointermove', (e)=>{
      if (!down) return;
      if (!down.moved) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) > CLICK_TOL || Math.abs(dy) > CLICK_TOL) down.moved = true;
      }
    }, { passive:true });

    window.addEventListener('pointerup', (e)=>{
      if (!down) return;
      if (e.button === 0 && !down.moved) {
        const t = down.target;
        const isEmpty =
          t === mapStage ||
          t === pzInner ||
          (t.classList && (t.classList.contains('map-stage') || t.classList.contains('backgrid') || t.classList.contains('map-svg'))) ||
          (t.nodeName === 'SVG' && t.classList.contains('map-svg'));
        if (isEmpty) clearSelection();
      }
      down = null;
    }, { passive:true });
    window.addEventListener('pointercancel', ()=>{ down=null; }, { passive:true });
  })();

  // ====== Загрузка данных и рендер ======
  function applyJsonDataClient(d, { setImage = true } = {}) {
    if (typeof d === 'string') d = JSON.parse(d);

    // ---- размеры сцены ----
    const W = d?.meta?.iw ?? d?.meta?.width  ?? 1000;
    const H = d?.meta?.ih ?? d?.meta?.height ?? 700;

    MAP_W = W; MAP_H = H;
    mapStage.style.setProperty('--map-w', W + 'px');
    mapStage.style.setProperty('--map-h', H + 'px');
    mapStage.style.width  = W + 'px';
    mapStage.style.height = H + 'px';

    // фон-картинка (необязательно)
    if (setImage && d?.image?.dataURL) {
      mapStage.style.backgroundImage = `url(${d.image.dataURL})`;
      mapStage.style.backgroundSize = 'contain';
      mapStage.style.backgroundRepeat = 'no-repeat';
    } else {
      mapStage.style.backgroundImage = '';
    }

    // очистить прошлый рендер
    [...mapStage.querySelectorAll('.area, svg.map-svg')].forEach(n => n.remove());
    selected.clear(); selCountEl.textContent = '0';

    const arr = Array.isArray(d) ? d : (Array.isArray(d?.areas) ? d.areas : []);
    const answers = (d && d.answers) || {}; // если ключи ответов вынесены отдельно

    const hasMasks = arr.some(o => o.img);
    const hasPolys = arr.some(o => Array.isArray(o.coords) && o.coords.length >= 3);
    const newAreas = [];

    // обработчик клика по области (только выделение)
    const handleAreaClick = (a, ev) => {
      if (ev?.shiftKey) toggleInSelection(a.id);
      else setActiveOnly(a.id);
    };

    const WHITE = palette.find(x=>x.name==='white') || palette[0];

    if (hasMasks) {
      // ===== Маски (клиентский вариант) =====
      for (const o of arr) {
        if (!o.img) continue;
        const a = {
          id: o.id,
          name: o.name || `Область ${o.id}`,
          img: o.img,
          correctColor: o.correct || answers[o.id] || o.color || null, // ЭТАЛОН
          color: 'white',                                              // ТЕКУЩИЙ цвет — всегда белый
          type: 'mask',
          el: null
        };
        const div = document.createElement('div');
        div.className = 'area';
        div.style.setProperty('--map-w', W + 'px');
        div.style.setProperty('--map-h', H + 'px');
        div.style.setProperty('--img', `url("${a.img}")`);
        div.style.setProperty('--fill', WHITE.hex); // стартовая заливка белая
        div.addEventListener('click', ev => handleAreaClick(a, ev));
        a.el = div;
        newAreas.push(a);
        mapStage.appendChild(div);
      }
    } else if (hasPolys) {
      // ===== Полигоны (админский формат coords) =====
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('map-svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      Object.assign(svg.style, { position:'absolute', left:'0', top:'0', width: W+'px', height: H+'px' });
      mapStage.appendChild(svg);

      for (const o of arr) {
        if (!Array.isArray(o.coords) || o.coords.length < 3) continue;
        const pts = o.coords.map(p => `${p[0]},${p[1]}`).join(' ');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts);
        poly.setAttribute('fill', WHITE.hex);   // стартовая заливка белая
        poly.setAttribute('stroke', '#333');
        poly.setAttribute('stroke-width', '1.5');
        poly.style.cursor = 'pointer';

        const a = {
          id: o.id,
          name: o.name || `Область ${o.id}`,
          points: o.coords,
          correctColor: o.correct || answers[o.id] || o.color || null, // ЭТАЛОН
          color: 'white',                                              // ТЕКУЩИЙ цвет — белый
          type: 'poly',
          el: poly
        };
        poly.addEventListener('click', ev => handleAreaClick(a, ev));
        newAreas.push(a);
        svg.appendChild(poly);
      }
    } else {
      console.warn('applyJsonDataClient: нет ни img, ни coords в areas');
    }

    // обновляем глобальную модель НЕ переопределяя const
    areas.splice(0, areas.length, ...newAreas);
  }

  // Экспортируем функцию в глобальную область — можно вызывать из консоли
  window.applyJsonDataClient = applyJsonDataClient;

  // ====== Init ======
  buildPalette();
  btnCheck.addEventListener('click', checkAll);
  // стартуем со встроенной конфигурацией
  applyJsonDataClient(config);
