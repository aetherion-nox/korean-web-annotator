(() => {
  const VERSION = '1.0.3';
  if (globalThis.__KRA_CONTENT_SCRIPT_VERSION__ === VERSION) return;
  globalThis.__KRA_CONTENT_SCRIPT_VERSION__ = VERSION;
  globalThis.__KOREAN_RUBY_ANNOTATOR_LOADED__ = true;
  const OWN_RUBY = 'ruby[kra-annotated="true"]';
  const MAX_ENTRIES = 3000;
  let currentTask = null;
  let sequence = 0;
  let uiSettings = { mobileSelectionToolbar: true, hanjaMode: true, loanwordMode: true, copyMode: 'hangul' };
  let toolbar = null;
  let toolbarDismissed = false;
  let selectionSnapshot = null;
  let selectionTimer = null;
  let pageCompleted = false;
  let pageHasHangul = false;
  let automaticObserver = null;
  let automaticTimer = null;
  const seenSources = new Set();
  const history = [];
  const diagnostics = [];

  function captureSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return null;
    const ranges = Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange());
    return ranges.length ? ranges : null;
  }

  function selectedIntervals(node, text, ranges, isRuby) {
    if (!ranges) return [{start:0,end:text.length}];
    const intervals=[];
    for(const range of ranges){
      if(!range.intersectsNode(node))continue;
      if(isRuby){intervals.push({start:0,end:text.length});continue;}
      const start=range.startContainer===node?range.startOffset:0;
      const end=range.endContainer===node?range.endOffset:text.length;
      if(end>start)intervals.push({start,end});
    }
    return intervals;
  }

  function applySettings(settings) {
    uiSettings={...uiSettings,...settings};
    if(Object.hasOwn(settings,'copyMode'))uiSettings.selectAnnotations=false;
    if(!Object.hasOwn(settings,'copyMode')&&Object.hasOwn(settings,'copyOriginalHangul'))uiSettings.copyMode=settings.copyOriginalHangul?'hangul':'base';
    if(!['base','annotated','hangul','annotation'].includes(uiSettings.copyMode))uiSettings.copyMode='hangul';
    document.documentElement.toggleAttribute('data-kra-select-annotations',['annotated','annotation'].includes(uiSettings.copyMode)||uiSettings.selectAnnotations===true);
    document.documentElement.toggleAttribute('data-kra-select-hangul',uiSettings.copyMode==='hangul');
    document.documentElement.setAttribute('data-kra-copy-mode',uiSettings.copyMode);
    refreshToolbar();
    configureAutomaticAnnotation();
  }

  function selectionHasHangul(ranges) {
    const hangul = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;
    return Boolean(ranges?.some(range => {
      const fragment = range.cloneContents();
      if(hangul.test(fragment.textContent || ''))return true;
      // A selection of the converted base still represents the original Korean.
      if(Array.from(fragment.querySelectorAll(OWN_RUBY)).some(ruby => hangul.test(ruby.getAttribute('data-kra-original') || '')))return true;
      const container = range.commonAncestorContainer;
      const parent = container.nodeType === 1 ? container : container.parentElement;
      return hangul.test(parent?.closest(OWN_RUBY)?.getAttribute('data-kra-original') || '');
    }));
  }

  function refreshToolbar() {
    if(!document.body)return;
    const selected=captureSelection();
    if(selected)selectionSnapshot=selected;
    const always = uiSettings.toolbarDisplay === 'always';
    const eligible = uiSettings.toolbarHangulOnly === false ||
      (always ? pageHasHangul : selectionHasHangul(selected));
    const show=!toolbarDismissed&&uiSettings.mobileSelectionToolbar!==false&&
      (currentTask||(eligible&&(always||Boolean(selected))));
    if(!toolbar&&!show)return;
    const bar=getToolbar();bar.hidden=!show;
    for(const button of bar.querySelectorAll('.kra-mobile-primary,.kra-mobile-review'))button.disabled=!selected&&!selectionSnapshot;
  }

  function addDiagnostic(item) {
    diagnostics.push(item);if(diagnostics.length>300)diagnostics.shift();
    const list=document.querySelector('.kra-diagnostics ol');
    if(list){const li=document.createElement('li');li.textContent=[item.message,item.detail].filter(Boolean).join('\n');list.append(li);while(list.children.length>300)list.firstChild.remove();}
  }

  function toggleDiagnostics() {
    let panel=document.querySelector('.kra-diagnostics');
    if(panel){panel.hidden=!panel.hidden;return;}
    panel=document.createElement('div');panel.className='kra-diagnostics';
    const close=document.createElement('button');close.textContent='关闭诊断';close.onclick=()=>panel.hidden=true;
    const list=document.createElement('ol');for(const item of diagnostics){const li=document.createElement('li');li.textContent=[item.message,item.detail].filter(Boolean).join('\n');list.append(li);}
    panel.append(close,list);document.body.append(panel);
  }

  function configureAutomaticAnnotation() {
    if(automaticObserver){automaticObserver.disconnect();automaticObserver=null;}
    clearTimeout(automaticTimer);
    if(!pageCompleted||uiSettings.stopAutoAfterPageComplete!==false||!document.body)return;
    // Optional NEW text only. Previously processed source is never repaint-restored.
    automaticObserver=new MutationObserver(records=>{
      const relevant=records.some(record=>{
        const parent=record.target.nodeType===1?record.target:record.target.parentElement;
        if(parent?.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics,script,style'))return false;
        const nodes=record.type==='characterData'?[record.target]:Array.from(record.addedNodes);
        return nodes.some(node=>!node.matches?.(OWN_RUBY)&&!node.querySelector?.(OWN_RUBY)&&/[가-힣]/u.test(node.textContent||''));
      });
      if(!relevant)return;
      clearTimeout(automaticTimer);automaticTimer=setTimeout(()=>{if(!currentTask)startAnnotation({automatic:true,modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true}})},900);
    });
    automaticObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  }

  document.addEventListener('selectionchange',()=>{
    if(!currentTask&&captureSelection())toolbarDismissed=false;
    clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{refreshToolbar();publishState()},120);
  });
  document.addEventListener('contextmenu',publishState,{capture:true});

  document.addEventListener('copy',event=>{
    if(!event.clipboardData)return;
    const mode=uiSettings.copyMode;
    const ranges=captureSelection();if(!ranges)return;
    let replaced=false;
    const readings=[];
    const parts=ranges.map(range=>{
      const fragment=range.cloneContents();
      const originals=Array.from(document.querySelectorAll(OWN_RUBY)).filter(r=>range.intersectsNode(r));
      const clones=Array.from(fragment.querySelectorAll(OWN_RUBY));
      // A range contained inside a ruby has no ruby wrapper in its fragment.
      const container=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
      const containing=container?.closest(OWN_RUBY);
      function originalText(ruby){
        const text=ruby.getAttribute('data-kra-original')||'';
        let start=0,end=text.length;
        const endpoint=(node,offset)=>{
          if(node.nodeType!==3||!ruby.contains(node))return null;
          if(node.parentElement.closest('rt')&&ruby.getAttribute('data-kra-type')==='loanword')return null;
          return offset;
        };
        const a=endpoint(range.startContainer,range.startOffset),b=endpoint(range.endContainer,range.endOffset);
        if(a!==null)start=a;if(b!==null)end=b;
        return text.slice(start,end);
      }
      function converted(ruby,clone){
        const base=Array.from(ruby.childNodes).filter(n=>n.nodeName!=='RT').map(n=>n.textContent).join('');
        const reading=ruby.querySelector('rt')?.textContent||'';
        readings.push(reading);
        if(mode==='hangul')return originalText(ruby);
        const partial=clone?Array.from(clone.childNodes).filter(n=>n.nodeName!=='RT').map(n=>n.textContent).join(''):base;
        if(mode==='annotation')return reading;
        if(mode==='annotated')return `${partial}(${reading})`;
        if(containing&&range.startContainer.nodeType===3&&!range.startContainer.parentElement.closest('rt'))return base.slice(range.startOffset,range.endContainer===range.startContainer?range.endOffset:base.length);
        return partial;
      }
      if(containing){replaced=true;return converted(containing);}
      clones.forEach((ruby,i)=>{replaced=true;ruby.replaceWith(document.createTextNode(converted(originals[i]||ruby,ruby)))});
      // Retain paragraph boundaries in plain-text clipboard output.
      for(const br of fragment.querySelectorAll('br'))br.replaceWith('\n');
      for(const block of fragment.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6'))block.append('\n');
      return fragment.textContent;
    });
    if(replaced){event.clipboardData.setData('text/plain',mode==='annotation'?readings.filter(Boolean).join(' '):parts.join('\n'));event.preventDefault();}
  });

  // Furiganator's TreeWalker -> conversion Map -> single fragment insertion pass.
  // Korean rt contains Hangul, so exclude the entire ruby subtree on later runs.
  function collectTextNodes(ranges=null, includeOwned=false, automatic=false) {
    const entries = new Map();
    if (!document.body) return entries;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/[가-힣]/u.test(node.data) || !/\S/u.test(node.data)) return NodeFilter.FILTER_REJECT;
        if (['TEXTAREA', 'RUBY', 'RT', 'INPUT', 'SCRIPT', 'NOSCRIPT', 'SELECT', 'OPTION', 'STYLE'].includes(node.parentNode?.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode()) && entries.size < MAX_ENTRIES) {
      const selected=selectedIntervals(node,node.data,ranges,false);
      if(!selected.length||automatic&&seenSources.has(node.data))continue;
      entries.set(node, { node, text: node.data, annotations: [], selected, id: String(entries.size) });
    }
    if(includeOwned)for(const node of document.querySelectorAll(OWN_RUBY)){
      if(entries.size>=MAX_ENTRIES)break;
      const text=node.dataset.kraOriginal||'';
      const selected=selectedIntervals(node,text,ranges,true);
      if(!text||!selected.length)continue;
      entries.set(node,{node,text,annotations:[],selected,isRuby:true,originalHTML:node.innerHTML,id:String(entries.size)});
    }
    return entries;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function conversionHTML(entry) {
    let value = '', cursor = 0;
    for (const annotation of entry.annotations.sort((a, b) => a.start - b.start)) {
      if (annotation.start < cursor) continue;
      const base = annotation.type === 'hanja' ? annotation.replacement : annotation.surface;
      const reading = annotation.type === 'hanja' ? annotation.surface : annotation.replacement;
      value += escapeHTML(entry.text.slice(cursor, annotation.start));
      value += `<ruby class="kra-ruby" kra-annotated="true" data-kra-type="${annotation.type}" data-kra-original="${escapeHTML(annotation.surface)}">${escapeHTML(base)}<rt class="kra-annotation kra-unselectable">${escapeHTML(reading)}</rt></ruby>`;
      cursor = annotation.end;
    }
    return value + escapeHTML(entry.text.slice(cursor));
  }

  function insertConversions(entries) {
    const operation=[];
    const range = document.createRange();
    let count = 0;
    for (const [node, entry] of entries) {
      if ((!entry.annotations.length&&!entry.isRuby) || !node.isConnected || (entry.isRuby?node.innerHTML!==entry.originalHTML:node.data!==entry.text)) continue;
      range.selectNode(node.parentNode);
      const fragment = range.createContextualFragment(conversionHTML(entry));
      count += fragment.querySelectorAll(OWN_RUBY).length;
      const parent=node.parentNode, inserted=Array.from(fragment.childNodes);
      operation.push({parent,original:node,originalSnapshot:node.cloneNode(true),inserted,snapshots:inserted.map(n=>n.cloneNode(true))});
      node.parentNode.replaceChild(fragment, node);
      seenSources.add(entry.text);
    }
    if(operation.length)history.push(operation);
    return count;
  }

  function contextState() {
    const ranges=captureSelection();return {ok:true,hasAnnotations:Boolean(document.querySelector(OWN_RUBY)),hasSelection:Boolean(ranges),selectionUnannotated:Boolean(ranges&&collectTextNodes(ranges).size)};
  }

  function send(message) {
    try { return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null); }
    catch { return Promise.resolve(null); }
  }

  function publishState() {
    send({ type: 'KRA_CONTEXT_UPDATE', state: contextState() });
  }

  function getToolbar() {
    if (toolbar?.isConnected) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'kra-mobile-selection-bar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '韩语网页标注');
    toolbar.innerHTML = '<div class="kra-task-status"><span class="kra-task-label" role="status">准备标注</span><progress class="kra-task-progress" max="100" value="0"></progress></div><div class="kra-mobile-actions"><button class="kra-mobile-page" type="button">标注整页</button><button class="kra-mobile-primary" type="button">重新标注选区</button><button class="kra-mobile-review" type="button">模型重审选区</button><button class="kra-mobile-undo" type="button">撤销</button><button class="kra-diagnostic-button" type="button">诊断</button><button class="kra-mobile-restore" type="button">还原</button><button class="kra-mobile-close" type="button" aria-label="关闭">×</button></div>';
    toolbar.querySelector('.kra-mobile-page').addEventListener('click', () => startAnnotation({ modes: { hanja: uiSettings.hanjaMode ?? true, loanword: uiSettings.loanwordMode ?? true } }));
    for(const button of toolbar.querySelectorAll('button'))button.addEventListener('pointerdown',event=>event.preventDefault());
    toolbar.querySelector('.kra-mobile-primary').addEventListener('click',()=>startSelection(false));
    toolbar.querySelector('.kra-mobile-review').addEventListener('click',()=>startSelection(true));
    toolbar.querySelector('.kra-mobile-undo').addEventListener('click',undoLast);
    toolbar.querySelector('.kra-diagnostic-button').addEventListener('click',toggleDiagnostics);
    toolbar.querySelector('.kra-mobile-restore').addEventListener('click', restorePage);
    toolbar.querySelector('.kra-mobile-close').addEventListener('click', () => { toolbarDismissed = true; toolbar.hidden = true; });
    document.body.append(toolbar);
    return toolbar;
  }

  function status(message, percent) {
    if (!document.body) return;
    const bar = getToolbar();
    bar.querySelector('.kra-task-label').textContent = message;
    const progress = bar.querySelector('.kra-task-progress');
    if (Number.isFinite(percent)) progress.value = Math.max(0, Math.min(100, percent));
    else progress.removeAttribute('value');
    refreshToolbar();
  }

  function finishTask(task) {
    if (task.finished) return;
    task.finished = true;
    clearInterval(task.keepalive);
    if (currentTask === task) currentTask = null;
    try { task.port.disconnect(); } catch {}
  }

  function cancelTask() {
    const task = currentTask;
    if (!task) return;
    try { task.port.postMessage({ type: 'CANCEL', operationId: task.operationId }); } catch {}
    finishTask(task);
  }

  function restorePage() {
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();history.length=0;seenSources.clear();
    // Like de-furiganation, unwrap only owned rubies, preserving surrounding DOM.
    for (const ruby of document.querySelectorAll(OWN_RUBY)) {
      ruby.replaceWith(document.createTextNode(ruby.dataset.kraOriginal || ''));
    }
    status('已还原', 0);
    send({ type: 'SET_BADGE', text: '' });
    publishState();
  }

  function undoLast() {
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();
    const operation=history.pop();if(!operation){status('没有可撤销的标注',0);return {ok:false,error:'没有可撤销的标注'};}
    for(const record of [...operation].reverse()){
      if(!record.inserted.every((node,i)=>node.parentNode===record.parent&&node.isEqualNode(record.snapshots[i])&&(i===0||record.inserted[i-1].nextSibling===node)))continue;
      record.inserted[0].before(record.original.isEqualNode(record.originalSnapshot)?record.original:record.originalSnapshot.cloneNode(true));for(const node of record.inserted)node.remove();
    }
    status('已撤销上次标注',0);publishState();return {ok:true};
  }

  function startSelection(reviewAll) {
    const ranges=captureSelection()||selectionSnapshot;
    if(!ranges?.length)return {ok:false,error:'请先选中需要标注的文字。'};
    return startAnnotation({ranges,reviewAll,forceRegenerate:true,modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true}});
  }

  function startAnnotation(message) {
    const modes = { hanja: message.modes?.hanja ?? true, loanword: message.modes?.loanword ?? true };
    if (!modes.hanja && !modes.loanword) return { ok: false, error: '请至少启用一种标注模式。' };
    cancelTask();
    if(!message.automatic){toolbarDismissed=false;diagnostics.length=0;}
    const ranges=message.ranges||null;
    const entries = collectTextNodes(ranges,Boolean(ranges||message.forceRegenerate),Boolean(message.automatic));
    if(entries.size)pageHasHangul=true;
    if (!entries.size) { status('没有未标注的韩语文字', 100); return { ok: true, started: false }; }
    if ([...entries.values()].some(entry => entry.text.length > 20000)) return { ok: false, error: '单个文本节点过长，超过本地引擎限制。' };
    const operationId = `page-${Date.now().toString(36)}-${++sequence}`;
    let port;
    try { port = chrome.runtime.connect({ name: 'KRA_SENTENCE_STREAM_V1' }); }
    catch (error) { status('扩展已更新，请刷新网页后重试', 0); return { ok: false, error: error.message }; }
    const task = { operationId, port, entries, finished: false };
    const byId = new Map([...entries.values()].map(entry => [entry.id, entry]));
    currentTask = task;
    status('分析中，完成后一次性写入标注…');
    port.onDisconnect.addListener(() => {
      if (task.finished) return;
      status('分析连接中断，请重试', 0);
      finishTask(task);
    });
    port.onMessage.addListener(result => {
      if (task.finished || currentTask !== task || result.operationId !== operationId) return;
      if (result.type === 'ERROR') { addDiagnostic({level:'error',message:result.error});status(result.error || '分析失败', 0); finishTask(task); return; }
      if (result.type === 'DIAGNOSTIC') {
        addDiagnostic(result.diagnostic||{});
        if (result.diagnostic?.level === 'error') status(result.diagnostic.message || '分析错误', 0);
        return;
      }
      if (result.type === 'MODEL_PROGRESS') {
        status(result.modelTotal ? `模型审核 ${result.modelCompleted || 0}/${result.modelTotal}` : '模型：无需审核');
        return;
      }
      if (result.type !== 'RESULTS' && result.type !== 'DONE') return;
      globalThis.__KRA_PIPELINE_STATUS__ = { stats: result.stats, engine_version: result.engine_version, dictionary_metadata: result.dictionary_metadata };
      for (const item of result.results || []) {
        const entry = byId.get(item.id);
        if (!entry) continue;
        for (const annotation of item.annotations || []) {
          if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start || annotation.end > entry.text.length || entry.text.slice(annotation.start, annotation.end) !== annotation.surface || typeof annotation.replacement !== 'string' || !annotation.replacement || !['hanja', 'loanword'].includes(annotation.type) || !modes[annotation.type === 'hanja' ? 'hanja' : 'loanword'] || !entry.selected.some(r=>annotation.start>=r.start&&annotation.end<=r.end)) continue;
          entry.annotations = entry.annotations.filter(old => old.end <= annotation.start || old.start >= annotation.end);
          entry.annotations.push(annotation);
        }
      }
      if (result.type === 'RESULTS') { status(`分析 ${Math.round(result.percent || 0)}%，尚未写入网页`, result.percent || 0); return; }
      // No scheduled layout pass, copy handler, or repaint recovery.
      const count = insertConversions(entries);
      for(const entry of entries.values())seenSources.add(entry.text);
      status(`完成：${count} 个标注`, 100);
      finishTask(task);
      if(!ranges)pageCompleted=true;configureAutomaticAnnotation();
      addDiagnostic({message:`完成：${count} 个标注`,detail:JSON.stringify(result.stats||{})});
      publishState();
    });
    task.keepalive = setInterval(() => { try { port.postMessage({ type: 'KEEPALIVE' }); } catch { finishTask(task); } }, 20000);
    try {
      port.postMessage({ type: 'START', operationId, sentences: [...entries.values()].map(({id,text,selected})=>({id,text,selected})), context: [...entries.values()].map(entry => entry.text).join('\n'), modes, forceRegenerate: Boolean(message.forceRegenerate), reviewAll: message.reviewAll===true });
    } catch (error) { finishTask(task); status(error.message || '无法启动分析', 0); return { ok: false, error: error.message }; }
    return { ok: true, started: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message?.type) {
      case 'KRA_PING': respond({ ok: true, version: VERSION }); break;
      case 'KRA_CONTEXT_STATE': respond(contextState()); break;
      case 'START_ANNOTATION': if(message.uiSettings)applySettings(message.uiSettings);respond(startAnnotation(message)); break;
      case 'RESTORE_ANNOTATION': restorePage();respond({ok:true});break;
      case 'UNDO_LAST_ANNOTATION':respond(undoLast());break;
      case 'APPLY_UI_SETTINGS':applySettings(message.uiSettings||{});respond({ok:true});break;
      case 'START_SELECTION_ANNOTATION':{const ranges=captureSelection();respond(ranges?startAnnotation({...message,ranges}):{ok:false,error:'请先选中需要标注的文字。'});break;}
    }
  });

  send({ type: 'GET_UI_SETTINGS' }).then(reply => {
    if (!reply?.ok) return;
    pageHasHangul=collectTextNodes().size>0;
    applySettings(reply.uiSettings);
  });
})();
