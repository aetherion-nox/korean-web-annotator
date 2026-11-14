(() => {
  const VERSION = '1.1.56.32-real-bottlenecks-and-folded-toc';
  if (globalThis.__KRA_CONTENT_SCRIPT_VERSION__ === VERSION) return;
  globalThis.__KRA_CONTENT_SCRIPT_VERSION__ = VERSION;
  globalThis.__KOREAN_RUBY_ANNOTATOR_LOADED__ = true;
  const OWN_RUBY = 'ruby[kra-annotated="true"]';
  // Only annotation recovery snapshots are bounded. Full-page text scanning
  // is not truncated: the sentence pipeline already batches model requests.
  const MAX_RECOVERY_BLOCKS = 12000;
  let currentTask = null;
  let sequence = 0;
  let uiSettings = { toolbarBallOnly:false, mobileSelectionToolbar: true, hanjaMode: true, loanwordMode: true, copyMode: 'hangul', recognizeCollapsedContent:true };
  let toolbar = null;
  let toolbarDismissed = false;
  let toolbarForcedOpen = false;
  let floatingBall = null;
  let floatingBallPosition = {x:1,y:0.55};
  let floatingDrag = null;
  let suppressBallClick = false;
  let floatingObserver = null;
  let floatingObservedBody = null;
  let selectionSnapshot = null;
  let selectionTimer = null;
  let pageCompleted = false;
  let pageHasHangul = false;
  let hangulVisibilityObserver = null;
  let hangulVisibilityTimer = null;
  let automaticObserver = null;
  let automaticTimer = null;
  // One bounded event-triggered pass for content loaded after an explicit
  // whole-page run; continuous future scanning remains opt-in.
  const seenSources = new Set(); // legacy session bookkeeping; NOT a deduplication key
  const analyzedNodeVersions = new WeakMap();
  let lastScanStats = null;
  const history = [];
  const redoStack = [];
  const HISTORY_LIMIT=100;
  const diagnostics = [];
  const recoveryBlocks = new Set();
  const recoveryByElement = new WeakMap();
  const ownDomChanges = new WeakSet();
  const BLOCK_TAGS = 'p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption';
  let recoveryObserver = null;
  let recoveryTimer = null;
  let recoveryPage = null;

  // Source coordinates always count the original Hangul, never the displayed
  // Hanja or rt. Inline elements are retained; native ruby is never rewritten.
  function sourceOf(element) {
    let text='';const runs=[];
    function visit(node) {
      if(node.nodeType===3){runs.push({node,start:text.length,end:text.length+node.data.length});text+=node.data;return;}
      if(node.nodeType!==1)return;
      if(node.matches(OWN_RUBY)){const value=node.dataset.kraOriginal||'';runs.push({node,start:text.length,end:text.length+value.length,owned:true});text+=value;return;}
      if(node.matches('script,style,noscript,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball'))return;
      if(node.matches('ruby')){text+=node.textContent;return;}
      for(const child of node.childNodes)visit(child);
    }
    if(element)visit(element);return {text,runs};
  }

  function pageIdentity() {
    return JSON.stringify([location.href,document.querySelector('link[rel="canonical"]')?.href||'',sourceOf(document.querySelector('h1')).text]);
  }

  function resetRecovery() {
    recoveryBlocks.clear();recoveryPage=null;
    recoveryObserver?.disconnect();recoveryObserver=null;
    clearTimeout(recoveryTimer);recoveryTimer=null;
  }

  function recoveryContext(block) {
    return JSON.stringify([sourceOf(block.previousElementSibling).text,sourceOf(block.nextElementSibling).text]);
  }

  function recoveryAnchor(node,scanCache=null) {
    const element=node.parentElement?.closest(BLOCK_TAGS)||node.parentElement;
    if(!element||element.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball'))return null;
    const identity=scanCache?.identity??pageIdentity();
    if(recoveryPage!==null&&identity!==recoveryPage)resetRecovery();
    recoveryPage=identity;
    let source=scanCache?.sources.get(element);
    if(!source){
      source=sourceOf(element);
      source.runByNode=new Map(source.runs.map(run=>[run.node,run]));
      scanCache?.sources.set(element,source);
    }
    const run=source.runByNode.get(node);
    if(!run)return null;
    const scope=element.closest('[itemprop~="articleBody"],article,main')||document.body;
    const selector=scope.matches('[itemprop~="articleBody"]')?'[itemprop~="articleBody"]':scope.tagName.toLowerCase();
    let scopeIndex;
    if(scanCache){
      let positions=scanCache.scopePositions.get(selector);
      if(!positions){
        positions=new Map([...document.querySelectorAll(selector)].map((el,i)=>[el,i]));
        scanCache.scopePositions.set(selector,positions);
      }
      scopeIndex=positions.get(scope)??-1;
    }else scopeIndex=Array.from(document.querySelectorAll(selector)).indexOf(scope);
    let context=scanCache?.contexts.get(element);
    if(context===undefined){
      context=recoveryContext(element);
      scanCache?.contexts.set(element,context);
    }
    const tag=element.tagName.toLowerCase();
    let block=recoveryByElement.get(element);
    if(!block||!recoveryBlocks.has(block)||block.text!==source.text)block=null;
    if(!block){
      const key=JSON.stringify([source.text,context,tag,selector,scopeIndex]);
      const candidates=scanCache?.detachedByKey?.get(key)||
        [...recoveryBlocks].filter(b=>!b.element.isConnected&&
          b.text===source.text&&b.context===context&&b.tag===tag&&
          b.selector===selector&&b.scopeIndex===scopeIndex);
      const previous=candidates.filter(b=>!b.element.isConnected);
      if(previous.length===1){block=previous[0];block.element=element;block.scope=scope;}
      else if(previous.length>1)for(const stale of previous)stale.annotations.clear();
    }
    if(!block){
      if(recoveryBlocks.size>=MAX_RECOVERY_BLOCKS)return null;
      block={element,text:source.text,context,tag,scope,selector,scopeIndex,annotations:new Map()};
      recoveryBlocks.add(block);
    }
    block.context=context;
    recoveryByElement.set(element,block);
    return {block,start:run.start};
  }

  function rememberRecovery(entry,operation) {
    const anchor=entry.recoveryAnchor;
    if(!anchor||entry.hasPreview||(entry.isRuby&&!entry.modelReviewed&&!entry.localAnnotations?.length))return;
    const {block,start}=anchor;
    if(!recoveryBlocks.has(block))return;
    const overlaps=a=>entry.selected.some(r=>a.start<start+r.end&&a.end>start+r.start);
    if(!entry.annotations.length&&!Array.from(block.annotations.values()).some(overlaps))return;
    operation.recoveryBefore||=new Map();
    if(!operation.recoveryBefore.has(block))operation.recoveryBefore.set(block,new Map(block.annotations));
    for(const [key,a]of block.annotations)if(overlaps(a))block.annotations.delete(key);
    for(const a of entry.annotations){const item={...a,start:start+a.start,end:start+a.end,operation};block.annotations.set(`${item.start}:${item.end}`,item);}
    configureRecovery();
  }

  function isOwnMutation(record) {
    if(record.type!=='childList')return false;
    const nodes=[...record.addedNodes,...record.removedNodes];
    return nodes.length>0&&nodes.every(node=>ownDomChanges.has(node));
  }

  function configureRecovery() {
    if(uiSettings.restoreExistingAnnotations===false||!Array.from(recoveryBlocks).some(b=>b.annotations.size)){
      recoveryObserver?.disconnect();recoveryObserver=null;clearTimeout(recoveryTimer);recoveryTimer=null;return;
    }
    if(!recoveryObserver){
      recoveryObserver=new MutationObserver(records=>{
        if(records.some(record=>!isOwnMutation(record)&&!(record.target.nodeType===1?record.target:record.target.parentElement)?.closest('ruby,script,style,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball')))scheduleRecovery();
      });
      recoveryObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
    }
    scheduleRecovery();
  }

  function scheduleRecovery() {
    if(uiSettings.restoreExistingAnnotations===false||!recoveryBlocks.size||recoveryTimer!==null)return;
    recoveryTimer=setTimeout(()=>{recoveryTimer=null;restoreKnownAnnotations();},150);
  }

  function restoreKnownAnnotations() {
    if(uiSettings.restoreExistingAnnotations===false)return;
    if(recoveryPage!==pageIdentity()){resetRecovery();return;}
    // Only committed choices enter the recovery cache. During a human-paced
    // manual wait these are safe to restore; active analysis/previews retain
    // ownership of their nodes until a safe pause or task completion.
    if(currentTask&&!currentTask.manualRequest&&!currentTask.manualLocalOnly)return;
    const candidateIndexes=new Map();
    for(const block of recoveryBlocks){
      if(!block.annotations.size)continue;
      let element=block.element;
      if(element.isConnected&&sourceOf(element).text!==block.text)continue;
      if(!element.isConnected){
        const competitors=Array.from(recoveryBlocks).filter(b=>!b.element.isConnected&&b.text===block.text&&b.context===block.context&&b.tag===block.tag&&b.selector===block.selector&&b.scopeIndex===block.scopeIndex);
        if(competitors.length!==1)continue;
        const scope=block.scope.isConnected?block.scope:document.querySelectorAll(block.selector)[block.scopeIndex];
        if(!scope)continue;
        let byTag=candidateIndexes.get(scope);if(!byTag){byTag=new Map();candidateIndexes.set(scope,byTag);}
        if(!byTag.has(block.tag)){
          const index=new Map();for(const candidate of scope.querySelectorAll(block.tag)){const key=sourceOf(candidate).text;const list=index.get(key)||[];list.push(candidate);index.set(key,list);}byTag.set(block.tag,index);
        }
        const candidates=(byTag.get(block.tag).get(block.text)||[]).filter(e=>!Array.from(recoveryBlocks).some(other=>other!==block&&other.element===e));
        const contextual=candidates.filter(e=>recoveryContext(e)===block.context);
        // Neighboring ads or paragraphs may change independently of this source.
        // A unique exact source can recover without neighbors only when no
        // other detached record could claim the same location.
        const unresolved=Array.from(recoveryBlocks).filter(other=>!other.element.isConnected&&other.annotations.size&&other.text===block.text&&other.tag===block.tag&&other.selector===block.selector&&other.scopeIndex===block.scopeIndex);
        const matches=contextual.length===1?contextual:contextual.length===0&&candidates.length===1&&unresolved.length===1?candidates:[];
        if(matches.length!==1)continue;
        element=matches[0];block.element=element;block.scope=scope;
      }
      // An existing node with identical source remains the same paragraph even
      // when adjacent content changed. Source spans are checked again below.
      block.context=recoveryContext(element);
      const source=sourceOf(element);
      const pending=[];
      for(const a of block.annotations.values()){
        if(!(a.type==='hanja'?(uiSettings.hanjaMode??true):(uiSettings.loanwordMode??true)))continue;
        const run=source.runs.find(r=>!r.owned&&r.start<=a.start&&r.end>=a.end);
        if(!run||source.text.slice(a.start,a.end)!==a.surface||run.node.parentElement?.closest('ruby,input,textarea,select,[contenteditable="true"]'))continue;
        pending.push({...a,node:run.node,offset:a.start-run.start});
      }
      // Work backwards so each surviving prefix keeps its source offsets.
      const prefixes=new Map();
      for(const a of pending.sort((a,b)=>b.start-a.start)){
        const node=prefixes.get(a.node)||a.node;if(!node.isConnected||!node.parentNode||node.data.slice(a.offset,a.offset+a.surface.length)!==a.surface)continue;
        const prefix=document.createTextNode(node.data.slice(0,a.offset)),suffix=document.createTextNode(node.data.slice(a.offset+a.surface.length));
        const range=document.createRange();range.selectNode(node);
        const ruby=range.createContextualFragment(conversionHTML({text:a.surface,annotations:[{...a,start:0,end:a.surface.length}]})).firstChild;
        const parent=node.parentNode;for(const n of [node,prefix,ruby,suffix])ownDomChanges.add(n);
        node.before(prefix,ruby,suffix);node.remove();prefixes.set(a.node,prefix);
        analyzedNodeVersions.set(prefix,prefix.data);
        analyzedNodeVersions.set(suffix,suffix.data);
        const original=document.createTextNode(a.surface);
        for(let i=a.operation.length-1;i>=0;i--)if(a.operation[i].inserted.every(n=>!n.isConnected))a.operation.splice(i,1);
        a.operation.push({parent,original,originalSnapshot:original.cloneNode(true),inserted:[ruby],snapshots:[ruby.cloneNode(true)]});
      }
    }
  }

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
    const wasBallOnly=uiSettings.toolbarBallOnly===true;
    uiSettings={...uiSettings,...settings};
    if(settings.floatingBallEnabled===false||settings.mobileSelectionToolbar===false)uiSettings.toolbarBallOnly=false;
    else if(uiSettings.toolbarBallOnly===true){
      uiSettings.floatingBallEnabled=true;uiSettings.mobileSelectionToolbar=true;
      if(!wasBallOnly)toolbarForcedOpen=false;
    }
    if(Object.hasOwn(settings,'floatingBallPosition')&&!floatingDrag){
      const p=settings.floatingBallPosition;
      if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))floatingBallPosition={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};
    }
    if(Object.hasOwn(settings,'copyMode'))uiSettings.selectAnnotations=false;
    if(!Object.hasOwn(settings,'copyMode')&&Object.hasOwn(settings,'copyOriginalHangul'))uiSettings.copyMode=settings.copyOriginalHangul?'hangul':'base';
    if(!['base','annotated','hangul','annotation'].includes(uiSettings.copyMode))uiSettings.copyMode='hangul';
    document.documentElement.toggleAttribute('data-kra-select-annotations',['annotated','annotation'].includes(uiSettings.copyMode)||uiSettings.selectAnnotations===true);
    document.documentElement.toggleAttribute('data-kra-select-hangul',uiSettings.copyMode==='hangul');
    document.documentElement.setAttribute('data-kra-copy-mode',uiSettings.copyMode);
    configureHangulVisibility();
    refreshToolbar();
    configureAutomaticAnnotation();
    configureRecovery();
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

  function configureHangulVisibility() {
    clearTimeout(hangulVisibilityTimer);hangulVisibilityTimer=null;
    // Each iframe still runs the annotation engine, but only the top-level
    // document owns the toolbar and its visibility observer.
    if(typeof window!=='undefined'&&window!==window.top){
      hangulVisibilityObserver?.disconnect();hangulVisibilityObserver=null;
      return;
    }
    if(uiSettings.toolbarHangulOnly===false||uiSettings.mobileSelectionToolbar===false){hangulVisibilityObserver?.disconnect();hangulVisibilityObserver=null;return;}
    const own='.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball,.kra-manual-reopen';
    const isOwn=node=>(node.nodeType===1?node:node.parentElement)?.closest(own);
    const detect=()=>{
      if(!document?.body)return false;
      const hangul=/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;
      for(const root of openTextRoots()){
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        let node;
        while((node=walker.nextNode()))
          if(hangul.test(node.data)&&!isOwn(node)&&
             !node.parentElement?.closest('script,style,noscript,input,textarea,select'))
            return true;
        if([...root.querySelectorAll(OWN_RUBY)].some(r=>!isOwn(r)&&
          hangul.test(r.getAttribute('data-kra-original')||'')))return true;
      }
      return false;
    };
    pageHasHangul=detect();
    if(hangulVisibilityObserver)return;
    hangulVisibilityObserver=new MutationObserver(records=>{
      if(!records.some(record=>!isOwn(record.target)&&(record.type==='characterData'||[...record.addedNodes,...record.removedNodes].some(node=>!isOwn(node)))))return;
      // Coalesce scans without waiting for a permanently busy page to go idle.
      if(hangulVisibilityTimer!==null)return;
      hangulVisibilityTimer=setTimeout(()=>{hangulVisibilityTimer=null;if(!document?.body)return;pageHasHangul=detect();refreshToolbar();},160);
    });
    hangulVisibilityObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }

  function floatingBounds() {
    const visual=window.visualViewport;
    const width=Math.max(44,Math.min(window.innerWidth||44,visual?.width||Infinity));
    const height=Math.max(44,Math.min(window.innerHeight||44,visual?.height||Infinity));
    const mx=Math.min(8,(width-44)/2),my=Math.min(8,(height-44)/2);
    return {left:(visual?.offsetLeft||0)+mx,top:(visual?.offsetTop||0)+my,width:width-44-2*mx,height:height-44-2*my};
  }

  function placeFloatingBall() {
    if(!floatingBall)return;
    const b=floatingBounds();
    floatingBall.style.setProperty('left',`${b.left+floatingBallPosition.x*b.width}px`,'important');
    floatingBall.style.setProperty('top',`${b.top+floatingBallPosition.y*b.height}px`,'important');
  }

  function refreshFloatingBall() {
    if(!document?.body)return;
    const show=window.top===window&&uiSettings.mobileSelectionToolbar!==false&&uiSettings.floatingBallEnabled!==false&&
      (uiSettings.toolbarHangulOnly===false||pageHasHangul);
    if(!show){if(floatingBall)floatingBall.hidden=true;return;}
    if(!floatingBall){
      floatingBall=document.createElement('button');floatingBall.type='button';floatingBall.className='kra-floating-ball';for(const [className,text] of [['kra-ball-hangul','한'],['kra-ball-hanja','漢']]){const glyph=document.createElement('span');glyph.className=className;glyph.textContent=text;glyph.setAttribute('aria-hidden','true');floatingBall.append(glyph);}
      floatingBall.setAttribute('aria-expanded','false');
      floatingBall.setAttribute('aria-label','打开韩语标注工具条');floatingBall.title='打开韩语标注工具条 · 拖动可移动位置';
      floatingBall.addEventListener('pointerdown',event=>{
        if(event.button!==0||event.isPrimary===false||floatingDrag)return;
        event.preventDefault();event.stopPropagation();suppressBallClick=false;
        floatingDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:parseFloat(floatingBall.style.left),top:parseFloat(floatingBall.style.top),before:{...floatingBallPosition},moved:false};
        try{floatingBall.setPointerCapture(event.pointerId);}catch{}
      });
      floatingBall.addEventListener('pointermove',event=>{
        const drag=floatingDrag;if(!drag||event.pointerId!==drag.id)return;
        event.preventDefault();event.stopPropagation();
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
        if(!drag.moved&&Math.hypot(dx,dy)<6)return;
        drag.moved=true;floatingBall.classList.add('kra-floating-dragging');
        const b=floatingBounds();floatingBallPosition={x:b.width?Math.max(0,Math.min(1,(drag.left+dx-b.left)/b.width)):0,y:b.height?Math.max(0,Math.min(1,(drag.top+dy-b.top)/b.height)):0};
        placeFloatingBall();
      });
      const endDrag=(event,cancelled=false)=>{
        const drag=floatingDrag;if(!drag||event.pointerId!==drag.id)return;
        floatingDrag=null;suppressBallClick=drag.moved||cancelled;floatingBall.classList.remove('kra-floating-dragging');
        if(cancelled){floatingBallPosition=drag.before;placeFloatingBall();}
        else if(drag.moved)send({type:'SET_FLOATING_BALL_POSITION',position:floatingBallPosition});
        try{floatingBall.releasePointerCapture(event.pointerId);}catch{}
      };
      floatingBall.addEventListener('pointerup',event=>endDrag(event));
      floatingBall.addEventListener('pointercancel',event=>endDrag(event,true));
      floatingBall.addEventListener('lostpointercapture',event=>endDrag(event,true));
      floatingBall.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        if(suppressBallClick&&event.detail!==0){suppressBallClick=false;return;}
        suppressBallClick=false;
        if(toolbar?.isConnected&&!toolbar.hidden){dismissToolbar();return;}
        toolbarDismissed=false;toolbarForcedOpen=true;refreshToolbar();
      });
    }
    if(!floatingBall.isConnected){
      if(floatingDrag){floatingBallPosition=floatingDrag.before;floatingDrag=null;suppressBallClick=true;floatingBall.classList.remove('kra-floating-dragging');}
      document.body.append(floatingBall);
    }
    if(floatingObservedBody!==document.body){
      floatingObserver?.disconnect();floatingObservedBody=document.body;
      floatingObserver=new MutationObserver(()=>{if(document?.body&&(!floatingBall?.isConnected||floatingObservedBody!==document.body))refreshFloatingBall();});
      floatingObserver.observe(document.documentElement,{childList:true});floatingObserver.observe(document.body,{childList:true});
    }
    floatingBall.hidden=!show;placeFloatingBall();
  }

  window.addEventListener('resize',placeFloatingBall);
  window.visualViewport?.addEventListener('resize',placeFloatingBall);
  window.visualViewport?.addEventListener('scroll',placeFloatingBall);

  function refreshToolbar() {
    // An iframe's annotation progress must never create a second toolbar.
    if(!document.body||(typeof window!=='undefined'&&window!==window.top))return;
    refreshFloatingBall();
    const selected=captureSelection();
    if(selected)selectionSnapshot=selected;
    const always = uiSettings.toolbarDisplay === 'always';
    const eligible = uiSettings.toolbarHangulOnly === false ||
      (always ? pageHasHangul : selectionHasHangul(selected));
    const show=!toolbarDismissed&&uiSettings.mobileSelectionToolbar!==false&&(uiSettings.toolbarHangulOnly===false||pageHasHangul)&&
      (toolbarForcedOpen||(uiSettings.toolbarBallOnly!==true&&(currentTask||(eligible&&(always||Boolean(selected))))));
    if(!toolbar&&!show)return;
    const bar=getToolbar();bar.hidden=!show;
    floatingBall?.setAttribute('aria-expanded',String(Boolean(show)));
    refreshManualReopen();
    for(const button of bar.querySelectorAll('.kra-mobile-primary,.kra-mobile-review'))button.disabled=!selected&&!selectionSnapshot;
  }

  function dismissToolbar() {
    toolbarForcedOpen=false;toolbarDismissed=true;
    if(toolbar)toolbar.hidden=true;
    floatingBall?.setAttribute('aria-expanded','false');
    refreshManualReopen();
  }

  function refreshManualReopen() {
    const reopen=document.querySelector('.kra-manual-reopen'),panel=document.querySelector('.kra-manual-review');
    if(reopen)reopen.hidden=(typeof window!=='undefined'&&window!==window.top)?
      !panel?.dataset.operationId||!panel.hidden:
      !toolbar?.isConnected||toolbar.hidden||!panel?.dataset.operationId||!panel.hidden;
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

  function hasFreshHangul(node) {
    if(!node)return false;
    const excluded='ruby,script,style,noscript,input,textarea,select,'+
      '.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,'+
      '.kra-floating-ball,.kra-manual-reopen,[contenteditable="true"]';
    const eligible=textNode=>textNode?.nodeType===3&&
      /[가-힣]/u.test(textNode.data||'')&&
      !textNode.parentElement?.closest?.(excluded);
    if(node.nodeType===3)return eligible(node);
    if(node.nodeType!==1&&node.nodeType!==11&&node.nodeType!==9)return false;
    if(node.nodeType===1&&node.closest?.(excluded))return false;
    if(!/[가-힣]/u.test(node.textContent||''))return false;
    // Fast path for common comment text insertions. An ancestor may contain
    // old extension rubies AND new Korean nodes; never discard it wholesale.
    if(!node.querySelector?.('ruby')&&!node.closest?.('ruby'))return true;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    let current;
    while((current=walker.nextNode()))if(eligible(current))return true;
    return false;
  }

  function relevantKoreanMutation(record) {
    if(isOwnMutation(record))return false;
    const parent=record.target.nodeType===1?record.target:record.target.parentElement;
    if(parent?.closest?.('ruby,.kra-mobile-selection-bar,.kra-diagnostics,'+
       '.kra-manual-review,.kra-floating-ball,.kra-manual-reopen,script,style'))return false;
    if(record.type==='attributes')return hasFreshHangul(record.target);
    if(record.type==='characterData')return hasFreshHangul(record.target);
    return Array.from(record.addedNodes||[]).some(hasFreshHangul);
  }

  function configureAutomaticAnnotation() {
    if(automaticObserver){automaticObserver.disconnect();automaticObserver=null;}
    clearTimeout(automaticTimer);
    if(!pageCompleted||uiSettings.stopAutoAfterPageComplete!==false||!document.body)return;
    // Continuous rescanning is opt-in. A page-complete stop remains the
    // default, so updates cannot silently trigger unlimited model calls.
    const observeOptions={subtree:true,childList:true,characterData:true,
      attributes:true,attributeFilter:['class','style','hidden','aria-hidden','inert','open']};
    const observed=new WeakSet();
    const observeOpenShadows=()=>{
      for(const root of openTextRoots().slice(1))if(!observed.has(root)){
        observed.add(root);automaticObserver.observe(root,observeOptions);
      }
    };
    automaticObserver=new MutationObserver(records=>{
      // New open shadow hosts can appear after observer setup.
      if(records.some(record=>record.type==='childList'))observeOpenShadows();
      const relevant=records.some(relevantKoreanMutation);
      if(!relevant)return;
      clearTimeout(automaticTimer);
      automaticTimer=setTimeout(()=>{
        if(!currentTask)startAnnotation({automatic:true,
          modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true}});
      },900);
    });
    automaticObserver.observe(document.body,observeOptions);
    observeOpenShadows();
  }

  if(typeof window==='undefined'||window===window.top)document.addEventListener('selectionchange',()=>{
    // Dismissal hides controls, not the running task. A new selection in the
    // page must reopen them during manual review and API requests alike.
    // Editing/copying in extension panels is not a page selection gesture.
    const ui='.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball,.kra-manual-reopen';
    const ranges=captureSelection();
    const editor=document.activeElement;
    const editingPanel=editor?.matches('input,textarea,[contenteditable="true"]')&&editor.closest(ui);
    if(!editingPanel&&ranges?.some(range=>{
      const node=range.commonAncestorContainer;
      return !(node.nodeType===1?node:node.parentElement)?.closest(ui);
    }))toolbarDismissed=false;
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
  function openTextRoots(root=document.body) {
    if(!root)return [];
    const roots=[root],seen=new WeakSet();
    // TreeWalker doesn't descend into open Shadow DOM. Include those roots
    // explicitly, including nested ones. Closed roots cannot be inspected.
    for(let i=0;i<roots.length;i++){
      for(const element of roots[i].querySelectorAll('*')){
        const shadow=element.shadowRoot;
        if(shadow&&!seen.has(shadow)){seen.add(shadow);roots.push(shadow);}
      }
    }
    return roots;
  }

  function collectTextNodes(ranges=null, includeOwned=false, automatic=false, trackRecovery=false) {
    const entries=new Map();
    const stats={textNodes:0,hangulNodes:0,eligibleNodes:0,selectedNodes:0,
      skippedHidden:0,skippedExcluded:0,skippedProcessed:0,skippedSelection:0,
      recoveryCapReached:0,shadowRoots:0};
    if(!document.body){lastScanStats=stats;return entries;}
    const roots=openTextRoots();
    stats.shadowRoots=Math.max(0,roots.length-1);
    const visibilityCache=new WeakMap();
    const visibilityReason=element=>{
      if(!element||element.nodeType!==1)return '';
      if(visibilityCache.has(element))return visibilityCache.get(element);
      let reason='';
      if(element.matches('ruby,script,style,noscript,input,textarea,select,option,'+
         '.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,'+
         '.kra-floating-ball,.kra-manual-reopen,[contenteditable="true"]'))
        reason='excluded';
      else {
        const recognize=typeof uiSettings==='undefined'||uiSettings.recognizeCollapsedContent!==false;
        const details=element.closest('details:not([open])');
        const vectorList=element.matches('.vector-toc-list')&&Boolean(element.closest('#vector-toc'));
        // Vector's chapter navigation may remain CSS-visible in a headless
        // or dynamic layout even when the parent item is semantically folded.
        // Use the actual Vector expansion class, not CSS alone, to implement
        // the OFF setting. All text nodes under this list inherit this guard.
        const foldedVector=vectorList&&element.parentElement?.matches(
          '.vector-toc-list-item:not(.vector-toc-list-item-expanded)');
        if(!recognize&&(details&&element!==details&&!element.closest('summary')||foldedVector))
          reason='hidden';
        else {
          const vectorChild=recognize&&element.matches('.vector-toc-list-item')&&
            element.parentElement?.matches('.vector-toc-list')&&
            Boolean(element.closest('#vector-toc'));
          // Live Vector CSS hides each child <li> (display:none), *not* the
          // enclosing <ul>. This exception is limited to these actual TOC
          // list items; unrelated hidden spans/templates are still excluded.
          const mediaWikiPanel=recognize&&(element.matches('.mw-collapsible-content')||
              vectorList||vectorChild);
          if((element.hidden||element.hasAttribute('inert')||
              element.getAttribute('aria-hidden')==='true')&&
             (!mediaWikiPanel||element.hasAttribute('inert')))reason='hidden';
          else {
            const css=document.defaultView?.getComputedStyle?.(element);
            if((css?.display==='none'||css?.visibility==='hidden'||
                css?.visibility==='collapse'||css?.contentVisibility==='hidden')&&
               (!mediaWikiPanel||css?.contentVisibility==='hidden'))reason='hidden';
          }
        }
      }
      if(!reason){
        const root=element.getRootNode?.();
        reason=visibilityReason(element.parentElement||root?.host);
      }
      visibilityCache.set(element,reason);
      return reason;
    };
    const cache=trackRecovery?{
      identity:pageIdentity(),sources:new WeakMap(),contexts:new WeakMap(),
      scopePositions:new Map(),detachedByKey:new Map()
    }:null;
    if(cache)for(const block of recoveryBlocks)if(!block.element.isConnected){
      const key=JSON.stringify([block.text,block.context,block.tag,block.selector,block.scopeIndex]);
      const list=cache.detachedByKey.get(key)||[];
      list.push(block);cache.detachedByKey.set(key,list);
    }
    for(const root of roots){
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        stats.textNodes++;
        if(!/[가-힣]/u.test(node.data)||!/\S/u.test(node.data))continue;
        stats.hangulNodes++;
        const reason=visibilityReason(node.parentElement);
        if(reason){stats[reason==='excluded'?'skippedExcluded':'skippedHidden']++;continue;}
        stats.eligibleNodes++;
        const selected=selectedIntervals(node,node.data,ranges,false);
        if(!selected.length){stats.skippedSelection++;continue;}
        // Track exact DOM nodes and their current source versions, NOT a
        // global string. Two recommendation cards may have identical text.
        if(automatic&&(analyzedNodeVersions.get(node)===node.data||
           isKnownRecoverySource(node))){stats.skippedProcessed++;continue;}
        stats.selectedNodes++;
        const anchor=trackRecovery?recoveryAnchor(node,cache):null;
        if(trackRecovery&&!anchor)stats.recoveryCapReached++;
        entries.set(node,{node,text:node.data,annotations:[],selected,
          recoveryAnchor:anchor,id:String(entries.size)});
      }
      if(includeOwned)for(const node of root.querySelectorAll(OWN_RUBY)){
        if(visibilityReason(node.parentElement))continue;
        const text=node.dataset.kraOriginal||'';
        const selected=selectedIntervals(node,text,ranges,true);
        if(!text||!selected.length)continue;
        entries.set(node,{node,text,annotations:[],selected,
          recoveryAnchor:trackRecovery?recoveryAnchor(node,cache):null,
          isRuby:true,originalHTML:node.innerHTML,originalOuterHTML:node.outerHTML,
          id:String(entries.size)});
      }
    }
    lastScanStats=stats;
    return entries;
  }

  function isKnownRecoverySource(node) {
    if(uiSettings.restoreExistingAnnotations===false||recoveryPage!==pageIdentity())return false;
    const element=node.parentElement?.closest(BLOCK_TAGS)||node.parentElement;
    const block=Array.from(recoveryBlocks).find(b=>b.element===element&&b.annotations.size);
    return Boolean(block&&sourceOf(element).text===block.text);
  }

  function loanwordDisplay(value) {
    return value.replace(/[←→]/g, '');
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function conversionHTML(entry) {
    let value = '', cursor = 0;
    for (const annotation of entry.annotations.sort((a, b) => a.start - b.start)) {
      if (annotation.start < cursor) continue;
      const base = annotation.type === 'hanja' ? annotation.replacement : annotation.surface;
      const reading = annotation.type === 'hanja' ? annotation.surface : loanwordDisplay(annotation.replacement);
      if (annotation.type === 'loanword' && !reading) continue;
      value += escapeHTML(entry.text.slice(cursor, annotation.start));
      const unverified=annotation.origin_source==='model-unverified'||String(annotation.entry_id||'').startsWith('experimental:');
      const source=unverified?'model-unverified':'dictionary';
      const info=unverified?' title="模型提供的词源，尚未经词典核实"':'';
      value += `<ruby class="kra-ruby" kra-annotated="true" data-kra-type="${annotation.type}" data-kra-source="${source}"${info} data-kra-original="${escapeHTML(annotation.surface)}">${escapeHTML(base)}<rt class="kra-annotation kra-unselectable">${escapeHTML(reading)}</rt></ruby>`;
      cursor = annotation.end;
    }
    return value + escapeHTML(entry.text.slice(cursor));
  }

  function findRepaintedTextNode(entry){
    const anchor=entry.recoveryAnchor;
    if(!anchor||entry.isRuby)return null;
    const {block,start}=anchor;
    if(!block?.text||!block.tag)return null;
    const candidates=[];
    // A React re-render can replace just the text node while preserving its
    // span, or replace the entire comment card/span. Rebind only if the exact
    // unannotated source text and original offsets still identify one node.
    if(block.element?.isConnected&&sourceOf(block.element).text===block.text){
      candidates.push(block.element);
    }else{
      const scope=block.scope?.isConnected?block.scope:
        document.querySelectorAll(block.selector)[block.scopeIndex];
      if(!scope)return null;
      for(const element of scope.querySelectorAll(block.tag)){
        if(sourceOf(element).text===block.text)candidates.push(element);
      }
    }
    if(!candidates.length)return null;
    const contextual=candidates.filter(element=>recoveryContext(element)===block.context);
    const matches=contextual.length===1?contextual:
      candidates.length===1?candidates:[];
    if(matches.length!==1)return null;
    const element=matches[0],source=sourceOf(element);
    const runs=source.runs.filter(run=>!run.owned&&run.start===start&&
      run.node?.nodeType===3&&run.node.data===entry.text&&
      run.node.parentElement?.closest('ruby,input,textarea,select,[contenteditable="true"]')===null);
    if(runs.length!==1)return null;
    block.element=element;
    block.context=recoveryContext(element);
    return runs[0].node;
  }

  function insertConversions(entries, operation) {
    const range = document.createRange();
    for (const [originalNode, entry] of entries) {
      if (entry.invalidated || (!entry.annotations.length && !entry.renderRecord && !(entry.isRuby && entry.modelReviewed))) continue;
      let node=entry.node||originalNode;
      // A site's reactive renderer may replace a comment span between
      // analysis and conversion. A unique exact source match can safely
      // receive the same committed result without a fresh model request.
      // Never move a provisional model preview onto a different node.
      const oldRecord=entry.renderRecord;
      const stale=oldRecord?
        !(oldRecord.parent?.isConnected&&oldRecord.inserted.length&&
          oldRecord.inserted.every((n,i)=>n.isConnected&&n.parentNode===oldRecord.parent&&
            n.isEqualNode(oldRecord.snapshots[i])&&
            (i===0||oldRecord.inserted[i-1].nextSibling===n))):
        !node.isConnected||!node.parentNode||(!entry.isRuby&&node.data!==entry.text);
      if(stale&&!entry.isRuby&&!entry.hasPreview){
        const replacement=findRepaintedTextNode(entry);
        if(replacement){
          entry.node=node=replacement;
          if(oldRecord){
            // Keep this logical user action's undo/redo record current.
            oldRecord.parent=node.parentNode;
            oldRecord.original=node;
            oldRecord.originalSnapshot=node.cloneNode(true);
            oldRecord.inserted=[node];
            oldRecord.snapshots=[node.cloneNode(true)];
            entry.renderHTML=null;
          }
        }
      }
      // If a temporary preview was lost, let the committed result retry the
      // new node later instead of permanently invalidating the entry.
      if(stale&&entry.hasPreview)continue;
      // If no new review or local conversion actually replaces an existing
      // ruby, preserve its old annotation instead of inventing a no-op undo.
      const html=entry.isRuby&&!entry.modelReviewed&&!entry.localAnnotations?.length?entry.originalOuterHTML:conversionHTML(entry);
      if(entry.renderHTML===html){
        // Streaming previews are painted before they are committed. Once
        // accepted, the DOM output can be byte-identical: skipping this path
        // previously left recoveryBlocks empty, so the site's next React
        // re-render permanently erased the visible annotation.
        //
        // Commit the source-bound recovery snapshot only after acceptance;
        // never save an unreviewed preview or claim a detached DOM node.
        if(entry.renderRecord&&!entry.hasPreview){
          const record=entry.renderRecord;
          const valid=record.parent?.isConnected&&record.inserted.length&&
            record.inserted.every((n,i)=>n.isConnected&&n.parentNode===record.parent&&
              n.isEqualNode(record.snapshots[i])&&
              (i===0||record.inserted[i-1].nextSibling===n));
          if(valid)rememberRecovery(entry,operation);
          else entry.invalidated=true;
        }
        continue;
      }
      if(!entry.renderRecord&&entry.isRuby&&html===entry.originalOuterHTML)continue;
      let record=entry.renderRecord;
      if(record){
        // Only replace the exact contiguous fragment this operation inserted.
        // A site's own updates always win over late model responses.
        if(!record.parent?.isConnected||!record.inserted.length||!record.inserted.every((n,i)=>n.isConnected&&n.parentNode===record.parent&&n.isEqualNode(record.snapshots[i])&&(i===0||record.inserted[i-1].nextSibling===n))){entry.invalidated=true;continue;}
      }else{
        if(!node.isConnected||!node.parentNode||(entry.isRuby?node.outerHTML!==entry.originalOuterHTML:node.data!==entry.text)){entry.invalidated=true;continue;}
        record={parent:node.parentNode,original:node,originalSnapshot:node.cloneNode(true),inserted:[node]};
      }
      // Select the live insertion anchor, not its parent. The parent itself may
      // be a root or a replaced/detached element with no parentNode, which makes
      // Range.selectNode(parent) throw even when the anchor is valid.
      const anchor=record.inserted[0];
      if(!anchor?.isConnected||anchor.parentNode!==record.parent){entry.invalidated=true;continue;}
      range.selectNode(anchor);
      const fragment=range.createContextualFragment(html),inserted=Array.from(fragment.childNodes);
      entry.renderCount=fragment.querySelectorAll(OWN_RUBY).length;
      for(const n of [...inserted,...record.inserted])ownDomChanges.add(n);
      record.inserted[0].before(fragment);
      for(const old of record.inserted)old.remove();
      record.inserted=inserted;record.snapshots=inserted.map(n=>n.cloneNode(true));
      // Remaining Hangul text fragments belong to the just-reviewed source.
      // Remember these precise nodes, not the text string shared by other cards.
      if(typeof analyzedNodeVersions!=='undefined')
        for(const insertedNode of inserted)if(insertedNode.nodeType===3)
          analyzedNodeVersions.set(insertedNode,insertedNode.data);
      if(!entry.renderRecord){entry.renderRecord=record;operation.push(record);}
      entry.renderHTML=html;
      // Only a verified, successful DOM replacement can supersede a saved
      // annotation. Empty/non-reviewed analyses must not delete the old
      // recovery record or silently count as an undoable write.
      rememberRecovery(entry,operation);
      seenSources.add(entry.text);
    }
    return [...entries.values()].reduce((n,entry)=>n+(entry.renderCount||0),0);
  }

  // Cheap, read-only child-frame preflight. Do not build prompts or mutate DOM
  // for empty/hidden tracker frames. The actual annotation pass still performs
  // its own complete source/selection validation.
  function probeKoreanFrame() {
    if(!document.body)return {ok:true,eligible:false,reason:'no-body'};
    try{
      if(window!==window.top&&
         (window.innerWidth<24||window.innerHeight<20))
        return {ok:true,eligible:false,reason:'zero-size-frame'};
      const outer=window.frameElement;
      if(outer&&(outer.hidden||outer.getAttribute('aria-hidden')==='true'||
         outer.getBoundingClientRect().width<24||outer.getBoundingClientRect().height<20))
        return {ok:true,eligible:false,reason:'hidden-frame'};
    }catch{
      // Cross-origin frames may not expose frameElement: check the own DOM.
    }
    let checked=0,hidden=0,eligible=0;
    const isHidden=element=>{
      const seen=new Set();
      for(let node=element;node&&!seen.has(node);
          node=node.parentElement||node.getRootNode?.().host){
        seen.add(node);
        const recognize=typeof uiSettings==='undefined'||uiSettings.recognizeCollapsedContent!==false;
        const closed=node.closest('details:not([open])');
        const vectorList=node.matches('.vector-toc-list')&&Boolean(node.closest('#vector-toc'));
        const foldedVector=vectorList&&node.parentElement?.matches(
          '.vector-toc-list-item:not(.vector-toc-list-item-expanded)');
        if(!recognize&&(closed&&closed!==node&&!node.closest('summary')||foldedVector))return true;
        const vectorChild=recognize&&node.matches('.vector-toc-list-item')&&
          node.parentElement?.matches('.vector-toc-list')&&
          Boolean(node.closest('#vector-toc'));
        const mediaWikiPanel=recognize&&(node.matches('.mw-collapsible-content')||vectorList||vectorChild);
        if((node.hidden||node.hasAttribute?.('inert')||
            node.getAttribute?.('aria-hidden')==='true')&&
           (!mediaWikiPanel||node.hasAttribute?.('inert')))return true;
        const style=document.defaultView?.getComputedStyle?.(node);
        if((style?.display==='none'||style?.visibility==='hidden'||
            style?.visibility==='collapse'||style?.contentVisibility==='hidden')&&
           (!mediaWikiPanel||style?.contentVisibility==='hidden'))return true;
      }
      return false;
    };
    for(const root of openTextRoots()){
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        checked++;
        if(!/[가-힣]/u.test(node.data))continue;
        const parent=node.parentElement;
        if(parent?.closest('script,style,noscript,input,textarea,select,option,ruby,'+
           '.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,'+
           '.kra-floating-ball,.kra-manual-reopen'))continue;
        if(isHidden(parent)){hidden++;continue;}
        eligible++;
        // Enough evidence to start analysis; no need to walk all ad scripts.
        return {ok:true,eligible:true,reason:'visible-korean',checked,hidden,eligibleNodes:eligible};
      }
    }
    return {ok:true,eligible:false,reason:'no-visible-korean',checked,hidden,eligibleNodes:0};
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

  function refreshTabHistoryCounter(){
    // Render tab-wide logical steps, not the sum of frame-local snapshots.
    if(typeof window!=='undefined'&&window!==window.top)return;
    const el=toolbar?.querySelector('.kra-history-steps');
    if(!el)return;
    void send({type:'KRA_HISTORY_TAB'}).then(reply=>{
      if(!el.isConnected||!reply?.ok)return;
      el.textContent='撤销 '+reply.undoDepth+' 步 · 重做 '+reply.redoDepth+' 步';
      const undo=toolbar.querySelector('.kra-mobile-undo'),redo=toolbar.querySelector('.kra-mobile-redo');
      if(undo)undo.disabled=reply.undoDepth===0;
      if(redo)redo.disabled=reply.redoDepth===0;
    });
  }

  function getToolbar() {
    // Explicit UI boundary; keep frame-local DOM conversion and messaging
    // but prevent embedded documents from creating control overlays.
    if(typeof window!=='undefined'&&window!==window.top)return null;
    if (toolbar?.isConnected) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'kra-mobile-selection-bar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '韩语网页标注');
    toolbar.innerHTML = '<div class="kra-task-status"><span class="kra-task-label" role="status">准备标注</span><progress class="kra-task-progress" max="100" value="0"></progress><span class="kra-history-steps">撤销 0 步 · 重做 0 步</span></div><div class="kra-mobile-actions"><button class="kra-mobile-page" type="button">标注整页</button><button class="kra-mobile-primary" type="button">重新标注选区</button><button class="kra-mobile-review" type="button">模型重审选区</button><button class="kra-manual-open" type="button" hidden>手动审核</button><button class="kra-mobile-undo" type="button">撤销</button><button class="kra-mobile-redo" type="button">重做</button><button class="kra-diagnostic-button" type="button">诊断</button><button class="kra-mobile-restore" type="button">清除全部</button><button class="kra-mobile-close" type="button" aria-label="关闭">×</button></div>';
    // The main toolbar and popup must share the same multi-frame coordinator.
    // Direct startAnnotation() here would silently revert to main-frame-only.
    toolbar.querySelector('.kra-mobile-page').addEventListener('click', () => {
      void send({type:'KRA_START_PAGE_FROM_TOOLBAR',
        modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true},
        uiSettings,forceRegenerate:false}).then(reply=>{
        if(!reply?.ok)status(reply?.error||'整页跨框架标注启动失败',0);
      });
    });
    for(const button of toolbar.querySelectorAll('button'))button.addEventListener('pointerdown',event=>event.preventDefault());
    toolbar.querySelector('.kra-mobile-primary').addEventListener('click',()=>startSelection(false));
    toolbar.querySelector('.kra-mobile-review').addEventListener('click',()=>startSelection(true));
    toolbar.querySelector('.kra-mobile-undo').addEventListener('click',()=>{
      void send({type:'KRA_UNDO_TAB'}).then(result=>{
        if(!result?.ok)status(result?.error||'没有可撤销的标注',0);
        else status('已撤销一步标注',0);
        refreshTabHistoryCounter();
      });
    });
    toolbar.querySelector('.kra-mobile-redo').addEventListener('click',()=>{
      void send({type:'KRA_REDO_TAB'}).then(result=>{
        if(!result?.ok)status(result?.error||'没有可重做的标注',0);
        else status('已重做一步标注',0);
        refreshTabHistoryCounter();
      });
    });
    toolbar.querySelector('.kra-diagnostic-button').addEventListener('click',toggleDiagnostics);
    toolbar.querySelector('.kra-manual-open').addEventListener('click',()=>{const panel=document.querySelector('.kra-manual-review');if(panel){panel.hidden=!panel.hidden;refreshManualReopen();}});
    toolbar.querySelector('.kra-mobile-restore').addEventListener('click',()=>{
      void send({type:'KRA_RESTORE_TAB'}).then(result=>{
        status(result?.ok?'已清除本页及可访问子框架的全部标注（重置撤销历史）':
          result?.error||'无法清除标注',result?.ok?100:0);
        refreshTabHistoryCounter();
      });
    });
    toolbar.querySelector('.kra-mobile-close').addEventListener('click',dismissToolbar);
    document.body.append(toolbar);
    refreshTabHistoryCounter();
    return toolbar;
  }

  function isCompleteManualAnswer(text){
    // Input/paste should submit immediately when a full JSON value exists.
    // Parsing only avoids generating an error on every keystroke, and it does
    // NOT replace the existing batch/choice/repair/security validation.
    if(typeof text!=='string'||!text.trim())return false;
    if(text.length>16*1024*1024)return true; // Let the validator explain the limit.
    let source=text.trim();
    if(source.startsWith('```')){
      const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);
      if(!fence)return false;
      source=fence[1].trim();
    }
    try{JSON.parse(source);return true;}catch{return false;}
  }

  function manualPanel(){
    let panel=document.querySelector('.kra-manual-review');if(panel)return panel;
    panel=document.createElement('section');panel.className='kra-manual-review';panel.setAttribute('aria-label','手动聊天审核');
    panel.innerHTML='<div class="kra-manual-heading"><strong>手动聊天审核</strong><button type="button" class="kra-manual-hide">收起</button></div><p class="kra-manual-summary"></p><p>① 复制提示词给聊天模型。② 粘贴完整 JSON 或导入 JSON/TXT，检测到完整答案立即自动校验并应用，无需点击按钮；发生错误可修改后重新粘贴或手动重试。等待期间请保留本网页。</p><label>发给模型的完整内容<textarea class="kra-manual-prompt" readonly spellcheck="false"></textarea></label><div class="kra-manual-actions"><button type="button" class="kra-manual-copy">复制提示词</button><button type="button" class="kra-manual-download">下载提示词 TXT</button></div><label>粘贴模型返回的完整 JSON<textarea class="kra-manual-response" spellcheck="false" placeholder="粘贴 JSON 或完整的 json 代码块"></textarea></label><div class="kra-manual-actions"><button type="button" class="kra-manual-import">导入 JSON／TXT 答案</button><input class="kra-manual-file" type="file" accept=".json,.txt,application/json,text/plain" aria-label="导入 JSON 或 TXT 答案文件" hidden><button type="button" class="kra-manual-apply">校验并应用／手动重试</button><button type="button" class="kra-manual-cancel">取消本次任务</button></div><p class="kra-manual-status" role="status" aria-live="polite"></p>';
    const note=message=>{panel.querySelector('.kra-manual-status').textContent=message;};
    const scrollToAnswer=()=>{
      // Scroll only this floating panel, never the underlying website.
      // Do not focus the textarea: on mobile that would open the keyboard.
      if(panel.hidden||!panel.isConnected||panel.scrollHeight<=panel.clientHeight)return;
      const answer=panel.querySelector('.kra-manual-response');
      if(!answer)return;
      const top=panel.scrollTop+answer.getBoundingClientRect().top-
        panel.getBoundingClientRect().top-12;
      if(!Number.isFinite(top))return;
      const target=Math.max(0,Math.min(panel.scrollHeight-panel.clientHeight,top));
      try{panel.scrollTo({top:target,behavior:'smooth'});}
      catch{panel.scrollTop=target;}
    };
    const reopen=document.createElement('button');reopen.type='button';reopen.className='kra-manual-reopen';reopen.textContent='打开手动审核';reopen.hidden=true;
    reopen.onclick=()=>{panel.hidden=false;refreshManualReopen();};
    panel.querySelector('.kra-manual-hide').onclick=()=>{panel.hidden=true;refreshManualReopen();};
    panel.querySelector('.kra-manual-copy').onclick=async event=>{
      if(!event.isTrusted)return;
      try{
        const prompt=panel.querySelector('.kra-manual-prompt');
        const copied=await send({type:'KRA_COPY_TEXT',text:prompt.value});
        if(copied?.ok){note('已复制完整提示词。可粘贴到大模型聊天框。');return;}
        try{await navigator.clipboard.writeText(prompt.value);note('已复制完整提示词。可粘贴到大模型聊天框。');}
        catch{prompt.focus();prompt.select();let ok=false;try{ok=document.execCommand('copy');}catch{}note(ok?'已复制完整提示词。可粘贴到大模型聊天框。':'复制失败，已选中文本；可用系统复制或下载 TXT。');}
      }finally{scrollToAnswer();}
    };
    panel.querySelector('.kra-manual-download').onclick=()=>{
      try{
        const text=panel.querySelector('.kra-manual-prompt').value,url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
        a.href=url;a.download=`Korean-Web-Annotator-manual-${panel.dataset.requestId||'prompt'}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);note('提示词已导出为 TXT。');
      }finally{scrollToAnswer();}
    };
    const responseInput=panel.querySelector('.kra-manual-response');
    const applyButton=panel.querySelector('.kra-manual-apply');
    const importButton=panel.querySelector('.kra-manual-import');
    const submitAnswer=()=>{
      const task=currentTask;
      if(!task||task.finished||!task.manualRequest||
         panel.dataset.operationId!==task.operationId||
         panel.dataset.requestId!==task.manualRequest||
         task.manualSubmission?.requestId===task.manualRequest)return false;
      const submitted=responseInput.value;
      const submission={requestId:task.manualRequest,text:submitted};
      task.manualSubmission=submission;
      applyButton.disabled=true;importButton.disabled=true;
      note('已检测到答案，正在校验并应用本批结果…');
      if(task.manualLocalOnly){
        const recovery=task.mergedGroup?recoverMergedManual(task,submitted):applyManualRecovery(task,submitted);
        void recovery.then(()=>{
          if(task.manualSubmission===submission)task.manualSubmission=null;
        }).catch(error=>{
          if(currentTask!==task||task.finished||task.manualRequest!==submission.requestId)return;
          if(task.manualSubmission===submission)task.manualSubmission=null;
          const reason=String(error.message||error).replace(/[。！!]+$/u,'');
          note('答案尚未全部应用：'+reason+'。可直接修改后自动重试，或点击手动按钮；当前批次保留。');
          applyButton.disabled=false;importButton.disabled=false;
        });
        return true;
      }
      task.manualSubmitted={requestId:submission.requestId,text:submitted};
      watchManualReply(task);
      try{
        task.port.postMessage({type:'MANUAL_REVIEW_RESPONSE',operationId:task.operationId,
          requestId:submission.requestId,text:submitted});
      }catch{
        clearInterval(task.keepalive);
        if(recoverManualConnection(task,'提交连接已断开。')){
          if(task.manualSubmission===submission)task.manualSubmission=null;
          // Immediately apply the already pasted answer via local recovery.
          // No second paste or manual click should be required.
          submitAnswer();
        }else{
          if(task.manualSubmission===submission)task.manualSubmission=null;
          clearTimeout(task.manualTimer);applyButton.disabled=false;importButton.disabled=false;
          note('标注连接已断开；答案已保留，请下载保存。');
        }
      }
      return true;
    };
    applyButton.onclick=submitAnswer;
    const autoSubmitAnswer=()=>{
      const task=currentTask;
      if(!task||task.finished||!task.manualRequest||
         panel.dataset.operationId!==task.operationId||
         panel.dataset.requestId!==task.manualRequest)return;
      const value=responseInput.value;
      if(!value.trim())return;
      if(task.manualSubmission?.requestId===task.manualRequest)return;
      if(!isCompleteManualAnswer(value)){
        note('检测到输入，但 JSON 尚未完整或格式无效；继续粘贴／输入，完整后自动应用。');
        return;
      }
      submitAnswer();
    };
    responseInput.addEventListener('input',autoSubmitAnswer);
    responseInput.addEventListener('compositionend',autoSubmitAnswer);
    let fileReadSequence=0;
    const fileInput=panel.querySelector('.kra-manual-file');
    importButton.onclick=()=>fileInput.click();
    fileInput.onchange=async()=>{
      const file=fileInput.files?.[0];fileInput.value='';
      const task=currentTask,requestId=task?.manualRequest,sequence=++fileReadSequence;
      if(!file||!task||task.finished||!requestId||panel.dataset.operationId!==task.operationId)return;
      const stillCurrent=()=>sequence===fileReadSequence&&currentTask===task&&!task.finished&&task.manualRequest===requestId&&panel.dataset.requestId===requestId;
      importButton.disabled=true;applyButton.disabled=true;note(`正在读取 ${file.name}…`);
      try{
        if(!/\.(json|txt)$/i.test(file.name))throw Error('请选择 JSON 或 TXT 答案文件。');
        if(file.size>16*1024*1024)throw Error('答案文件超过 16 MiB，请仅导入当前批次的结果。');
        let readTimer;let text;
        try{text=await Promise.race([file.text(),new Promise((_,reject)=>{readTimer=setTimeout(()=>reject(Error('读取文件超时，请重新导入或粘贴答案。')),15000);})]);}finally{clearTimeout(readTimer);}
        if(!stillCurrent())return;
        responseInput.value=text;
        // Programmatic file reading does not fire the input event.
        // Preserve explicit validation errors for imported malformed JSON.
        submitAnswer();
      }catch(error){if(stillCurrent()){importButton.disabled=false;panel.querySelector('.kra-manual-apply').disabled=false;note(`导入失败：${error.message||error}`);}}
    };
    panel.querySelector('.kra-manual-cancel').onclick=()=>{cancelTask();status('已取消手动审核',0);};
    document.body.append(panel,reopen);return panel;
  }

  function recoverManualConnection(task,reason){
    const backup=task.manualBackup;
    if(task.finished||currentTask!==task)return false;
    if(task.mergedGroup){
      // The original worker may be reaped after a long period with no user
      // input. Keep the draft and page-bound routing so a newly started worker
      // can validate and relay this exact batch back to the original frames.
      if(task.manualFrameStandby&&!task.mergedHost){
        task.manualLocalOnly=true;
        clearInterval(task.keepalive);return true;
      }
      if(!backup?.bindings?.length||!task.manualRequest||
         !Array.isArray(task.manualFrameRouting)||!task.manualFrameRouting.length)return false;
      clearTimeout(task.manualTimer);clearInterval(task.keepalive);
      if(task.manualLocalOnly)return true;
      task.manualLocalOnly=true;
      try{task.port.disconnect();}catch{}
      const panel=document.querySelector('.kra-manual-review');
      if(panel){
        panel.querySelector('.kra-manual-apply').disabled=false;
        panel.querySelector('.kra-manual-import').disabled=false;
        panel.querySelector('.kra-manual-cancel').disabled=false;
        panel.querySelector('.kra-manual-status').textContent=
          reason+' 已切换跨框架安全备份。粘贴答案后仍可校验并应用到原始网页；不会因等待时间长而废弃批次。';
      }
      status('后台连接已重启；手动审核仍可继续。');return true;
    }
    if(!backup?.bindings?.length){
      if(backup?.experimentalPhase==='propose'){
        const panel=document.querySelector('.kra-manual-review');
        if(panel)panel.querySelector('.kra-manual-status').textContent='候选补全请求无法安全离线恢复；请保留已粘贴的 JSON，重新运行标注以继续。';
      }
      return false;
    }
    clearTimeout(task.manualTimer);clearInterval(task.keepalive);
    if(task.manualLocalOnly)return true;
    task.manualLocalOnly=true;task.manualRequest=backup.requestId;
    try{task.port.disconnect();}catch{}
    const panel=document.querySelector('.kra-manual-review');
    panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;
    panel.querySelector('.kra-manual-status').textContent=reason+' 当前批次与剩余批次已保留在本页；继续提交答案即可自动进入下一批。';
    status('当前批次可在本页恢复并应用');return true;
  }

  async function recoverMergedManual(task,text){
    const backup=task.manualBackup,requestId=backup?.requestId;
    if(!backup?.bindings?.length||!requestId||task.manualRequest!==requestId||
       !Array.isArray(task.manualFrameRouting)||!task.manualFrameRouting.length)
      throw Error('当前跨框架审核的安全备份不完整。');
    if(typeof text!=='string'||text.length>16*1024*1024)throw Error('答案不得超过 16 MiB。');
    let json=text.trim();
    const fenced=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(json);
    if(fenced)json=fenced[1].trim();
    let response;try{response=JSON.parse(json);}catch{throw Error('JSON 格式无效。');}
    if(Array.isArray(response)||!response||typeof response!=='object'||!Object.hasOwn(response,'batch_id')){
      const normalize=await (task.manualAnswerNormalizer||import(chrome.runtime.getURL('manual-answer-format.js')).then(m=>m.normalizeManualAnswer));
      response=normalize(response,{requestId,knownTargetIds:new Set(backup.bindings.map(b=>b.target_id))});
    }
    if(response?.batch_id!==requestId||!Array.isArray(response?.results))
      throw Error('batch_id 不符或缺少 results 数组。');
    const result=await chrome.runtime.sendMessage({
      type:'KRA_MANUAL_OFFLINE_APPLY',groupId:task.mergeGroupId,
      frameRouting:task.manualFrameRouting,backup,originalPrompt:task.manualOriginalPrompt,response
    });
    if(currentTask!==task||task.finished||task.manualRequest!==requestId)
      throw Error('审核时页面已改变，不能写入过期的答案。');
    if(!result?.ok)throw Error(result?.error||'无法连接仍在页面中的原始框架。');
    (task.manualApplied ||= new Set()).add(requestId);
    const count=[...task.entries.values()].reduce((n,entry)=>n+(entry.renderCount||0),0);
    const next=task.manualPlan?.find(batch=>!task.manualApplied.has(batch.requestId));
    if(next){
      handleManualEvent(task,{...next,type:'MANUAL_REVIEW_REQUEST'});
      task.manualLocalOnly=true;
      panelStatus('本批已跨框架验证并应用；继续粘贴下一批答案。');
      return;
    }
    const complete=Boolean(task.manualPlan?.length)&&
      task.manualPlan.every(batch=>task.manualApplied.has(batch.requestId));
    const statusText=complete?'全部手动批次已安全应用；可重新打开输入框复制最后一批答案。':
      '本批已应用，但后续批次备份不完整；请保留答案。';
    if(complete){
      finishTask(task,statusText,true);
      status(statusText);publishState();
    }else panelStatus(statusText);
  }

  async function applyMergedOfflineFrame(message){
    const task=currentTask,frame=message?.frame,phase=message?.phase;
    if(!task||task.finished||!task.mergedGroup||!frame||
       task.mergeGroupId!==message.groupId||task.operationId!==frame.operationId||
       !['validate','commit'].includes(phase)||frame.backup?.requestId===undefined||
       !Array.isArray(frame.backup?.bindings)||!frame.backup.bindings.length)
      return {ok:false,error:'原始跨框架页面或审核快照已失效，禁止将答案写入新页面。'};
    const requestId=frame.backup.requestId;
    if(task.manualOfflineCommitted?.has(requestId))return {ok:true,alreadyApplied:true};
    const previous={backup:task.manualBackup,request:task.manualRequest,
      prompt:task.manualOriginalPrompt,accepted:task.manualRecoveryAccepted};
    const isNew=task.manualRecoveryBatchId!==requestId;
    // This temporary scoped view is never derived from a newly scanned page:
    // every target must match the original sentence and live DOM text.
    task.manualBackup=frame.backup;
    task.manualRequest=requestId;
    task.manualOriginalPrompt=frame.originalPrompt||'';
    if(isNew)task.manualRecoveryAccepted=new Map();
    try{
      const checked=await applyManualRecovery(task,frame.answer,{
        advance:false,paint:false,dryRun:phase==='validate'
      });
      if(phase==='commit'){
        (task.manualOfflineCommitted ||= new Set()).add(requestId);
        task.manualRecoveryBatchId=requestId;
        task.paint();
      }
      return {ok:true,checked};
    }catch(error){return {ok:false,error:String(error.message||error)};}
    finally{
      task.manualBackup=previous.backup;
      task.manualRequest=previous.request;
      task.manualOriginalPrompt=previous.prompt;
      if(phase==='validate'||isNew&&!task.manualOfflineCommitted?.has(requestId))
        task.manualRecoveryAccepted=previous.accepted;
    }
  }

  function watchManualReply(task){
    clearTimeout(task.manualTimer);const requestId=task.manualBackup?.requestId;
    task.manualTimer=setTimeout(()=>{if(!task.finished&&currentTask===task&&task.manualBackup?.requestId===requestId)recoverManualConnection(task,'提交后 30 秒未收到后台确认，切换到页面备份。');},30000);
  }

  // Same input/reading constraints as experimental-options.js, using only the
  // trusted target metadata preserved with the manual batch. The dictionary
  // path remains unchanged; unknown spellings are never treated as dictionary choices.
  async function manualLiteralChoice(binding,choiceId,entry,task,row){
    const meta=binding?.literalOrigin;
    if(!meta?.eligible||typeof choiceId!=='string'||!choiceId||choiceId.length>160||
       choiceId!==choiceId.trim()||/[<>\x00-\x1f\x7f]/u.test(choiceId)||
       /^[cnxp]\d+$/i.test(choiceId)||
       Object.keys(row).sort().join(',')!=='c,t')return null;
    const hanja=/^[\p{Script=Han}]+$/u.test(choiceId)&&meta.hanja===true&&task.modes.hanja===true;
    const loanword=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u.test(choiceId)&&
      /\p{Script=Latin}/u.test(choiceId)&&meta.loanword===true&&task.modes.loanword===true;
    if(!hanja&&!loanword)return null;
    if(hanja&&meta.hanjaEligible===false||loanword&&meta.loanwordEligible===false)return null;
    if(!/[가-힣]/u.test(binding.surface)||/\s/u.test(binding.surface))return null;
    if(entry.text.slice(binding.start,binding.end)!==binding.surface)return null;
    const surface=binding.surface,type=hanja?'hanja':'loanword',annotations=[];
    const base={type,entry_id:'experimental:'+type,origin_source:'model-unverified',confidence:1};
    let replacement=choiceId;
    // The model may write the genuine Sino-Korean stem without copying a
    // following native suffix. Accept only an explicit Kiwi XSN/XSM tail.
    let suffixStem=null;
    if(hanja&&/^[가-힣]+$/u.test(surface)){
      const n=[...choiceId].length,source=[...surface];
      if(n>0&&n<source.length){
        const stem=source.slice(0,n).join(''),tail=source.slice(n).join('');
        const trailing=(meta.morphology||[]).filter(m=>m.start>=binding.start+stem.length)
          .sort((a,b)=>a.start-b.start);
        let pos=binding.start+stem.length;
        if(trailing.length&&trailing[0].start===pos&&trailing.every(m=>{
          if(m.start!==pos||!/^(?:XSN|XSM)(?:[-+].*)?$/u.test(m.tag||''))return false;
          pos=m.end;return true;
        })&&pos===binding.end)suffixStem={stem,tail};
      }
    }
    if(suffixStem){
      annotations.push({...base,start:binding.start,end:binding.start+suffixStem.stem.length,
        surface:suffixStem.stem,replacement:choiceId});
      replacement=choiceId+suffixStem.tail;
    }else{
      // Mirror local-engine.js projectAnnotation: retain an unchanged prefix
      // or suffix rather than overwriting adjoining Latin/digit characters.
      const src=[...surface],dst=[...choiceId];let prefix=0,suffix=0;
      while(prefix<src.length&&prefix<dst.length&&src[prefix]===dst[prefix])prefix++;
      while(suffix<src.length-prefix&&suffix<dst.length-prefix&&src[src.length-1-suffix]===dst[dst.length-1-suffix])suffix++;
      const changedSrc=src.slice(prefix,src.length-suffix),changedDst=dst.slice(prefix,dst.length-suffix);
      if(!changedSrc.length)return null;
      const left=src.slice(0,prefix).join('').length,source=changedSrc.join('');
      const make=(a,b,written)=>({...base,start:binding.start+left+a,end:binding.start+left+b,
        surface:source.slice(a,b),replacement:written});
      if(type==='loanword')annotations.push(make(0,source.length,changedDst.join('')));
      else{
        if(changedSrc.length!==changedDst.length)return null;
        let offset=0,runStart=null,runReplacement='';
        for(let i=0;i<changedSrc.length;i++){
          const char=changedDst[i];
          if(/\p{Script=Han}/u.test(char)){
            if(!/^[가-힣]$/u.test(changedSrc[i]))return null;
            if(runStart===null)runStart=offset;
            runReplacement+=char;
          }else if(char!==changedSrc[i])return null;
          else if(runStart!==null){
            annotations.push(make(runStart,offset,runReplacement));runStart=null;runReplacement='';
          }
          offset+=changedSrc[i].length;
        }
        if(runStart!==null)annotations.push(make(runStart,offset,runReplacement));
      }
    }
    if(!annotations.length)return null;
    if(hanja&&task.manualBackup?.hanjaReadingCheck!==false){
      // Load the EXISTING pronunciation verifier only for an offline Hanja
      // proposal. Its data is local to the extension; no background is needed.
      const validateModelHanjaReadings=await (task.manualReadingCheck ||
        import(chrome.runtime.getURL('hanja-reading-check.js')).then(m=>m.validateModelHanjaReadings).catch(()=>null));
      if(typeof validateModelHanjaReadings!=='function'||
         validateModelHanjaReadings(entry.text,annotations).status==='mismatch')return null;
    }
    return {choice_id:choiceId,annotations};
  }

  // Reuse the same source-bound repair geometry checks as the worker. Only
  // literal-origin projection differs here, because the page stays functional
  // without a service worker or its dictionary/engine modules.
  async function verifyPageRepairOrigin(task,repair,sentence){
    const {start,end,surface,choice_id}=repair;
    if(!sentence||sentence.text.slice(start,end)!==surface)return null;
    const binding={start,end,surface,literalOrigin:{
      eligible:true,hanja:task.modes.hanja===true,loanword:task.modes.loanword===true,hanjaEligible:true,loanwordEligible:true,
      known:[],morphology:[]}};
    const row={t:'repair',c:choice_id};
    const direct=await manualLiteralChoice(binding,choice_id,sentence,task,row);
    if(direct)return direct.annotations;
    // A legitimate repair may explicitly preserve Hangul positions between
    // Hanja runs (e.g. uninflected stem + unchanged ending). No synthesized
    // Korean characters are permitted.
    const src=[...surface],dst=[...choice_id||''];
    if(!task.modes.hanja||!src.length||src.length!==dst.length||surface.includes(' ')||
       !/^[가-힣]+$/u.test(surface)||!dst.some(c=>/\p{Script=Han}/u.test(c))||
       !dst.every((c,i)=>/\p{Script=Han}/u.test(c)||c===src[i]))return null;
    const annotations=[];let begin=null,written='';
    const flush=i=>{if(begin===null)return;
      annotations.push({start:start+begin,end:start+i,surface:surface.slice(begin,i),
        replacement:written,type:'hanja',entry_id:'experimental:hanja',
        origin_source:'model-unverified',confidence:1});begin=null;written='';};
    for(let i=0;i<dst.length;i++){
      if(/\p{Script=Han}/u.test(dst[i])){if(begin===null)begin=i;written+=dst[i];}
      else flush(i);
    }
    flush(dst.length);
    if(!annotations.length)return null;
    if(task.manualBackup?.hanjaReadingCheck!==false){
      const validator=await (task.manualReadingCheck||
        import(chrome.runtime.getURL('hanja-reading-check.js')).then(m=>m.validateModelHanjaReadings).catch(()=>null));
      if(typeof validator!=='function'||validator(sentence.text,annotations).status==='mismatch')return null;
    }
    return annotations;
  }

  async function validatePageManualRepairs(task,response){
    const backup=task.manualBackup;
    if(!backup?.smartSegmentation)return {accepted:[],rejected:[]};
    const original=task.manualOriginalPrompt||'',begin=original.indexOf('{"format":"shared-pools-v4"');
    if(!backup.repairValidation||begin<0)return {accepted:[],rejected:[{reason:'页面缺少分词修复安全快照',old_target_ids:[]}]};
    let payload;
    try{payload=JSON.parse(original.slice(begin));}
    catch{return {accepted:[],rejected:[{reason:'原始句子批次快照损坏',old_target_ids:[]}]};}
    const targets=backup.repairValidation.targets||[];
    const scopesBySentence=new Map(backup.repairValidation.scopes||[]);
    const repairScopes=new Map(targets.map(t=>[t.target_id,scopesBySentence.get(t.repair_sentence_key)]));
    const rows=[],serialized=new Set();
    const previous=task.manualRecoveryRepairs||[];
    const newRows=(Array.isArray(response.repairs)?response.repairs:[]).filter(row=>
      !previous.some(old=>row?.sentence_id===old.sentence_id&&(
        Number.isInteger(row.start)&&Number.isInteger(row.end)&&
          row.start<old.end&&old.start<row.end||
        Array.isArray(row.old_target_ids)&&
          row.old_target_ids.some(id=>old.old_target_ids.includes(id))
      )));
    for(const row of [...previous,...newRows]){
      const key=JSON.stringify(row);
      if(!key||serialized.has(key))continue;
      serialized.add(key);rows.push(row);
    }
    const verified=new Map();
    for(const repair of rows){
      if(!repair||repair.choice_id==='KEEP'||repair.op==='delete'||typeof repair.choice_id!=='string')continue;
      const sentence=payload.sentences?.find(s=>s.sentence_id===repair.sentence_id);
      if(!sentence)continue;
      let start=repair.start,end=repair.end;
      if(sentence.text.slice(start,end)!==repair.surface){
        const found=[];let at=sentence.text.indexOf(repair.surface,Math.max(0,start-8));
        while(at>=0&&at<=Math.min(sentence.text.length,start+8)){found.push(at);at=sentence.text.indexOf(repair.surface,at+1);}
        if(found.length!==1)continue;
        start=found[0];end=start+repair.surface.length;
      }
      const annotations=await verifyPageRepairOrigin(task,{...repair,start,end},sentence);
      if(annotations?.length)verified.set(JSON.stringify([repair.sentence_id,start,end,repair.surface,repair.choice_id]),annotations);
    }
    const validator=await (task.manualRepairValidator||
      import(chrome.runtime.getURL('repair-validation-core.js')).then(m=>m.validateSegmentationRepairsCore));
    return validator(targets,{repairs:rows},{
      smartSegmentation:true,payload,repairScopes,
      verifyOrigin:({start,end,surface,choice_id,sentence})=>
        verified.get(JSON.stringify([sentence.sentence_id,start,end,surface,choice_id]))||null
    });
  }

  // Validate the snapshot against today's still-live DOM before retiring any
  // old target. A failed projection invalidates all fragments sharing that ID.
  function stagePageRepairs(task,repairs,entries){
    const records=[],failed=new Set(),reasons=new Map();
    const targets=new Map((task.manualBackup?.repairValidation?.targets||[]).map(t=>[t.target_id,t]));
    const project=(sentenceId,start,end,surface,annotations=[])=>{
      const binding={sentenceId,start,end,surface};
      const parts=task.paragraphPlan?task.paragraphPlan.projectBinding(binding,{annotations}):[{...binding,annotations}];
      if(!parts.length)throw Error('段落无法映射到 DOM');
      return parts.map(part=>{
        const entry=entries.get(part.sentenceId);
        if(!entry||!Number.isInteger(part.start)||!Number.isInteger(part.end)||
           part.start<0||part.end<=part.start||entry.text.slice(part.start,part.end)!==part.surface)
          throw Error('原文 DOM 位置失效');
        if(part.annotations.some(a=>!Number.isInteger(a.start)||!Number.isInteger(a.end)||
            a.start<0||a.end<=a.start||entry.text.slice(a.start,a.end)!==a.surface||
            !['hanja','loanword'].includes(a.type)||
            !entry.selected.some(r=>a.start>=r.start&&a.end<=r.end)))
          throw Error('修复位置或选区无效');
        return {entry,annotations:part.annotations,reviewed:[{start:part.start,end:part.end}]};
      });
    };
    for(const repair of repairs){
      try{
        const parts=project(repair.sentenceKey,repair.start,repair.end,repair.surface,repair.annotations);
        for(const id of repair.old_target_ids){
          const old=targets.get(id);
          if(!old)throw Error('旧 target 不存在');
          parts.push(...project(repair.sentenceKey,old.start,old.end,old.surface));
        }
        records.push({repair,parts});
      }catch(error){
        for(const id of repair.old_target_ids){failed.add(id);reasons.set(id,'修复 DOM 投射失败：'+error.message);}
      }
    }
    // Propagate failures within a connected split/merge group.
    let change=true;
    while(change){
      change=false;
      for(const {repair} of records)if(repair.old_target_ids.some(id=>failed.has(id)))
        for(const id of repair.old_target_ids)if(!failed.has(id)){failed.add(id);change=true;}
    }
    const applied=records.filter(({repair})=>!repair.old_target_ids.some(id=>failed.has(id)));
    const retired=new Set(applied.flatMap(({repair})=>repair.old_target_ids)),groups=new Map();
    for(const {parts} of applied)for(const {entry,annotations,reviewed} of parts){
      if(!groups.has(entry))groups.set(entry,{annotations:[],reviewed:[]});
      const group=groups.get(entry);
      group.annotations.push(...annotations);group.reviewed.push(...reviewed);
    }
    return {applied:applied.map(({repair})=>repair),retired,groups,reasons};
  }

  // Cross-frame offline dry runs must report the original target and cause.
  // This is diagnostic only; the atomic validate-then-commit rule is unchanged.
  function manualMissingTargetDetails(missing,reasons,limit=8){
    const details=missing.slice(0,limit).map(binding=>{
      const id=String(binding.target_id||'(无 ID)');
      const surface=String(binding.surface||'').replace(/\s+/g,' ').slice(0,60);
      const location=typeof binding.sentenceId==='string'?
        '［'+binding.sentenceId+
          (Number.isInteger(binding.start)&&Number.isInteger(binding.end)?
            ':'+binding.start+'-'+binding.end:'')+'］':'';
      const reason=String(reasons.get(binding.target_id)||'本批答案中未找到有效结果').slice(0,180);
      return id+'「'+(surface||'原词未知')+'」'+location+'：'+reason;
    });
    return details.join('；')+
      (missing.length>limit?'；其余 '+(missing.length-limit)+' 个目标请查看本批原始提示词':'');
  }

  // Construct a retry prompt from the original shared pool, keeping the
  // same batch ID and only the sentences/candidates the missing targets need.
  function manualRetryPrompt(task,missing,reasons){
    const batch=task.manualBackup?.requestId||task.manualRequest;
    const intro='本批其他 '+(task.manualRecoveryAccepted?.size||0)+' 个目标已通过校验并保留。'+
      '只回答以下 '+missing.length+' 个目标（用 t 字段指定），不要重发已经完成的目标。'+
      '请逐条核对词义、词性、词源；不能确定时 c 使用 JSON null。'+
      '保持 batch_id='+batch+' 不变；输出只含 batch_id、results（必要时 repairs），不要复制 format、sentences、candidates、targets。'+
      '\n错误原因：\n'+missing.map(b=>b.target_id+'：'+(reasons.get(b.target_id)||'缺少有效答案')).join('\n')+'\n\n';
    const original=task.manualOriginalPrompt||'';
    const begin=original.indexOf('{"format":"shared-pools-v4"');
    if(begin>=0)try{
      const old=JSON.parse(original.slice(begin)),ids=new Set(missing.map(b=>b.target_id));
      const targets=(old.targets||[]).filter(t=>ids.has(t.target_id));
      if(targets.length===missing.length){
        const candidateIds=new Set(targets.flatMap(t=>Object.values(t.options||{})).filter(x=>typeof x==='string'));
        const sentenceIds=new Set(targets.map(t=>t.sentence_id));
        return intro+original.slice(0,begin)+JSON.stringify({...old,
          targets,sentences:(old.sentences||[]).filter(a=>sentenceIds.has(a.sentence_id)),
          candidates:(old.candidates||[]).filter(a=>candidateIds.has(a.candidate_id)),batch_id:batch});
      }
    }catch{}
    return intro+'请参照原批提示词，只回答这些目标：'+JSON.stringify({
      batch_id:batch,targets:missing.map(b=>({target_id:b.target_id,surface:b.surface,
        options:(b.choices||[]).filter(o=>o.choice_id!=='KEEP').map(o=>o.choice_id)}))});
  }

  async function applyManualRecovery(task,text,{advance=true,paint=true,dryRun=false}={}){
    const backup=task.manualBackup;
    if(!backup?.bindings?.length||task.manualRequest!==backup.requestId)throw Error('没有当前批次的恢复数据，请保留答案并重新标注。');
    if(typeof text!=='string'||text.length>16*1024*1024)throw Error('请提供不超过 16 MiB 的完整 JSON 结果。');
    let source=text.trim();const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
    let response;try{response=JSON.parse(source);}catch{throw Error('JSON 格式无效，请粘贴或导入完整 JSON 或 json 代码块。');}
    // A missing wrapper is unambiguous only if every t is in the active batch.
    if(Array.isArray(response)||!response||typeof response!=='object'||!Object.hasOwn(response,'batch_id')){
      const normalize=await (task.manualAnswerNormalizer||import(chrome.runtime.getURL('manual-answer-format.js')).then(m=>m.normalizeManualAnswer));
      response=normalize(response,{requestId:backup.requestId,knownTargetIds:new Set(backup.bindings.map(b=>b.target_id))});
    }
    if(response?.batch_id!==backup.requestId)
      throw Error('batch_id 与当前批次不一致，未应用任何答案。');
    if(!Array.isArray(response?.results))throw Error('结果缺少 results 数组。');
    if(response.repairs!==undefined&&!Array.isArray(response.repairs))
      throw Error('repairs 必须是数组。');
    const bindings=new Map(backup.bindings.map(b=>[b.target_id,b]));
    const entries=new Map([...task.entries.values()].map(entry=>[entry.id,entry]));
    // Manual bindings use paragraph/chunk IDs (p0, p1c0...), NOT DOM
    // text-node IDs (0, 1...). Resolve literal origins against the original
    // sentence before projectBinding maps verified spans back into DOM nodes.
    const sourceSentences=new Map((task.paragraphPlan?.sentences||[]).map(sentence=>[sentence.id,sentence]));
    const repairResult=backup.smartSegmentation?
      await validatePageManualRepairs(task,response):{accepted:[],rejected:[]};
    const stage=stagePageRepairs(task,repairResult.accepted,entries);
    const {retired,groups}=stage;
    const reasons=new Map(stage.reasons),unknown=[];
    for(const item of repairResult.rejected)for(const id of item.old_target_ids||[])
      if(!retired.has(id))reasons.set(id,'分词修复校验失败：'+item.reason);
    if(!dryRun)task.manualRecoveryRepairs=stage.applied.map(r=>({
      sentence_id:r.sentence_id,op:r.op,old_target_ids:r.old_target_ids,
      start:r.start,end:r.end,surface:r.surface,choice_id:r.choice_id
    }));
    const incoming=new Map();
    for(const row of response.results){
      if(!row||typeof row!=='object'||Array.isArray(row)||
         Object.keys(row).sort().join(',')!=='c,t'||
         !bindings.has(row.t)||
         !(row.c===null||(typeof row.c==='string'&&row.c.length>0))){
        if(typeof row?.t==='string'&&bindings.has(row.t))
          reasons.set(row.t,'答案字段不符合 t/c 格式或 c 类型无效');
        unknown.push(String(row?.t??'(无效)'));continue;
      }
      if(!incoming.has(row.t))incoming.set(row.t,[]);
      incoming.get(row.t).push(row);
    }
    const saved=new Map(task.manualRecoveryAccepted||[]);
    for(const [id,rows] of incoming){
      if(saved.has(id))continue; // Never overwrite a previously verified choice.
      if(rows.length!==1){
        reasons.set(id,'重复 target_id（本次出现 '+rows.length+' 条）');continue;
      }
      const row=rows[0],binding=bindings.get(id);
      let choice=row.c===null?binding.choices.find(o=>o.choice_id==='KEEP'):
        binding.choices.find(o=>o.choice_id!=='KEEP'&&o.choice_id===row.c);
      // Use the same nonexistent numbered-key fallback as background review;
      // never apply an unrelated dictionary entry or skip a valid repair.
      if(!choice&&typeof row.c==='string'&&binding.dictionaryPersonHanja?.includes(row.c))
        choice=binding.choices.find(o=>o.choice_id!=='KEEP'&&
          o.annotations?.length===1&&o.annotations[0].type==='hanja'&&
          o.annotations[0].start===binding.start&&o.annotations[0].end===binding.end&&
          o.annotations[0].replacement===row.c);
      if(!choice&&typeof row.c==='string'&&/^[cn]\d+$/u.test(row.c))
        choice=binding.choices.find(o=>o.choice_id==='KEEP');
      const sentence=sourceSentences.get(binding.sentenceId)||entries.get(binding.sentenceId);
      if(!choice&&sentence)
        try{choice=await manualLiteralChoice(binding,row.c,sentence,task,row);}
        catch{choice=null;}
      // An identified row with an unusable origin is not a structural
      // failure: preserve the Korean source. A genuine approved literal was
      // already checked by manualLiteralChoice above (including Latin KEEP).
      if(!choice)choice=binding.choices.find(o=>o.choice_id==='KEEP');
      if(!choice){
        reasons.set(id,'当前目标缺少可用的原文保留选项');continue;
      }
      saved.set(id,{binding,choice});
    }
    if(task.finished||currentTask!==task||task.manualBackup!==backup||task.manualRequest!==backup.requestId)
      throw Error('当前审核批次已取消或改变，未应用过期答案。');
    const verified=new Map();
    // Validate each original span independently so one invalid DOM position
    // does not invalidate unrelated choices. Do not write before validation.
    for(const [id,{binding,choice}] of saved){
      if(retired.has(id))continue;
      try{
        const projected=task.paragraphPlan?task.paragraphPlan.projectBinding(binding,choice):
          [{...binding,annotations:choice.annotations}];
        const checked=[];
        for(const b of projected){
          const entry=entries.get(b.sentenceId);
          if(!entry||!Number.isInteger(b.start)||!Number.isInteger(b.end)||
             b.start<0||b.end<=b.start||entry.text.slice(b.start,b.end)!==b.surface)
            throw Error('原文位置失效');
          const reviewed=entry.selected.some(r=>b.start>=r.start&&b.end<=r.end)?
            [{start:b.start,end:b.end}]:[];
          const annotations=[];
          for(const a of b.annotations){
            if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||
               a.end<=a.start||entry.text.slice(a.start,a.end)!==a.surface||
               typeof a.replacement!=='string'||!['hanja','loanword'].includes(a.type))
              throw Error('标注位置无效');
            if(task.modes[a.type==='hanja'?'hanja':'loanword']&&
               entry.selected.some(r=>a.start>=r.start&&a.end<=r.end)){
              annotations.push(a);reviewed.push({start:a.start,end:a.end});
            }
          }
          checked.push({entry,annotations,reviewed});
        }
        verified.set(id,{binding,choice});
        for(const {entry,annotations,reviewed} of checked){
          if(!groups.has(entry))groups.set(entry,{annotations:[],reviewed:[]});
          groups.get(entry).annotations.push(...annotations);
          groups.get(entry).reviewed.push(...reviewed);
        }
      }catch(error){reasons.set(id,'原文结构无法安全对应：'+error.message);}
    }
    if(!dryRun)task.manualRecoveryAccepted=verified;
    const scanOnly=new Set((backup.repairValidation?.targets||[]).filter(t=>t.scan_only).map(t=>t.target_id));
    const actionable=backup.bindings.filter(b=>!scanOnly.has(b.target_id));
    const completedCount=actionable.filter(b=>verified.has(b.target_id)||retired.has(b.target_id)).length;
    const missing=backup.bindings.filter(b=>!verified.has(b.target_id)&&
      !retired.has(b.target_id)&&!scanOnly.has(b.target_id));
    if(missing.length){
      if(dryRun)throw Error('尚有 '+missing.length+' 个目标未通过安全校验：'+
         manualMissingTargetDetails(missing,reasons));
      // Preview only, never commit or finish until all targets are verified.
      const prepared=[...groups].map(([entry,group])=>{
        const model=[...(entry.committedModelAnnotations||[]).filter(a=>
          !group.reviewed.some(r=>r.start<a.end&&a.start<r.end)),...group.annotations];
        return {entry,model,annotations:[...(entry.localAnnotations||[]).filter(a=>
          !group.reviewed.some(r=>r.start<a.end&&a.start<r.end)),...model]};
      });
      for(const {entry,model,annotations} of prepared){
        entry.modelAnnotations=model;entry.annotations=annotations;entry.modelReviewed=true;entry.hasPreview=true;
      }
      const count=paint?task.paint():0;
      task.manualPreviewCount=count;
      const panel=document.querySelector('.kra-manual-review');
      if(panel){
        panel.querySelector('.kra-manual-prompt').value=manualRetryPrompt(task,missing,reasons);
        panel.querySelector('.kra-manual-summary').textContent+=
          '\n已保存 '+completedCount+'/'+actionable.length+' 条；仅需补交 '+missing.length+' 条。';
      }
      const details=manualMissingTargetDetails(missing,reasons);
      const message='本批结果不完整：已验证 '+completedCount+'/'+actionable.length+' 条，页面已预览 '+count+
        ' 个标注；剩余 '+missing.length+' 条待补交：'+details+
        (missing.length>8?'；其余见补交提示词':'')+
        (unknown.length?'。已忽略未知或跨批 target_id '+unknown.slice(0,4).join('、'):'')+
        (repairResult.rejected.length?'。已安全拒绝 '+repairResult.rejected.length+' 条无效修复':'')+
        '。请只提交新提示词中的目标。';
      if(count)status('已预览 '+count+' 个标注，仍有 '+missing.length+' 个目标待补交');
      throw Error(message);
    }
    // Validation has not written a single annotation to the DOM.
    if(dryRun)return {accepted:verified.size,retired:retired.size};
    // All IDs, choices and source spans are verified before changing any entry.
    for(const [entry,group] of groups){
      const model=[...(entry.committedModelAnnotations||entry.modelAnnotations||[]).filter(a=>!group.reviewed.some(r=>r.start<a.end&&a.start<r.end)),...group.annotations];
      entry.modelAnnotations=model;entry.committedModelAnnotations=model;entry.modelReviewed=true;entry.committedModelReviewed=true;entry.hasPreview=false;
      entry.annotations=[...(entry.localAnnotations||[]).filter(a=>!group.reviewed.some(r=>r.start<a.end&&a.start<r.end)),...model];
    }
    (task.manualApplied ||= new Set()).add(backup.requestId);
    if(!advance)return;
    const count=paint?task.paint():0;
    const next=task.manualPlan?.find(batch=>!task.manualApplied.has(batch.requestId));
    if(next){
      handleManualEvent(task,{...next,type:'MANUAL_REVIEW_REQUEST'});task.manualLocalOnly=true;
      panelStatus(`本批已应用，当前显示 ${count} 个标注。后台断线，已从本页备份继续下一批。`);
      return;
    }
    const complete=!task.experimentalRecoveryIncomplete&&Boolean(task.manualPlan?.length)&&task.manualPlan.every(batch=>task.manualApplied.has(batch.requestId));
    const message=`本批答案已在页面校验并应用，当前显示 ${count} 个标注。${complete?'全部手动批次已完成。':'本批已恢复，但缺少后续批次备份，请保留答案。'}`;
    if(complete){for(const entry of task.entries.values()){
      seenSources.add(entry.text);
      if(typeof analyzedNodeVersions!=='undefined'&&entry.node?.nodeType===3&&entry.node.isConnected&&entry.node.data===entry.text)
        analyzedNodeVersions.set(entry.node,entry.text);
    }if(task.wholePage)pageCompleted=true;}
    finishTask(task,message,complete);status(message);if(complete)configureAutomaticAnnotation();publishState();
  }

  function panelStatus(message){const panel=document.querySelector('.kra-manual-review');if(panel)panel.querySelector('.kra-manual-status').textContent=message;}

  function handleManualEvent(task,event){
    if(event.type==='MANUAL_REVIEW_REQUEST'&&task.pendingAcceptedRecovery){
      const pending=task.pendingAcceptedRecovery;
      void pending.finally(()=>{
        if(currentTask===task&&!task.finished)handleManualEvent(task,event);
      });
      return;
    }
    const panel=manualPanel();
    if(event.type==='MANUAL_REVIEW_REQUEST'){
      clearTimeout(task.manualTimer);task.manualLocalOnly=false;task.manualRecoveryAccepted=new Map();task.manualOriginalPrompt=event.text;task.manualBackup={requestId:event.requestId,bindings:event.bindings,
        repairValidation:event.repairValidation,smartSegmentation:event.smartSegmentation===true,
        hanjaReadingCheck:event.hanjaReadingCheck!==false,experimentalPhase:event.experimentalPhase,
        batchNumber:event.batchNumber,batchTotal:event.batchTotal};task.manualRecoveryRepairs=[];
      if(event.experimentalPhase)task.experimentalRecoveryIncomplete=true;
      task.manualAcceptedAwaitingDone=null;
      task.manualRequest=event.requestId;panel.dataset.operationId=task.operationId;panel.dataset.requestId=event.requestId;
      panel.querySelector('.kra-manual-summary').textContent=`${event.experimentalPhase==='propose'?'实验性候选补全 · ':event.experimentalPhase==='choose'?'补充候选复审 · ':''}第 ${event.batchNumber}/${event.batchTotal||event.batchNumber} 批次 · ${event.targetCount} 个词 · ${event.text.length.toLocaleString()} 字符（仅任务内容，无 API Key）`;
      if(event.budget){const b=event.budget;panel.querySelector('.kra-manual-summary').textContent+=`\n${b.label}档 · 预估输入 ${b.inputTokens.toLocaleString()} / 答案 ${b.outputTokens.toLocaleString()} tokens${b.contextTokens?` / 余量 ${b.safetyTokens.toLocaleString()}（窗口 ${b.contextTokens.toLocaleString()}）`:''}${b.limitReason==='output'?' · 受答案长度预算限制':''}。估算与实际分词可能不同。`;}
      task.manualSubmission=null;
      panel.querySelector('.kra-manual-prompt').value=event.text;panel.querySelector('.kra-manual-response').value='';
      panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;panel.querySelector('.kra-manual-file').value='';panel.querySelector('.kra-manual-cancel').disabled=false;
      panel.querySelector('.kra-manual-status').textContent='等待粘贴或导入本批结果；未调用 API。';panel.hidden=false;
      const firstAppearance=!task.manualPanelShown;task.manualPanelShown=true;
      if(firstAppearance&&uiSettings.hideToolbarOnFirstManual!==false)dismissToolbar();
      refreshManualReopen();
      configureRecovery();
      // Non-merged iframe selection can still use its explicit manual panel,
      // but it must not create a secondary page toolbar.
      const manualButton=getToolbar()?.querySelector('.kra-manual-open');
      if(manualButton)manualButton.hidden=false;
      status(`等待手动回填：第 ${event.batchNumber}/${event.batchTotal||event.batchNumber} 批次（${event.targetCount} 个词）`);return;
    }
    if(panel.dataset.operationId!==task.operationId||event.requestId!==task.manualRequest)return;
    if(event.type==='MANUAL_REVIEW_ERROR'){
      task.manualSubmission=null;
      clearTimeout(task.manualTimer);if(event.recoverable&&recoverManualConnection(task,event.error))return;
      if(Array.isArray(event.acceptedRows)&&!task.mergedGroup){
        const answer=JSON.stringify({batch_id:event.requestId,results:event.acceptedRows,
          ...(event.acceptedRepairs?{repairs:event.acceptedRepairs}:{})});
        panel.querySelector('.kra-manual-apply').disabled=true;panel.querySelector('.kra-manual-import').disabled=true;
        void applyManualRecovery(task,answer).catch(error=>{
          addDiagnostic({level:'info',message:'部分审核结果：'+error.message});
        }).finally(()=>{
          if(currentTask!==task||task.finished||task.manualRequest!==event.requestId)return;
          if(event.repairPrompt){
            panel.querySelector('.kra-manual-prompt').value=event.repairPrompt;
            panel.querySelector('.kra-manual-response').value='';
          }
          const preview=task.manualPreviewCount||0;
          panel.querySelector('.kra-manual-status').textContent=event.error+
            (preview?'\n已在当前网页显示 '+preview+' 个标注；未完成目标不影响已显示结果。':
             '\n本批有效选择尚未生成可显示标注；请检查审核目标及页面结构。');
          panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;
        });
      }else{
        if(event.repairPrompt){
          panel.querySelector('.kra-manual-prompt').value=event.repairPrompt;
          panel.querySelector('.kra-manual-response').value='';
        }
        panel.querySelector('.kra-manual-status').textContent=event.error+
         (task.mergedGroup?'\n各框架有效结果仍由后台分别处理；请按当前补交提示继续。':'');
        panel.querySelector('.kra-manual-apply').disabled=false;
        panel.querySelector('.kra-manual-import').disabled=false;
      }
    }else{
      task.manualSubmission=null;
      clearTimeout(task.manualTimer);
      const submitted=Array.isArray(event.acceptedRows)?
        JSON.stringify({batch_id:event.requestId,results:event.acceptedRows,
           ...(event.acceptedRepairs?{repairs:event.acceptedRepairs}:{})}):
        (task.manualSubmitted?.requestId===event.requestId?task.manualSubmitted.text:panel.querySelector('.kra-manual-response').value);
      // The background already validated any model-origin string. Do not
      // overwrite it with a page-only recovery that lacks these options.
      let requiresBackground=false;
      try{
        const known=new Map((task.manualBackup?.bindings||[]).map(b=>[b.target_id,b]));
        const parsed=JSON.parse(submitted);
        requiresBackground=parsed.repairs!==undefined&&(!Array.isArray(parsed.repairs)||parsed.repairs.length>0)||
         parsed.results?.some(row=>{
          const binding=known.get(row?.t);
          return binding&&!((row.c===null&&binding.choices.some(o=>o.choice_id==='KEEP'))||
            binding.choices.some(o=>o.choice_id!=='KEEP'&&o.choice_id===row.c));
        })===true;
      }catch{}
      if(!task.mergedGroup&&!requiresBackground){
        const requestId=event.requestId;
        const pending=applyManualRecovery(task,submitted,{advance:false,paint:false})
          .catch(error=>addDiagnostic({level:'warning',message:'页面批次备份未确认：'+error.message}));
        task.pendingAcceptedRecovery=pending;
        void pending.finally(()=>{
          if(task.pendingAcceptedRecovery===pending)task.pendingAcceptedRecovery=null;
          if(task.manualRequest===requestId&&!task.manualLocalOnly)task.manualRequest=null;
        });
      }else if(task.mergedGroup){
        (task.manualApplied ||= new Set()).add(event.requestId);
        // ACCEPTED precedes actual model result delivery. Keep the source
        // backup and request identity until DONE (or the next request), so
        // an idle worker shutdown cannot turn an accepted row into a dead UI.
        task.manualAcceptedAwaitingDone=event.requestId;
        task.manualTimer=setTimeout(()=>{
          if(currentTask===task&&!task.finished&&!task.manualLocalOnly&&
             task.manualAcceptedAwaitingDone===event.requestId)
            recoverManualConnection(task,'批次已通过校验，但后续写入回报迟迟未到。');
        },90000);
      }else task.manualRequest=null;
      panel.querySelector('.kra-manual-apply').disabled=true;panel.querySelector('.kra-manual-import').disabled=true;panel.querySelector('.kra-manual-status').textContent=`本批 ${event.targetCount} 个结果已通过校验，正在写入并准备下一步…`;
    }
  }

  function status(message, percent) {
    // The worker receives frame-local progress; only the primary document
    // should render progress and control buttons.
    if(!document.body||(typeof window!=='undefined'&&window!==window.top))return;
    const bar = getToolbar();
    bar.querySelector('.kra-task-label').textContent = message;
    const progress = bar.querySelector('.kra-task-progress');
    if (Number.isFinite(percent)) progress.value = Math.max(0, Math.min(100, percent));
    else progress.removeAttribute('value');
    refreshToolbar();
  }

  function finishTask(task,reason='本次任务已结束。答案仍保留可复制；重新标注会生成新批次。',completed=false) {
    if (task.finished) return;
    task.reconcile?.();
    task.finished = true;
    clearTimeout(task.manualTimer);task.manualSubmission=null;task.manualBackup=null;
    task.manualRequest=null;
    const manual=document.querySelector('.kra-manual-review');
    if(manual?.dataset.operationId===task.operationId){
      manual.querySelector('.kra-manual-apply').disabled=true;manual.querySelector('.kra-manual-import').disabled=true;manual.querySelector('.kra-manual-cancel').disabled=true;manual.querySelector('.kra-manual-status').textContent=reason;
      // Only successful completion auto-collapses the editor; preserve the
      // prompt/response for later inspection and copying via the reopen control.
      if(completed){manual.hidden=true;refreshManualReopen();}
    }
    clearInterval(task.keepalive);
    if (currentTask === task) currentTask = null;
    configureRecovery();
    try { task.port.disconnect(); } catch {}
  }

  function cancelTask() {
    const task = currentTask;
    if (!task) return;
    try { task.port.postMessage({ type: 'CANCEL', operationId: task.operationId }); } catch {}
    finishTask(task,'任务已取消；答案仍保留可复制，已取消的任务不能继续应用。');
  }

  function restorePage() {
    resetRecovery();
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();history.length=0;redoStack.length=0;seenSources.clear();
    // A full restore removes extension rubies in THIS frame, including
    // open Shadow DOM. The tab coordinator calls every accessible frame.
    let removed=0;
    for(const root of openTextRoots())for(const ruby of root.querySelectorAll(OWN_RUBY)){
      ruby.replaceWith(document.createTextNode(ruby.dataset.kraOriginal||''));removed++;
    }
    status('已还原', 0);
    send({ type: 'SET_BADGE', text: '' });
    publishState();
    return {ok:true,removed};
  }

  function latestUndoState() {
    const current=history.at(-1),undone=redoStack.at(-1);
    return {ok:true,groupId:current?.groupId||null,
      startedAt:current?.startedAt||0,depth:history.length,
      redoGroupId:undone?.groupId||null,redoStartedAt:undone?.startedAt||0,
      redoDepth:redoStack.length,
      undoGroups:history.map(op=>({groupId:op.groupId,startedAt:op.startedAt})),
      redoGroups:redoStack.map(op=>({groupId:op.groupId,startedAt:op.startedAt}))};
  }

  function sameLiveNodes(record,nodes,snapshots){
    return record.parent?.isConnected&&nodes?.length>0&&
      nodes.every((node,i)=>node.isConnected&&node.parentNode===record.parent&&
        node.isEqualNode(snapshots[i])&&
        (i===0||nodes[i-1].nextSibling===node));
  }

  function undoLast(groupId=null) {
    const operation=history.at(-1);
    if(!operation)return {ok:false,error:'没有可撤销的标注'};
    if(groupId!==null&&operation.groupId!==groupId)
      return {ok:false,skipped:true,error:'其他框架的历史步骤不属于本次撤销'};
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();
    if(history.at(-1)!==operation)
      return {ok:false,error:'任务刚刚写入新结果，请再次点击撤销最新的步骤。'};
    let changed=0;
    for(const record of [...operation].reverse()){
      if(!sameLiveNodes(record,record.inserted,record.snapshots))continue;
      const original=record.original.isEqualNode(record.originalSnapshot)?
        record.original:record.originalSnapshot.cloneNode(true);
      for(const node of [...record.inserted,original])ownDomChanges.add(node);
      record.inserted[0].before(original);
      for(const node of record.inserted)node.remove();
      record.undoneState={node:original,snapshot:original.cloneNode(true)};
      changed++;
    }
    // Persist both sides of each recovery record. Dynamic React redraws may
    // remove the actual nodes; the source-bound recovery cache restores them.
    if(operation.recoveryBefore?.size){
      operation.recoveryAfter=new Map([...operation.recoveryBefore.keys()].map(block=>
        [block,new Map(block.annotations)]));
      for(const [block,before]of operation.recoveryBefore)
        if(recoveryBlocks.has(block))block.annotations=new Map(before);
    }
    if(!changed&&!operation.recoveryBefore?.size)
      return {ok:false,error:'网页已经替换了此步骤涉及的节点；无法安全撤销。'};
    history.pop();redoStack.push(operation);
    configureRecovery();
    if(changed<operation.length)restoreKnownAnnotations();
    status('已撤销一步标注',0);publishState();refreshTabHistoryCounter();
    return {ok:true,changed,depth:history.length,redoDepth:redoStack.length};
  }

  function redoLast(groupId=null) {
    const operation=redoStack.at(-1);
    if(!operation)return {ok:false,error:'没有可重做的标注'};
    if(groupId!==null&&operation.groupId!==groupId)
      return {ok:false,skipped:true,error:'其他框架的历史步骤不属于本次重做'};
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();
    if(redoStack.at(-1)!==operation)
      return {ok:false,error:'期间有新的标注完成，不能再重做旧步骤。'};
    let changed=0;
    for(const record of operation){
      const state=record.undoneState;
      if(!state||!sameLiveNodes(record,[state.node],[state.snapshot]))continue;
      const nodes=record.inserted.map((n,i)=>
        n.isEqualNode(record.snapshots[i])?n:record.snapshots[i].cloneNode(true));
      for(const node of [...nodes,state.node])ownDomChanges.add(node);
      state.node.before(...nodes);state.node.remove();
      record.inserted=nodes;record.snapshots=nodes.map(n=>n.cloneNode(true));
      record.undoneState=null;changed++;
    }
    // A site may mutate or remove the old nodes between Undo and Redo.
    // A recovery snapshot only authorizes replay if its original source
    // survives verbatim, never merely because a Map still has entries.
    const recoverable=Boolean(operation.recoveryAfter?.size&&
      typeof sourceOf==='function'&&[...operation.recoveryAfter].some(([block,after])=>
        after.size&&block.element?.isConnected&&sourceOf(block.element).text===block.text));
    if(!changed&&!recoverable)
      return {ok:false,error:'网页已更改原文；无法安全重做此步骤。'};
    if(operation.recoveryAfter)for(const [block,after]of operation.recoveryAfter)
      if(recoveryBlocks.has(block))block.annotations=new Map(after);
    redoStack.pop();history.push(operation);
    configureRecovery();
    if(changed<operation.length)restoreKnownAnnotations();
    status('已重做一步标注',0);publishState();refreshTabHistoryCounter();
    return {ok:true,changed,depth:history.length,redoDepth:redoStack.length};
  }

  function startSelection(reviewAll) {
    const ranges=captureSelection()||selectionSnapshot;
    if(!ranges?.length)return {ok:false,error:'请先选中需要标注的文字。'};
    return startAnnotation({ranges,reviewAll,forceRegenerate:true,modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true}});
  }

  let createParagraphPlan;
  let paragraphModule;
  function startAnnotation(message) {
    if(!createParagraphPlan){
      paragraphModule ||= import(chrome.runtime.getURL('paragraph-plan.js'));
      return paragraphModule.then(module=>{createParagraphPlan=module.createParagraphPlan;return startAnnotation(message);}).catch(error=>{status('无法加载段落分析模块，请刷新网页重试');return {ok:false,error:error.message};});
    }
    const modes = { hanja: message.modes?.hanja ?? true, loanword: message.modes?.loanword ?? true };
    if (!modes.hanja && !modes.loanword) return { ok: false, error: '请至少启用一种标注模式。' };
    cancelTask();
    const oldManual=document.querySelector('.kra-manual-review');if(oldManual){oldManual.hidden=true;delete oldManual.dataset.operationId;}
    const oldReopen=document.querySelector('.kra-manual-reopen');if(oldReopen)oldReopen.hidden=true;
    if(!message.automatic){toolbarDismissed=false;diagnostics.length=0;}
    const ranges=message.ranges||null;
    const domScanStarted=Date.now();
    const entries = collectTextNodes(ranges,Boolean(ranges||message.forceRegenerate),Boolean(message.automatic),true);
    const domScanMs=Date.now()-domScanStarted;
    const scan={...(lastScanStats||{}),collected:entries.size};
    if(entries.size||message.mergeHost===true)pageHasHangul=true;
    if(!message.automatic||entries.size||scan.skippedHidden||scan.skippedProcessed){
      addDiagnostic({stage:'scan',level:scan.recoveryCapReached?'warning':'info',
        message:`网页文本扫描：检测 ${scan.textNodes} 个文本节点，含韩文 ${scan.hangulNodes}，进入分析 ${entries.size}；隐藏跳过 ${scan.skippedHidden}，已有标注/已处理跳过 ${scan.skippedProcessed}，开放式 Shadow DOM ${scan.shadowRoots}。`,
        detail:JSON.stringify({...scan,source:'DOM',mode:message.automatic?'incremental':'initial'})});
    }
    if (!entries.size&&!message.mergeGroupId) {
      status('没有未标注的韩语文字', 100);
      return {ok:true,started:false};
    }
    let paragraphPlan;
    const paragraphPlanStarted=Date.now();
    try{
      paragraphPlan=entries.size?
        createParagraphPlan(entries,sourceOf,BLOCK_TAGS):
        {sentences:[],context:'',projectBinding:()=>[],idByNode:new WeakMap()};
    }catch(error){return {ok:false,error:error.message};}
    const paragraphPlanMs=Date.now()-paragraphPlanStarted;
    addDiagnostic({stage:'performance',level:'info',
      message:`网页准备耗时：DOM 扫描 ${domScanMs}ms，段落构建 ${paragraphPlanMs}ms；${entries.size} 个文本节点 → ${paragraphPlan.sentences.length} 段。`,
      detail:JSON.stringify({domScanMs,paragraphPlanMs,domNodes:entries.size,
        paragraphs:paragraphPlan.sentences.length,
        largestParagraphChars:Math.max(0,...paragraphPlan.sentences.map(s=>s.text.length))})});
    const operationId = `page-${Date.now().toString(36)}-${++sequence}`;
    let port;
    try { port = chrome.runtime.connect({ name: 'KRA_SENTENCE_STREAM_V1' }); }
    catch (error) { status('扩展已更新，请刷新网页后重试', 0); return { ok: false, error: error.message }; }
    const task = { operationId, port, entries, paragraphPlan, modes, scan,
      mergeGroupId:message.mergeGroupId,
      mergedGroup:typeof message.mergeGroupId==='string'&&message.mergeGroupId.length>0,
      mergedHost:message.mergeHost===true,startedAutomatically:message.automatic===true,
      startPageUrl:typeof location!=='undefined'?location.href:document.location?.href||'', finished: false, progressive:uiSettings.progressiveAnnotation===true, wholePage:!ranges,
      operation:[], historyRecorded:false };
    // Associate all frames of one whole-page review with the same undo
    // transaction; selection and automatic tasks use their own operationId.
    task.operation.groupId=message.mergeGroupId||operationId;
    task.operation.startedAt=Date.now();
    const paint=(changed=entries)=>{insertConversions(changed,task.operation);const count=[...entries.values()].reduce((n,entry)=>n+(entry.renderCount||0),0);if((task.operation.length||task.operation.recoveryBefore?.size)&&!task.historyRecorded){history.push(task.operation);task.historyRecorded=true;
      if(history.length>HISTORY_LIMIT)history.shift();
      redoStack.length=0;
      // Every new successful annotation action invalidates other frames'
      // undone branch, even when this frame itself had no redo steps.
      void send({type:'KRA_HISTORY_NEW_BRANCH',groupId:task.operation.groupId});
      refreshTabHistoryCounter();}return count;};
    task.paint=paint;
    task.reconcile=()=>{for(const entry of entries.values())if(entry.hasPreview){entry.modelAnnotations=entry.committedModelAnnotations||[];entry.modelReviewed=entry.committedModelReviewed||false;entry.hasPreview=false;const model=entry.modelAnnotations;entry.annotations=[...(entry.localAnnotations||[]).filter(a=>!
           [...model,...(entry.modelReviewedRanges||[])].some(b=>b.start<a.end&&b.end>a.start)),...model];}if(task.progressive)paint();};
    const byId = new Map([...entries.values()].map(entry => [entry.id, entry]));
    currentTask = task;
    status('准备分析…');
    port.onDisconnect.addListener(() => {
      if (task.finished||task.manualLocalOnly) return;
      clearInterval(task.keepalive);
      if(recoverManualConnection(task,'标注后台连接已中断。'))return;
      status('分析连接中断，请重试', 0);
      finishTask(task);
    });
    port.onMessage.addListener(async result => {
      // An accepted manual batch is persisted asynchronously before the
      // worker advances or sends DONE. Wait for that checkpoint, otherwise
      // finishTask() can clear the backup and reject a valid late answer.
      if(result.type==='DONE'&&task.pendingAcceptedRecovery)
        await task.pendingAcceptedRecovery;
      if (task.finished || currentTask !== task || result.operationId !== operationId) return;
      if(task.manualLocalOnly)return;
      if(result.type==='MANUAL_REVIEW_STANDBY'){
        task.manualFrameStandby=true;return;
      }
      if(result.type==='MANUAL_REVIEW_PLAN'){
        task.manualPlan=result.batches;
        task.manualFrameRouting=result.frameRouting;
        // Warm the local pronunciation table while the extension is connected;
        // the cached module remains usable if the worker disconnects later.
        if(result.batches?.some(batch=>batch.bindings?.some(b=>b.literalOrigin?.eligible&&b.literalOrigin.hanja)))
          task.manualReadingCheck=import(chrome.runtime.getURL('hanja-reading-check.js'))
            .then(m=>m.validateModelHanjaReadings).catch(()=>null);
        return;
      }
      if(['MANUAL_REVIEW_REQUEST','MANUAL_REVIEW_ERROR','MANUAL_REVIEW_ACCEPTED'].includes(result.type)){handleManualEvent(task,result);return;}
      if (result.type === 'ERROR') { addDiagnostic({level:'error',message:result.error});if(recoverManualConnection(task,result.error||'标注后台异常。'))return;status(result.error || '分析失败', 0); finishTask(task,result.error||'分析失败'); return; }
      if (result.type === 'DIAGNOSTIC') {
        addDiagnostic(result.diagnostic||{});
        if (result.diagnostic?.level === 'error') status(result.diagnostic.message || '分析错误', 0);
        return;
      }
      if(result.type==='LOCAL_PROGRESS'){
        status(result.stage==='dictionary'?'加载词典…':result.stage==='tokenizer'?'初始化分词器…':`正在分析第 ${result.currentSentence}/${result.totalSentences} 段（${result.sentenceCharacters} 字符） · ${result.percent}%`);
        return;
      }
      if (result.type === 'MODEL_PROGRESS') {
        status(result.modelTotal ? `模型审核 ${result.modelCompleted || 0}/${result.modelTotal}` : '模型：无需审核');
        return;
      }
      if (result.type !== 'RESULTS' && result.type !== 'DONE') return;
      if(result.type==='DONE'&&task.manualRequest&&
         task.manualApplied?.has(task.manualRequest)){
        // DONE is the final source-bound commit proof for an accepted merged
        // batch. Other pending answers still require explicit confirmation.
        task.manualRequest=null;
        task.manualAcceptedAwaitingDone=null;
        clearTimeout(task.manualTimer);
      }
      if(result.type==='DONE'&&task.manualRequest){
        if(recoverManualConnection(task,'后台已结束，但本批答案尚未确认；切换到页面备份继续应用。'))return;
        // A merged batch may include targets from other documents, so never
        // silently treat the main frame alone as the completed review.
        const reason='跨框架审核的后台已结束，但仍有未应用的答案。已保留输入，请勿误认为全部完成；请重新开始跨框架审核。';
        addDiagnostic({level:'warning',message:reason});
        finishTask(task,reason,false);return;
      }
      globalThis.__KRA_PIPELINE_STATUS__ = { ...globalThis.__KRA_PIPELINE_STATUS__,
        scan:task.scan,stats: result.stats, engine_version: result.engine_version,
        dictionary_metadata: result.dictionary_metadata };
      const changedEntries=new Map();
      for (const item of (result.results||[]).flatMap(item=>task.paragraphPlan.projectResult(item,{source:result.source,provisional:result.provisional}))) {
        const entry = byId.get(item.id);
        if (!entry) continue;
        changedEntries.set(entry.node,entry);
        const incoming=[];
        for (const annotation of item.annotations || []) {
          if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start < 0 || annotation.end <= annotation.start || annotation.end > entry.text.length || entry.text.slice(annotation.start, annotation.end) !== annotation.surface || typeof annotation.replacement !== 'string' || !annotation.replacement || !['hanja', 'loanword'].includes(annotation.type) || !modes[annotation.type === 'hanja' ? 'hanja' : 'loanword'] || !entry.selected.some(r=>annotation.start>=r.start&&annotation.end<=r.end)) continue;
          incoming.push(annotation);
        }
        if(result.source==='model'){
          entry.modelAnnotations=incoming;
          entry.modelReviewedRanges=result.smartSegmentation===true?(item.reviewed||[]):[];
          entry.modelReviewed=Boolean(item.reviewed?.length||incoming.length);
          entry.hasPreview=item.hasPreview??result.provisional===true;
          entry.committedModelAnnotations=item.committedAnnotations??incoming;
          entry.committedModelReviewed=item.committedReviewed??entry.modelReviewed;
        }else entry.localAnnotations=incoming;
        const model=entry.modelAnnotations||[];
        entry.annotations=[...(entry.localAnnotations||[]).filter(a=>!model.some(b=>b.start<a.end&&b.end>a.start)),...model];
      }
      if (result.type === 'RESULTS') {
        if(task.progressive){const count=paint(changedEntries);status(`已显示 ${count} 个标注；分析 ${Math.round(result.percent || 0)}%`, result.percent || 0);}
        else status(`分析 ${Math.round(result.percent || 0)}%，尚未写入网页`, result.percent || 0);
        return;
      }
      const count = paint();
      const expected=[...entries.values()].reduce((n,e)=>n+(e.annotations||[]).length,0);
      const actual=[...entries.values()].reduce((n,e)=>n+(e.renderRecord?.inserted||[]).reduce((m,node)=>
        m+(node.isConnected&&node.matches?.(OWN_RUBY)?1:0)+
        (node.isConnected?(node.querySelectorAll?.(OWN_RUBY)?.length||0):0),0),0);
      const invalidated=[...entries.values()].filter(e=>e.invalidated===true).length;
      const display={dom_scanned_nodes:task.scan?.textNodes||0,
        dom_hangul_nodes:task.scan?.hangulNodes||0,
        dom_submitted_nodes:task.scan?.collected||0,
        local_candidates:result.stats?.pending||0,
        local_conversions:result.stats?.local_determined||0,
        model_accepted:result.stats?.model_accepted||0,
        model_keep:result.stats?.model_keep||0,
        model_literal_origins:result.stats?.model_literal_origins||0,
        projected_annotations:expected,rendered_annotations:count,
        connected_visible_annotations:actual,invalidated_dom_entries:invalidated};
      globalThis.__KRA_PIPELINE_STATUS__={...globalThis.__KRA_PIPELINE_STATUS__,display};
      addDiagnostic({stage:'render',level:expected>actual?'warning':'info',
        message:`模型审核 ${display.model_accepted} 项（KEEP ${display.model_keep}、直接词源 ${display.model_literal_origins}）；投射 ${expected} 处，写入 ${count} 处，目前仍连接 DOM ${actual} 处。`,
        detail:JSON.stringify(display)});
      for(const entry of entries.values()){
        seenSources.add(entry.text);
        if(!entry.invalidated&&entry.node?.nodeType===3&&entry.node.isConnected&&entry.node.data===entry.text)
          analyzedNodeVersions.set(entry.node,entry.text);
      }
      status(`完成：${count} 个标注`, 100);
      finishTask(task,`本次标注已完成，当前显示 ${count} 个标注。`,true);
      configureRecovery();
      if(!ranges)pageCompleted=true;configureAutomaticAnnotation();
      // Runs for normal AND merged multi-frame page operations. Manual
      // reviews do not open unexpected extra prompts; continuous monitoring
      // remains governed by its separate opt-in setting.
      addDiagnostic({message:`完成：${count} 个标注`,detail:JSON.stringify(result.stats||{})});
      publishState();
    });
    task.keepalive = setInterval(() => { try { port.postMessage({ type: 'KEEPALIVE' }); } catch { clearInterval(task.keepalive);if(!recoverManualConnection(task,'后台保活连接已断开。'))finishTask(task); } }, 20000);
    try {
      port.postMessage({ type: 'START', operationId,
        ...(task.mergedGroup?{mergeGroupId:message.mergeGroupId}:{}),
        sentences:paragraphPlan.sentences, context:paragraphPlan.context,
        restrictToSelection:true, progressiveAnnotation:task.progressive, modes,
        forceRegenerate:Boolean(message.forceRegenerate),reviewAll:message.reviewAll===true });
    } catch (error) { finishTask(task); status(error.message || '无法启动分析', 0); return { ok: false, error: error.message }; }
    return { ok: true, started: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message?.type) {
      case 'KRA_PING': respond({ ok: true, version: VERSION }); break;
      case 'KRA_CONTEXT_STATE': respond(contextState()); break;
      case 'KRA_HISTORY_STATE': respond(latestUndoState()); break;
      case 'KRA_FRAME_PROBE': respond(probeKoreanFrame()); break;
      case 'KRA_MANUAL_OFFLINE_FRAME':
        applyMergedOfflineFrame(message).then(respond,error=>respond({ok:false,error:String(error.message||error)}));
        return true;
      case 'KRA_FRAME_DISPATCH_DIAGNOSTIC':
        if(window===window.top)addDiagnostic({stage:'frames',
          level:message.detail?.inaccessible||message.detail?.failed?'warning':'info',
          message:String(message.summary||'iframe 扫描完成'),
          detail:JSON.stringify(message.detail||{})});
        respond({ok:true});break;
      case 'START_ANNOTATION': if(message.uiSettings)applySettings(message.uiSettings);Promise.resolve(startAnnotation(message)).then(respond,error=>respond({ok:false,error:error.message}));return true;
      case 'RESTORE_ANNOTATION': respond(restorePage());break;
      case 'UNDO_LAST_ANNOTATION':respond(undoLast(message.groupId??null));break;
      case 'REDO_LAST_ANNOTATION':respond(redoLast(message.groupId??null));break;
      case 'KRA_INVALIDATE_REDO':redoStack.length=0;refreshTabHistoryCounter();respond({ok:true});break;
      case 'APPLY_UI_SETTINGS':applySettings(message.uiSettings||{});respond({ok:true});break;
      case 'APPLY_FLOATING_BALL_POSITION':applySettings({floatingBallPosition:message.position});respond({ok:true});break;
      case 'START_SELECTION_ANNOTATION':{const ranges=captureSelection();Promise.resolve(ranges?startAnnotation({...message,ranges}):{ok:false,error:'请先选中需要标注的文字。'}).then(respond,error=>respond({ok:false,error:error.message}));return true;}
    }
  });

  send({ type: 'GET_UI_SETTINGS' }).then(reply => {
    if (!reply?.ok) return;
    if(typeof window==='undefined'||window===window.top)
      pageHasHangul=collectTextNodes().size>0;
    applySettings(reply.uiSettings);
  });
})();
