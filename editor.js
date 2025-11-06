//======== DOM ============
  const $ = id => document.getElementById(id);
  const panInner = $('panInner');
  const img = $('mapImage');
  const overlay = $('overlay');
  const paletteEl = $('palette'), areasList = $('areasList');
  const curIdEl = $('curId'), curCountEl = $('curCount');
  const imgFile = $('imgFile');
  const controlsEl = $('controls');
  const modeLabel  = $('modeLabel');
  const hintsEl = $('hints');
  const { src } = JSON.parse(document.getElementById('mapImageData').textContent);
  const CLICK_TOL_PX = 6;

  //======== State/Const ============
  const DOT_PX = { handle: 12, draft: 8, start: 10, startBig: 16, center: 14, ghost: 10 };
  const LINE_PX = { draft: 2, phantom: 2 };
  const EPS = 1e-7;
  const CACHE_KEY_FAST = 'mapAreas_cache_v5_6_fast';
  const palette = [
    {name:'white',hex:'#ffffff'},{name:'yellow',hex:'#ffeb3b'},{name:'orange',hex:'#ff9800'},
    {name:'red',hex:'#f44336'},{name:'green',hex:'#4caf50'},{name:'cyan',hex:'#00bcd4'},
    {name:'blue',hex:'#2196f3'},{name:'violet',hex:'#9c27b0'},{name:'brown',hex:'#795548'},{name:'black',hex:'#212121'}
  ];

  let clickCand = null;
  let selectedColor = palette[0];
  let areas = [];
  let selectedSet = new Set();
  let nextId = 1;
  let isDrawing = false;
  let drawingByCtrl = false;
  let draftPts = [];
  let phantom = null, phantomLine = null, phantomLineStart = null;
  let iw=1000, ih=1000;
  const areaEls = new Map();
  let edgeGhost = null;

  //======== PanZoom ===========
  const pz = Panzoom(panInner, { maxScale:6, minScale:.5, disablePan:false, cursor:'' });
  panInner.style.removeProperty('cursor');
  panInner.parentElement.addEventListener('wheel', pz.zoomWithWheel);
  const getScale = () => pz.getScale ? pz.getScale() : 1;

  //======== Геометрия ===========
  const orient=(a,b,c)=> (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const onSeg=(a,b,p)=> Math.min(a[0],b[0])-EPS<=p[0]&&p[0]<=Math.max(a[0],b[0])+EPS && Math.min(a[1],b[1])-EPS<=p[1]&&p[1]<=Math.max(a[1],b[1])+EPS;
  function segIntersects(a1,a2,b1,b2){ const o1=orient(a1,a2,b1),o2=orient(a1,a2,b2),o3=orient(b1,b2,a1),o4=orient(b1,b2,a2); if (Math.abs(o1)<EPS&&onSeg(a1,a2,b1)) return true; if (Math.abs(o2)<EPS&&onSeg(a1,a2,b2)) return true; if (Math.abs(o3)<EPS&&onSeg(b1,b2,a1)) return true; if (Math.abs(o4)<EPS&&onSeg(b1,b2,a2)) return true; return (o1>0)!==(o2>0) && (o3>0)!==(o4>0); }
  function segmentIntersectionPoint(a1,a2,b1,b2){ const[x1,y1]=a1,[x2,y2]=a2,[x3,y3]=b1,[x4,y4]=b2; const denom=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4); if (Math.abs(denom)<EPS) return null; const xi=((x1*y2-y1*x2)*(x3-x4)-(x1-x2)*(x3*y4-y3*x4))/denom; const yi=((x1*y2-y1*x2)*(y3-y4)-(y1-y2)*(x3*y4-y3*x4))/denom; const pt=[xi,yi]; return (onSeg(a1,a2,pt)&&onSeg(b1,b2,pt))?{x:xi,y:yi}:null; }
  function pointInPoly(pt, poly){ const [x,y]=pt; let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const[xi,yi]=poly[i],[xj,yj]=poly[j]; const inter=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi); if (inter) inside=!inside; } return inside; }
  function polysIntersect(A,B){ for (let i=0;i<A.length;i++){ const a1=A[i],a2=A[(i+1)%A.length]; for (let j=0;j<B.length;j++){ const b1=B[j],b2=B[(j+1)%B.length]; if (segIntersects(a1,a2,b1,b2)) return true; } } if (pointInPoly(A[0],B)) return true; if (pointInPoly(B[0],A)) return true; return false; }
  function hasCollision(area){ for(const o of areas){ if (o.id!==area.id && !selectedSet.has(o.id) && polysIntersect(area.points,o.points)) return true; } return false; }
  function anyCollisionForSnapshot(snapshot, dx, dy){
    for(const [sid, pts] of snapshot.entries()){
      const moved = pts.map(p=>[p[0]+dx, p[1]+dy]);
      for(const o of areas){ if (snapshot.has(o.id)) continue; if (polysIntersect(moved, o.points)) return true; }
    }
    return false;
  }
  function firstIntersectionAlongSegment(p1,p2){ let best=null; for(const o of areas){ for(let i=0;i<o.points.length;i++){ const ip=segmentIntersectionPoint([p1[0],p1[1]],[p2[0],p2[1]],[o.points[i][0],o.points[i][1]],[o.points[(i+1)%o.points.length][0],o.points[(i+1)%o.points.length][1]]); if(ip){ const d=Math.hypot(ip.x-p1[0],ip.y-p1[1]); if(!best||d<best.d) best={pt:ip,polyId:o.id,dist:d}; } } } return best; }

  //======== Сцена ===========
  function px2r(px){ const rect = overlay.getBoundingClientRect(); const k = overlay.viewBox.baseVal.width / Math.max(1, rect.width); return px * k; }
  function toSvg(cx, cy){ const rect = overlay.getBoundingClientRect(); const x = (cx - rect.left) / Math.max(1, rect.width) * overlay.viewBox.baseVal.width; const y = (cy - rect.top)  / Math.max(1, rect.height) * overlay.viewBox.baseVal.height; return { x: Math.max(0, Math.min(x, iw)), y: Math.max(0, Math.min(y, ih)) }; }
  function centerLayers(){ const innerW = parseFloat(panInner.style.width) || panInner.clientWidth; const innerH = parseFloat(panInner.style.height) || panInner.clientHeight; const left = (innerW - iw)/2; const top  = (innerH - ih)/2; img.style.left = left+'px'; img.style.top = top+'px'; overlay.style.left = left+'px'; overlay.style.top = top+'px'; overlay.style.width = iw+'px'; overlay.style.height = ih+'px'; }
  function ensureRootLayers(){
    if (!overlay.querySelector('rect[data-bg]')){ const bg = document.createElementNS('http://www.w3.org/2000/svg','rect'); bg.dataset.bg='1'; bg.setAttribute('fill','transparent'); bg.style.pointerEvents='fill'; overlay.appendChild(bg); }
    if (!overlay.querySelector('#areas')){ const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.id='areas'; overlay.appendChild(g); }
    if (!overlay.querySelector('#handles')){ const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.id='handles'; overlay.appendChild(g); }
    if (!overlay.querySelector('#draft')){ const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.id='draft'; overlay.appendChild(g); }
    if (!overlay.querySelector('#ghosts')){ const g = document.createElementNS('http://www.w3.org/2000/svg','g'); g.id='ghosts'; overlay.appendChild(g); }
    const bg = overlay.querySelector('rect[data-bg]'); bg.setAttribute('x',0); bg.setAttribute('y',0); bg.setAttribute('width',iw); bg.setAttribute('height',ih);
  }
  function updateStageFromImage(prevMeta){
    iw = img.naturalWidth || img.width || 1000;
    ih = img.naturalHeight || img.height || 1000;
    panInner.style.width  = (iw*1.25) + 'px';
    panInner.style.height = (ih*1.25) + 'px';
    img.style.width = iw+'px'; img.style.height = ih+'px';
    overlay.setAttribute('viewBox', `0 0 ${iw} ${ih}`);
    ensureRootLayers();
    centerLayers();
    if (prevMeta && prevMeta.iw && (prevMeta.iw!==iw || prevMeta.ih!==ih)){ const sx = iw/prevMeta.iw, sy = ih/prevMeta.ih; for (const a of areas){ for (const p of a.points){ p[0]*=sx; p[1]*=sy; } } }
    renderAll();
    saveCacheFast();
  }

  //======== Кэш/экспорт ===========
  let saveTimer = 0;
  function saveCacheFast(){ const payload = { meta:{ iw, ih, savedAt:new Date().toISOString() }, areas: areas.map(a=>({ id:a.id, name:a.name, coords:a.points, color:a.colorName })), nextId }; localStorage.setItem(CACHE_KEY_FAST, JSON.stringify(payload)); }
  function saveCacheDebounced(){ clearTimeout(saveTimer); saveTimer = setTimeout(()=>{ saveCacheFast(); }, 250); }

  async function getImageDataURL(){
    try{
      if (!img || !img.src) return null;
      if (img.src.startsWith('data:')) return img.src;
      const res = await fetch(img.src, {mode:'cors'});
      const blob = await res.blob();
      const fr = new FileReader();
      return await new Promise(ok=>{ fr.onload=()=>ok(fr.result); fr.readAsDataURL(blob); });
    }catch{ return null; }
  }

  async function exportFullJson(){
    const imageData = await getImageDataURL();
    const payload = {
      meta:{ iw, ih, savedAt:new Date().toISOString() },
      areas: areas.map(a=>({ id:a.id, name:a.name, coords:a.points, color:a.colorName })),
      nextId
    };
    payload.image = { dataURL:imageData };

    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='areas.json'; a.click(); URL.revokeObjectURL(url);
  }

  function loadCache(){
    try{
      const snap = localStorage.getItem(CACHE_KEY_FAST);
      if(!snap) return null;
      const d = JSON.parse(snap);
      if (Array.isArray(d.areas)){
        areas = d.areas.map(o=>({ id:o.id, name:o.name||`Область ${o.id}`, points:o.coords.map(p=>[+p[0],+p[1]]), colorName:o.color }));
        nextId = d.nextId || (areas.reduce((m,a)=>Math.max(m,a.id),0)+1) || 1;
      }
      return d;
    }catch{ return null; }
  }

  //======== UI-хелперы ===========
  function buildPalette(){
    paletteEl.innerHTML='';
    for(const c of palette){
      const sw=document.createElement('div');
      sw.className='sw'+(c===selectedColor?' selected':'');
      sw.style.background=c.hex; sw.title=c.name;
      sw.addEventListener('click',()=>{
        selectedColor=c;
        if (selectedSet.size){
          for(const id of selectedSet){ const a=areas.find(x=>x.id===id); if(a) a.colorName = c.name; }
          renderAll(); renderList(); saveCacheDebounced();
        }
        paletteEl.querySelectorAll('.sw').forEach(el=>el.classList.remove('selected'));
        sw.classList.add('selected');
      });
      paletteEl.appendChild(sw);
    }
  }
  function clearTransient(){ overlay.querySelector('#handles').innerHTML=''; overlay.querySelector('#draft').innerHTML=''; overlay.querySelector('#ghosts').innerHTML=''; removePhantom(); hideEdgeGhost(); curCountEl.textContent = '0'; }
  function clearSelection(){ selectedSet.clear(); curIdEl.textContent='нет'; clearTransient(); renderAll(); renderList(); }

  //======== rAF рескейл ===========
  let rafRescale=0;
  function requestRescale(){ if (rafRescale) return; rafRescale = requestAnimationFrame(()=>{ rafRescale=0; rescaleOverlay(); }); }
  panInner.addEventListener('panzoomchange', requestRescale);
  window.addEventListener('resize', requestRescale);

  //======== Рендер ===========
  function rescaleOverlay(){
    const setR = (sel, pxR, sw=.9)=> overlay.querySelectorAll(sel).forEach(c=>{ c.setAttribute('r', px2r(pxR)); c.setAttribute('stroke-width', px2r(sw)); });
    setR('.handle', DOT_PX.handle, 1);
    setR('.draft-dot', DOT_PX.draft, 0.9);
    const start = overlay.querySelector('#draft circle[data-role="start"]');
    if (start){ start.setAttribute('r', px2r(draftPts.length>=3 ? DOT_PX.startBig : DOT_PX.start)); start.setAttribute('stroke-width', px2r(0.9)); }
    const ch = overlay.querySelector('.center-handle'); if (ch){ ch.setAttribute('r', px2r(DOT_PX.center)); ch.setAttribute('stroke-width', px2r(1)); }
    const eg = edgeGhost; if (eg){ eg.setAttribute('r', px2r(DOT_PX.ghost)); eg.setAttribute('stroke-width', px2r(1)); }

    overlay.querySelectorAll('.draft-line').forEach(l=> l.setAttribute('stroke-width', px2r(LINE_PX.draft)));
    overlay.querySelectorAll('#draft line').forEach(l=> l.setAttribute('stroke-width', px2r(LINE_PX.phantom)));
  }

  function flashRed(el){ if(!el) return; const f=el.getAttribute('fill')||''; const s=el.getAttribute('stroke')||''; el.setAttribute('fill','#ffdddd'); el.setAttribute('stroke','#ff0000'); setTimeout(()=>{ el.setAttribute('fill',f); el.setAttribute('stroke',s); },220); }

  //======== Полигон DOM ===========
  function ensureAreaElement(a){
    if (areaEls.has(a.id)) return areaEls.get(a.id);
    const g    = document.createElementNS('http://www.w3.org/2000/svg','g');
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    const hit  = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.classList.add('poly');
    poly.dataset.id = a.id;
    hit.setAttribute('fill','none');
    hit.setAttribute('stroke','rgba(0,0,0,0)');
    hit.style.pointerEvents='stroke';
    hit.setAttribute('stroke-width', 16);

    const onDown = ev => {
      if (isDrawing || ev.button !== 0) return;
      ev.stopPropagation();
      if (!ev.shiftKey){
        if (!selectedSet.has(a.id)){ selectedSet.clear(); selectedSet.add(a.id); }
      } else {
        if (selectedSet.has(a.id)) selectedSet.delete(a.id); else selectedSet.add(a.id);
      }
      renderAll(); renderList();
    };

    poly.addEventListener('pointerdown', onDown);
    hit .addEventListener('pointerdown', onDown);

    overlay.querySelector('#areas').appendChild(g);
    g.appendChild(hit);
    g.appendChild(poly);

    const pack = { g, poly, hit };
    areaEls.set(a.id, pack);
    return pack;
  }

  function updatePoly(a){
    const {poly, hit} = ensureAreaElement(a);
    const pts = a.points.map(p=>p.join(',')).join(' ');
    poly.setAttribute('points', pts);
    hit.setAttribute('points', pts);
  }

  function renderAll(){
    ensureRootLayers();
    for (const a of areas){
      const {poly} = ensureAreaElement(a);
      updatePoly(a);
      const hex = (palette.find(c=>c.name===a.colorName)||{hex:'#fff'}).hex;
      poly.setAttribute('fill', hex);
      poly.setAttribute('stroke', selectedSet.has(a.id)?'#000':'#666');
      poly.setAttribute('stroke-width', selectedSet.has(a.id)?3:1.5);
      poly.classList.toggle('selected', selectedSet.has(a.id));
    }
    for (const [id, els] of [...areaEls.entries()]){
      if (!areas.find(a=>a.id===id)){ els.g.remove(); areaEls.delete(id); }
    }
    showHandlesForSelection();
    requestRescale();
    curIdEl.textContent = selectedSet.size ? [...selectedSet].join(',') : 'нет';
    if (isDrawing) curCountEl.textContent = String(draftPts.length);
    else if (selectedSet.size===1){
      const sid=[...selectedSet][0]; const a=areas.find(x=>x.id===sid);
      curCountEl.textContent = String(a?.points.length||0);
    } else curCountEl.textContent = '0';

    renderControls();
    renderHints();
  }

  //======== Хэндлы ===========
  function showHandlesForSelection(){
    if (isDrawing) return;
    const g = overlay.querySelector('#handles'); g.innerHTML='';
    if (selectedSet.size===0) return;

    if (selectedSet.size===1){
      const sid=[...selectedSet][0]; const area=areas.find(x=>x.id===sid);
      area.points.forEach((p, idx)=>{
        const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
        c.classList.add('handle'); c.dataset.idx = idx;
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
        c.setAttribute('r', px2r(DOT_PX.handle)); c.setAttribute('fill','#fff'); c.setAttribute('stroke','#333');
        let dragging=false,last={x:0,y:0};
        c.addEventListener('pointerdown', ev=>{ if (ev.button!==0) return; ev.stopPropagation(); dragging=true; last={x:ev.clientX,y:ev.clientY}; panInner.classList.add('cursor-move'); c.setPointerCapture(ev.pointerId); });
        c.addEventListener('pointermove', ev=>{
          if (!dragging) return;
          const cur=toSvg(ev.clientX,ev.clientY), prev=toSvg(last.x,last.y);
          let dx=cur.x-prev.x, dy=cur.y-prev.y; if(ev.shiftKey){dx*=.1;dy*=.1;}
          const vb=overlay.viewBox.baseVal; const old=[area.points[idx][0],area.points[idx][1]];
          area.points[idx][0]=Math.max(0,Math.min(old[0]+dx,vb.width));
          area.points[idx][1]=Math.max(0,Math.min(old[1]+dy,vb.height));
          if (hasCollision(area)){ area.points[idx][0]=old[0]; area.points[idx][1]=old[1]; flashRed(c); }
          else { updatePoly(area); c.setAttribute('cx',area.points[idx][0]); c.setAttribute('cy',area.points[idx][1]); }
          last={x:ev.clientX,y:ev.clientY};
        });
        c.addEventListener('pointerup', ev=>{ dragging=false; panInner.classList.remove('cursor-move'); try{c.releasePointerCapture(ev.pointerId);}catch{} saveCacheDebounced(); renderAll(); });
        g.appendChild(c);
      });
    }

    const selectedAreas = [...selectedSet].map(id=>areas.find(a=>a.id===id));
    if (selectedAreas.length){
      const pts = selectedAreas.flatMap(a=>a.points);
      const bb = pts.reduce((acc,p)=>({minX:Math.min(acc.minX,p[0]),maxX:Math.max(acc.maxX,p[0]),minY:Math.min(acc.minY,p[1]),maxY:Math.max(acc.maxY,p[1])}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
      const cx=(bb.minX+bb.maxX)/2, cy=(bb.minY+bb.maxY)/2;
      const cc=document.createElementNS('http://www.w3.org/2000/svg','circle'); cc.classList.add('center-handle'); cc.setAttribute('cx',cx); cc.setAttribute('cy',cy); cc.setAttribute('r', px2r(DOT_PX.center));
      let dragAll=false, origin={x:0,y:0}, snapshot=null;
      cc.addEventListener('pointerdown', ev=>{ if(ev.button!==0) return; ev.stopPropagation(); dragAll=true; origin={x:ev.clientX,y:ev.clientY}; snapshot=new Map(selectedAreas.map(a=>[a.id,a.points.map(p=>[p[0],p[1]])])); panInner.classList.add('cursor-move'); cc.setPointerCapture(ev.pointerId); });
      cc.addEventListener('pointermove', ev=>{
        if(!dragAll) return;
        let dx=(ev.clientX-origin.x)/getScale();
        let dy=(ev.clientY-origin.y)/getScale();
        const sens = ev.shiftKey ? 0.1 : 1;
        dx*=sens; dy*=sens;
        if(anyCollisionForSnapshot(snapshot,dx,dy)) return;
        for (const [sid, pts] of snapshot.entries()) {
          const a = areas.find(x=>x.id===sid);
          for (let i=0;i<pts.length;i++) { a.points[i][0] = pts[i][0] + dx; a.points[i][1] = pts[i][1] + dy; }
          updatePoly(a);
        }
        if (selectedSet.size === 1) {
          const sid = [...selectedSet][0];
          const a = areas.find(x=>x.id===sid);
          overlay.querySelectorAll('#handles .handle').forEach(n=>{
            const idx = +n.dataset.idx;
            n.setAttribute('cx', a.points[idx][0]);
            n.setAttribute('cy', a.points[idx][1]);
          });
        }
        cc.setAttribute('cx', cx + dx);
        cc.setAttribute('cy', cy + dy);
      });
      cc.addEventListener('pointerup', ev=>{ dragAll=false; panInner.classList.remove('cursor-move'); try{cc.releasePointerCapture(ev.pointerId);}catch{} saveCacheDebounced(); renderAll(); });
      overlay.querySelector('#handles').appendChild(cc);
    }
    requestRescale();
  }

  //======== Черновик ===========
  function renderDraft(){
    const g = overlay.querySelector('#draft'); g.innerHTML='';
    if (draftPts.length===0) return;
    const pl=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    pl.setAttribute('points', draftPts.map(p=>p.join(',')).join(' '));
    pl.setAttribute('class','draft-line');
    g.appendChild(pl);
    draftPts.forEach((p,i)=>{
      const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',p[0]); c.setAttribute('cy',p[1]);
      c.dataset.role = i===0 ? 'start' : 'pt';
      c.setAttribute('fill', i===0 ? '#22c55e' : '#fff');
      c.setAttribute('class','draft-dot');
      c.setAttribute('stroke','#333');
      if (i===0){
        let fCand=null;
        c.style.cursor='pointer';
        c.addEventListener('pointerdown', ev=>{ if (ev.button!==0) return; ev.stopPropagation(); fCand = {x:ev.clientX, y:ev.clientY, moved:false}; c.setPointerCapture?.(ev.pointerId); });
        c.addEventListener('pointermove', ev=>{ if (!fCand) return; if (!fCand.moved && (Math.abs(ev.clientX-fCand.x)>6 || Math.abs(ev.clientY-fCand.y)>6)) fCand.moved=true; });
        c.addEventListener('pointerup', ev=>{ if (!fCand) return; if (!fCand.moved && draftPts.length>=3) finalizeDraft(); try{c.releasePointerCapture?.(ev.pointerId);}catch{} fCand=null; });
      }
      g.appendChild(c);
    });
    ensurePhantom();
    requestRescale();
  }

  function ensurePhantom(){
    const d = overlay.querySelector('#draft');
    if(!phantom){ phantom=document.createElementNS('http://www.w3.org/2000/svg','circle'); phantom.setAttribute('class','draft-dot'); phantom.setAttribute('fill','rgba(255,0,0,0.85)'); phantom.style.pointerEvents='none'; d.appendChild(phantom); }
    if(!phantomLine){ phantomLine=document.createElementNS('http://www.w3.org/2000/svg','line'); phantomLine.setAttribute('class','ghost-line'); phantomLine.style.pointerEvents='none'; d.appendChild(phantomLine); }
    if(!phantomLineStart){ phantomLineStart=document.createElementNS('http://www.w3.org/2000/svg','line'); phantomLineStart.setAttribute('class','ghost-line'); phantomLineStart.style.pointerEvents='none'; d.appendChild(phantomLineStart); }
  }
  function removePhantom(){ if(phantom){phantom.remove(); phantom=null;} if(phantomLine){phantomLine.remove(); phantomLine=null;} if(phantomLineStart){phantomLineStart.remove(); phantomLineStart=null;} }

  //======== Рисование ===========
  function startDrawing(){ isDrawing=true; draftPts=[]; clearSelection(); renderAll(); }
  function cancelDrawing(){ draftPts=[]; clearTransient(); isDrawing=false; renderAll(); }
  function finalizeDraft(){
    if (draftPts.length<3){ cancelDrawing(); return; }
    const newA={ id: nextId++, name:`Область ${nextId-1}`, points: draftPts.slice(), colorName: selectedColor.name };
    areas.push(newA);
    if (hasCollision(newA)){ for(const o of areas){ if(o.id!==newA.id && polysIntersect(newA.points,o.points)){ const els=areaEls.get(o.id); flashRed(els?.poly); } } areas=areas.filter(a=>a.id!==newA.id); }
    else { saveCacheDebounced(); }
    cancelDrawing(); renderList();
  }
  function addDraftPtFromMouse(cx,cy){
    const pt=toSvg(cx,cy);
    if (draftPts.length){
      const last=draftPts[draftPts.length-1];
      const inter=firstIntersectionAlongSegment(last,[pt.x,pt.y]);
      if(inter){
        const vx=inter.pt.x-last[0], vy=inter.pt.y-last[1]; const len=Math.hypot(vx,vy)||1; const safe=Math.max(0,len-1);
        draftPts.push([Math.round(last[0]+vx/len*safe), Math.round(last[1]+vy/len*safe)]);
        const els=areaEls.get(inter.polyId); flashRed(els?.poly);
      } else {
        draftPts.push([Math.round(pt.x),Math.round(pt.y)]);
      }
    } else {
      draftPts.push([Math.round(pt.x),Math.round(pt.y)]);
    }
    curCountEl.textContent=String(draftPts.length); renderDraft();
  }

  //======== Вставка/удаление вершин ===========
  function nearestEdgeIndex(points,x,y){ let best={idx:-1,dist:Infinity,proj:[x,y]}; for(let i=0;i<points.length;i++){ const a=points[i], b=points[(i+1)%points.length]; const ax=a[0],ay=a[1],bx=b[0],by=b[1]; const dx=bx-ax, dy=by-ay; const len2=dx*dx+dy*dy||1; let t=((x-ax)*dx+(y-ay)*dy)/len2; t=Math.max(0,Math.min(1,t)); const px=ax+t*dx, py=ay+t*dy; const d=Math.hypot(px-x,py-y); if(d<best.dist) best={idx:i,dist:d,proj:[px,py]}; } return best; }
  function insertVertexAtPoint(a, proj){ const e=nearestEdgeIndex(a.points, proj[0], proj[1]); const insertIdx=(e.idx+1)%a.points.length; a.points.splice(insertIdx,0,[Math.round(proj[0]),Math.round(proj[1])]); updatePoly(a); renderAll(); renderList(); saveCacheDebounced(); }
  function deleteVertexAtHandle(a, idx){ if(a.points.length<=3) return; a.points.splice(idx,1); updatePoly(a); renderAll(); renderList(); saveCacheDebounced(); }

  //======== Edge ghost (только точка) ===========
  function ensureEdgeGhost(){
    const g = overlay.querySelector('#ghosts');
    if (!edgeGhost){ edgeGhost = document.createElementNS('http://www.w3.org/2000/svg','circle'); edgeGhost.setAttribute('class','ghost-dot'); g.appendChild(edgeGhost); }
  }
  function hideEdgeGhost(){ overlay.querySelector('#ghosts').innerHTML=''; edgeGhost=null; }
  function showEdgeGhost(px,py){
    ensureEdgeGhost();
    edgeGhost.setAttribute('cx', px); edgeGhost.setAttribute('cy', py);
    requestRescale();
  }

  //======== События overlay ===========
  overlay.addEventListener('pointermove', ev=>{
    const mp=toSvg(ev.clientX,ev.clientY);

    if(isDrawing){
      ensurePhantom();
      if(draftPts.length){
        const last=draftPts[draftPts.length-1];
        const inter=firstIntersectionAlongSegment(last,[mp.x,mp.y]);
        let tx=mp.x,ty=mp.y;
        if(inter){
          const vx=inter.pt.x-last[0], vy=inter.pt.y-last[1]; const len=Math.hypot(vx,vy)||1; const safe=Math.max(0,len-1);
          tx=last[0]+(vx/len)*safe; ty=last[1]+(vy/len)*safe;
        }
        phantom.setAttribute('cx',tx); phantom.setAttribute('cy',ty);
        phantomLine.setAttribute('x1',last[0]); phantomLine.setAttribute('y1',last[1]); phantomLine.setAttribute('x2',tx); phantomLine.setAttribute('y2',ty);
        const s=draftPts[0]; if(s){ phantomLineStart.setAttribute('x1',s[0]); phantomLineStart.setAttribute('y1',s[1]); phantomLineStart.setAttribute('x2',tx); phantomLineStart.setAttribute('y2',ty); }
      } else {
        phantom.setAttribute('cx',mp.x); phantom.setAttribute('cy',mp.y);
        phantomLine.setAttribute('x1',mp.x); phantomLine.setAttribute('y1',mp.y); phantomLine.setAttribute('x2',mp.x); phantomLine.setAttribute('y2',mp.y);
        phantomLineStart.setAttribute('x1',mp.x); phantomLineStart.setAttribute('y1',mp.y); phantomLineStart.setAttribute('x2',mp.x); phantomLineStart.setAttribute('y2',mp.y);
      }
      return;
    }

    if (selectedSet.size===1){
      const sid=[...selectedSet][0]; const a=areas.find(x=>x.id===sid); if(!a) return;
      const tolHandle = px2r(DOT_PX.handle*1.2);
      const nearVertex = a.points.some(pt => Math.hypot(pt[0]-mp.x, pt[1]-mp.y) <= tolHandle);
      const bb = a.points.reduce((acc,p)=>({minX:Math.min(acc.minX,p[0]),maxX:Math.max(acc.maxX,p[0]),minY:Math.min(acc.minY,p[1]),maxY:Math.max(acc.maxY,p[1])}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
      const cx=(bb.minX+bb.maxX)/2, cy=(bb.minY+bb.maxY)/2;
      const nearCenter = Math.hypot(mp.x-cx, mp.y-cy) <= px2r(DOT_PX.center*1.2);

      const e=nearestEdgeIndex(a.points, mp.x, mp.y);
      const tolEdge = px2r(12); // 12px
      if (!nearVertex && !nearCenter && e.dist <= tolEdge){
        showEdgeGhost(e.proj[0], e.proj[1]);
      } else {
        hideEdgeGhost();
      }
    } else {
      hideEdgeGhost();
    }
  });

  overlay.addEventListener('pointerdown', ev => {
    if (isDrawing && ev.button === 0) clickCand = { x: ev.clientX, y: ev.clientY, moved: false };
  });
  window.addEventListener('pointermove', ev => {
    if (!clickCand) return;
    if (!clickCand.moved) {
      const dx = ev.clientX - clickCand.x;
      const dy = ev.clientY - clickCand.y;
      if (Math.abs(dx) > CLICK_TOL_PX || Math.abs(dy) > CLICK_TOL_PX) clickCand.moved = true;
    }
  });
  window.addEventListener('pointerup', ev => {
    if (!clickCand) return;
    if (isDrawing && ev.button === 0 && !clickCand.moved) addDraftPtFromMouse(ev.clientX, ev.clientY);
    clickCand = null;
  });
  window.addEventListener('pointercancel', () => { clickCand = null; });

  overlay.addEventListener('pointerdown', ev=>{
    if (isDrawing || ev.button!==1) return;
    ev.preventDefault(); ev.stopPropagation();
    if (selectedSet.size!==1) return;
    const sid=[...selectedSet][0]; const a=areas.find(x=>x.id===sid); if(!a) return;

    const p=toSvg(ev.clientX,ev.clientY);
    const idx = a.points.reduce((best,pt,i)=>{ const d=Math.hypot(pt[0]-p.x, pt[1]-p.y); return (d<best.d? {i,d} : best); }, {i:-1,d:Infinity}).i;
    const tolHandle = px2r(DOT_PX.handle)*1.4;
    if (idx>=0 && Math.hypot(a.points[idx][0]-p.x, a.points[idx][1]-p.y) <= tolHandle && a.points.length>3){
      deleteVertexAtHandle(a, idx); saveCacheDebounced(); return;
    }
    const e=nearestEdgeIndex(a.points,p.x,p.y);
    insertVertexAtPoint(a, e.proj);
  });

  //======== Клик по фону снимает выделение ===========
  let bgClick = null;
  function bindBgClearSelection(){
    const bg = overlay.querySelector('rect[data-bg]');
    if (!bg) return;
    bg.addEventListener('pointerdown', ev=>{
      if (isDrawing || ev.button!==0) return;
      bgClick = {x:ev.clientX, y:ev.clientY, moved:false};
    });
    window.addEventListener('pointermove', ev=>{
      if (!bgClick) return;
      if (!bgClick.moved && (Math.abs(ev.clientX-bgClick.x)>6 || Math.abs(ev.clientY-bgClick.y)>6)) bgClick.moved=true;
    });
    bg.addEventListener('pointerup', ev=>{
      if (!bgClick) return;
      if (!isDrawing && ev.button===0 && !bgClick.moved){ clearSelection(); }
      bgClick=null;
    });
    window.addEventListener('pointercancel', ()=> bgClick=null);
  }

  //======== Клавиши ===========
  window.addEventListener('keydown', ev=>{
    const key = ev.key.toLowerCase();
    if (ev.key==='Control' && !ev.repeat && !isDrawing){ drawingByCtrl = true; startDrawing(); }
    if (isDrawing && ev.key==='Escape'){ cancelDrawing(); drawingByCtrl=false; }
    if (isDrawing && ev.key==='Enter'){ finalizeDraft(); drawingByCtrl=false; }
    if (!isDrawing && key==='delete'){ if (selectedSet.size){ areas = areas.filter(a=>!selectedSet.has(a.id)); clearSelection(); saveCacheDebounced(); } }
    if (!isDrawing && ev.key === '+'){ if (selectedSet.size>1) mergeSelectedAsHull(); }
  });
  window.addEventListener('keyup', ev=>{
    if (ev.key==='Control' && drawingByCtrl){
      if (isDrawing){ if (draftPts.length>=3) finalizeDraft(); else cancelDrawing(); }
      drawingByCtrl=false;
    }
  });

  //======== Контекстная панель ===========
  function uiMode(){
    if (isDrawing) return 'drawing';
    if (selectedSet.size > 1) return 'multi';
    if (selectedSet.size === 1) return 'single';
    return 'idle';
  }
  function renderControls(){
    const mode = uiMode();
    modeLabel.textContent =
      mode==='drawing' ? 'рисование' :
      mode==='single'  ? '1 область' :
      mode==='multi'   ? 'несколько' : 'ожидание';

    const btn = (id, text, kind='primary', disabled=false) =>
      `<button id="${id}" class="${kind==='secondary'?'secondary':''} ${kind==='danger'?'danger':''}" ${disabled?'disabled':''}>${text}</button>`;

    let html = '';
    html += `<div class="row-1" style="display:flex; flex-wrap:wrap; gap:8px;">
      ${btn('btnImg','Загрузить изображение','secondary')}
      ${btn('btnLoad','Загрузить JSON','secondary')}
      ${btn('btnSave','Сохранить JSON','secondary')}
      ${btn('btnToggleDraw', isDrawing ? 'Завершить рисование' : 'Начать рисование', 'primary')}
    </div>`;

    if (mode==='multi'){
      html += `<div>${btn('btnMerge','Объединить области')}</div>`;
    }

    if (!isDrawing && selectedSet.size>0){
      html += `<div>${btn('btnDeleteArea','Удалить','danger')}</div>`;
    }

    controlsEl.innerHTML = html;

    const byId = id => controlsEl.querySelector('#'+id);
    byId('btnToggleDraw')?.addEventListener('click', ()=> isDrawing ? finalizeDraft() : startDrawing());
    byId('btnSave')?.addEventListener('click', exportFullJson);
    byId('btnLoad')?.addEventListener('click', ()=>{
      const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
      inp.addEventListener('change', e=>{
        const f=e.target.files[0]; if(!f) return;
        const fr=new FileReader();
        fr.onload=()=>{
          try{
            const d=JSON.parse(fr.result);
            const prevMeta = d.meta && (d.meta.iw||d.meta.ih) ? { iw:d.meta.iw, ih:d.meta.ih } : null;
            const arr = Array.isArray(d)? d : (Array.isArray(d.areas)? d.areas : []);
            areas = arr.map(o=>({ id:o.id, name:o.name||`Область ${o.id}`, points:o.coords, colorName:o.color }));
            nextId=(areas.reduce((m,a)=>Math.max(m,a.id),0)||0)+1;
            clearSelection(); updateStageFromImage(prevMeta); renderList(); saveCacheFast();
          }catch{}
        };
        fr.readAsText(f,'utf-8');
      });
      inp.click();
    });
    byId('btnImg')?.addEventListener('click', ()=> imgFile.click());
    byId('btnDeleteArea')?.addEventListener('click', ()=>{
      if (!selectedSet.size) return;
      areas = areas.filter(a=>!selectedSet.has(a.id));
      clearSelection(); saveCacheDebounced();
    });
    byId('btnMerge')?.addEventListener('click', ()=> mergeSelectedAsHull());
  }

  function renderHints(){
    const mode = uiMode();
    let html='';
    if (mode==='drawing'){
      html = `
        <span class="kbd">ЛКМ</span> — поставить точку. Нажмите на <span class="kbd">первую точку</span> или <span class="kbd">Enter</span>, чтобы завершить.<br/>
        <span class="kbd">Esc</span> — отменить рисование. Линия-«резинка» всегда тянется от последней точки к курсору.
      `;
    } else if (mode==='single'){
      html = `
        Перетаскивайте вершины (белые точки). Удерживайте <span class="kbd">Shift</span> для точного шага.<br/>
        Синяя точка в центре — перенос области. <span class="kbd">Средняя кнопка</span> по границе — добавить вершину; по вершине — удалить.
      `;
    } else if (mode==='multi'){
      html = `
        Выделяйте с <span class="kbd">Shift+клик</span>, переносите за синюю центральную точку. <span class="kbd">+</span> — объединить или кнопка выше.
      `;
    } else {
      html = `
        <span class="kbd">ЛКМ</span> по области — выделение. <span class="kbd">Shift+клик</span> — мультивыделение. <span class="kbd">Ctrl</span> — начать рисование.
      `;
    }
    hintsEl.innerHTML = html;
  }

  //======== Список областей ===========
  function renderList(){
    areasList.innerHTML='';
    if(areas.length===0){ areasList.textContent='Нет областей'; return; }
    areas.slice().reverse().forEach(a=>{
      const div=document.createElement('div');
      div.className='area-item'+(selectedSet.has(a.id)?' selected':'');
      div.innerHTML=`<div class="row"><input class="name-input" value="${a.name||('Область '+a.id)}" data-id="${a.id}" title="Название области"/></div>
      <div class="row"><div class="mini" style="background:${(palette.find(c=>c.name===a.colorName)||{hex:'#fff'}).hex}"></div>
      <button class="secondary" data-id="${a.id}" data-act="sel">Выбрать</button>
      <button class="danger" data-id="${a.id}" data-act="del">Удалить</button></div>`;
      areasList.appendChild(div);
    });
    areasList.querySelectorAll('button').forEach(b=> b.addEventListener('click', ev=>{
      const id=+ev.currentTarget.dataset.id; const act=ev.currentTarget.dataset.act;
      if(act==='sel'){ selectedSet.clear(); selectedSet.add(id); clearTransient(); renderAll(); renderList(); }
      else if(act==='del'){ areas=areas.filter(o=>o.id!==id); selectedSet.delete(id); renderAll(); renderList(); saveCacheDebounced(); }
    }));
    areasList.querySelectorAll('.name-input').forEach(inp=> inp.addEventListener('change', e=>{
      const id=+e.currentTarget.dataset.id; const a=areas.find(x=>x.id===id); if(a){ a.name = e.currentTarget.value.trim()||`Область ${a.id}`; saveCacheDebounced(); }
    }));
  }

  //======== Объединение (выпуклая оболочка) ===========
  function mergeSelectedAsHull(){
    if (selectedSet.size < 2) return;
    const pts = [...selectedSet].flatMap(id=>areas.find(a=>a.id===id)?.points||[]);
    if (pts.length < 3) return;
    const hull = convexHull(pts);
    const color = areas.find(a=>selectedSet.has(a.id))?.colorName || selectedColor.name;
    const name = 'Группа ('+[...selectedSet].join(',')+')';
    const newA = { id: nextId++, name, points: hull, colorName: color };
    const oldIds = new Set(selectedSet);
    const others = areas.filter(a=>!oldIds.has(a.id));
    for (const o of others){ if (polysIntersect(hull, o.points)){ const els=areaEls.get(o.id); flashRed(els?.poly); return; } }
    areas = [...others, newA]; selectedSet = new Set([newA.id]); renderAll(); renderList(); saveCacheDebounced();
  }
  function convexHull(points){
    const pts = points.map(p=>({x:p[0],y:p[1]})).sort((a,b)=>a.x===b.x? a.y-b.y : a.x-b.x);
    if (pts.length<=3) return pts.map(p=>[p.x,p.y]);
    const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    const lower=[]; for (const p of pts){ while(lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop(); lower.push(p);}
    const upper=[]; for (let i=pts.length-1;i>=0;i--){ const p=pts[i]; while(upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop(); upper.push(p);}
    upper.pop(); lower.pop(); const hull=[...lower,...upper]; return hull.map(p=>[p.x,p.y]);
  }

  //======== Загрузка изображения ===========
  imgFile.addEventListener('change', e=>{
    const f = e.target.files[0]; if(!f) return;
    const url = URL.createObjectURL(f);
    const prevMeta = { iw, ih };
    img.onload=()=>{ updateStageFromImage(prevMeta); };
    img.src = url; clearSelection();
  });

  //======== Init ===========
  function buildRoots(){ ensureRootLayers(); bindBgClearSelection(); renderAll(); }
  function init(){
    buildPalette();
    const cached = loadCache();
    const prevMeta = cached?.meta ? { iw:cached.meta.iw, ih:cached.meta.ih } : null;
    img.onload = ()=>{ updateStageFromImage(prevMeta); renderList(); renderControls(); renderHints(); };
    img.src = src || '';
    if (!src){ updateStageFromImage(prevMeta); renderList(); renderControls(); renderHints(); }
    buildRoots();
  }
  init();