(() => {
  const VERSION = '1.1.56.0-positional-null';
  if (globalThis.__KRA_CONTENT_SCRIPT_VERSION__ === VERSION) return;
  globalThis.__KRA_CONTENT_SCRIPT_VERSION__ = VERSION;
  globalThis.__KOREAN_RUBY_ANNOTATOR_LOADED__ = true;
  const OWN_RUBY = 'ruby[kra-annotated="true"]';
  // Only annotation recovery snapshots are bounded. Full-page text scanning
  // is not truncated: the sentence pipeline already batches model requests.
  const MAX_RECOVERY_BLOCKS = 12000;
  let currentTask = null;
  let sequence = 0;
  let uiSettings = { toolbarBallOnly:false, mobileSelectionToolbar: true, hanjaMode: true, loanwordMode: true, copyMode: 'hangul' };
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
  const seenSources = new Set(); // legacy session bookkeeping; NOT a deduplication key
  const analyzedNodeVersions = new WeakMap();
  let lastScanStats = null;
  const history = [];
  const diagnostics = [];
  const recoveryBlocks = new Set();
  const recoveryByElement = new WeakMap();
  const ownDomChanges = new WeakSet();
  const BLOCK_TAGS = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption';
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
      const relevant=records.some(record=>{
        if(isOwnMutation(record))return false;
        const parent=record.target.nodeType===1?record.target:record.target.parentElement;
        if(parent?.closest?.('ruby,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,'+
           '.kra-floating-ball,.kra-manual-reopen,script,style'))return false;
        if(record.type==='attributes'){
          // A hidden tab can become visible without any text-node mutation.
          // Trigger a scan only if its subtree actually contains Hangul.
          return /[가-힣]/u.test(record.target.textContent||'');
        }
        const nodes=record.type==='characterData'?[record.target]:Array.from(record.addedNodes);
        return nodes.some(node=>!node.matches?.(OWN_RUBY)&&!node.querySelector?.(OWN_RUBY)&&
          /[가-힣]/u.test(node.textContent||''));
      });
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
      else if(element.hidden||element.hasAttribute('inert')||
         element.getAttribute('aria-hidden')==='true')reason='hidden';
      else {
        // Offscreen content is eligible. Exclude only actually hidden trees.
        const css=document.defaultView?.getComputedStyle?.(element);
        if(css?.display==='none'||css?.visibility==='hidden'||
           css?.visibility==='collapse'||css?.contentVisibility==='hidden')
          reason='hidden';
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

  function insertConversions(entries, operation) {
    const range = document.createRange();
    for (const [node, entry] of entries) {
      rememberRecovery(entry,operation);
      if (entry.invalidated || (!entry.annotations.length && !entry.renderRecord && !(entry.isRuby && entry.modelReviewed))) continue;
      const html=entry.isRuby&&!entry.modelReviewed&&!entry.localAnnotations?.length?entry.originalOuterHTML:conversionHTML(entry);
      if(entry.renderHTML===html)continue;
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
        if(node.hidden||node.hasAttribute?.('inert')||
           node.getAttribute?.('aria-hidden')==='true')return true;
        const style=document.defaultView?.getComputedStyle?.(node);
        if(style?.display==='none'||style?.visibility==='hidden'||
           style?.visibility==='collapse'||style?.contentVisibility==='hidden')
          return true;
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

  function getToolbar() {
    // Explicit UI boundary; keep frame-local DOM conversion and messaging
    // but prevent embedded documents from creating control overlays.
    if(typeof window!=='undefined'&&window!==window.top)return null;
    if (toolbar?.isConnected) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'kra-mobile-selection-bar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '韩语网页标注');
    toolbar.innerHTML = '<div class="kra-task-status"><span class="kra-task-label" role="status">准备标注</span><progress class="kra-task-progress" max="100" value="0"></progress></div><div class="kra-mobile-actions"><button class="kra-mobile-page" type="button">标注整页</button><button class="kra-mobile-primary" type="button">重新标注选区</button><button class="kra-mobile-review" type="button">模型重审选区</button><button class="kra-manual-open" type="button" hidden>手动审核</button><button class="kra-mobile-undo" type="button">撤销</button><button class="kra-diagnostic-button" type="button">诊断</button><button class="kra-mobile-restore" type="button">还原</button><button class="kra-mobile-close" type="button" aria-label="关闭">×</button></div>';
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
    toolbar.querySelector('.kra-mobile-undo').addEventListener('click',undoLast);
    toolbar.querySelector('.kra-diagnostic-button').addEventListener('click',toggleDiagnostics);
    toolbar.querySelector('.kra-manual-open').addEventListener('click',()=>{const panel=document.querySelector('.kra-manual-review');if(panel){panel.hidden=!panel.hidden;refreshManualReopen();}});
    toolbar.querySelector('.kra-mobile-restore').addEventListener('click', restorePage);
    toolbar.querySelector('.kra-mobile-close').addEventListener('click',dismissToolbar);
    document.body.append(toolbar);
    return toolbar;
  }

  function manualPanel(){
    let panel=document.querySelector('.kra-manual-review');if(panel)return panel;
    panel=document.createElement('section');panel.className='kra-manual-review';panel.setAttribute('aria-label','手动聊天审核');
    panel.innerHTML='<div class="kra-manual-heading"><strong>手动聊天审核</strong><button type="button" class="kra-manual-hide">收起</button></div><p class="kra-manual-summary"></p><p>① 复制提示词给聊天模型。② 粘贴完整 JSON 或导入 JSON/TXT 答案文件。等待期间请保留本网页。</p><label>发给模型的完整内容<textarea class="kra-manual-prompt" readonly spellcheck="false"></textarea></label><div class="kra-manual-actions"><button type="button" class="kra-manual-copy">复制提示词</button><button type="button" class="kra-manual-download">下载提示词 TXT</button></div><label>粘贴模型返回的完整 JSON<textarea class="kra-manual-response" spellcheck="false" placeholder="粘贴 JSON 或完整的 json 代码块"></textarea></label><div class="kra-manual-actions"><button type="button" class="kra-manual-import">导入 JSON／TXT 答案</button><input class="kra-manual-file" type="file" accept=".json,.txt,application/json,text/plain" aria-label="导入 JSON 或 TXT 答案文件" hidden><button type="button" class="kra-manual-apply">校验并应用本批结果</button><button type="button" class="kra-manual-cancel">取消本次任务</button></div><p class="kra-manual-status" role="status" aria-live="polite"></p>';
    const note=message=>{panel.querySelector('.kra-manual-status').textContent=message;};
    const reopen=document.createElement('button');reopen.type='button';reopen.className='kra-manual-reopen';reopen.textContent='打开手动审核';reopen.hidden=true;
    reopen.onclick=()=>{panel.hidden=false;refreshManualReopen();};
    panel.querySelector('.kra-manual-hide').onclick=()=>{panel.hidden=true;refreshManualReopen();};
    panel.querySelector('.kra-manual-copy').onclick=async event=>{
      if(!event.isTrusted)return;
      const prompt=panel.querySelector('.kra-manual-prompt');
      const copied=await send({type:'KRA_COPY_TEXT',text:prompt.value});
      if(copied?.ok){note('已复制完整提示词。可粘贴到大模型聊天框。');return;}
      try{await navigator.clipboard.writeText(prompt.value);note('已复制完整提示词。可粘贴到大模型聊天框。');}
      catch{prompt.focus();prompt.select();let ok=false;try{ok=document.execCommand('copy');}catch{}note(ok?'已复制完整提示词。可粘贴到大模型聊天框。':'复制失败，已选中文本；可用系统复制或下载 TXT。');}
    };
    panel.querySelector('.kra-manual-download').onclick=()=>{
      const text=panel.querySelector('.kra-manual-prompt').value,url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download=`Korean-Web-Annotator-manual-${panel.dataset.requestId||'prompt'}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);note('提示词已导出为 TXT。');
    };
    const submitAnswer=()=>{
      const task=currentTask;if(!task||task.finished||!task.manualRequest||panel.dataset.operationId!==task.operationId)return;
      if(task.manualLocalOnly){
        panel.querySelector('.kra-manual-apply').disabled=true;panel.querySelector('.kra-manual-import').disabled=true;
        void applyManualRecovery(task,panel.querySelector('.kra-manual-response').value).catch(error=>{
          if(currentTask!==task||task.finished)return;
          note(error.message);panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;
        });
        return;
      }
      panel.querySelector('.kra-manual-apply').disabled=true;panel.querySelector('.kra-manual-import').disabled=true;note('正在校验本批结果…');
      task.manualSubmitted={requestId:task.manualRequest,text:panel.querySelector('.kra-manual-response').value};
      watchManualReply(task);
      try{task.port.postMessage({type:'MANUAL_REVIEW_RESPONSE',operationId:task.operationId,requestId:task.manualRequest,text:panel.querySelector('.kra-manual-response').value});}
      catch{clearInterval(task.keepalive);if(!recoverManualConnection(task,'提交连接已断开。')){clearTimeout(task.manualTimer);panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;note('标注连接已断开；答案已保留，请下载保存。');}}
    };
    panel.querySelector('.kra-manual-apply').onclick=submitAnswer;
    let fileReadSequence=0;
    const fileInput=panel.querySelector('.kra-manual-file'),importButton=panel.querySelector('.kra-manual-import');
    importButton.onclick=()=>fileInput.click();
    fileInput.onchange=async()=>{
      const file=fileInput.files?.[0];fileInput.value='';
      const task=currentTask,requestId=task?.manualRequest,sequence=++fileReadSequence;
      if(!file||!task||task.finished||!requestId||panel.dataset.operationId!==task.operationId)return;
      const stillCurrent=()=>sequence===fileReadSequence&&currentTask===task&&!task.finished&&task.manualRequest===requestId&&panel.dataset.requestId===requestId;
      importButton.disabled=true;panel.querySelector('.kra-manual-apply').disabled=true;note(`正在读取 ${file.name}…`);
      try{
        if(!/\.(json|txt)$/i.test(file.name))throw Error('请选择 JSON 或 TXT 答案文件。');
        if(file.size>16*1024*1024)throw Error('答案文件超过 16 MiB，请仅导入当前批次的结果。');
        let readTimer;let text;
        try{text=await Promise.race([file.text(),new Promise((_,reject)=>{readTimer=setTimeout(()=>reject(Error('读取文件超时，请重新导入或粘贴答案。')),15000);})]);}finally{clearTimeout(readTimer);}
        if(!stillCurrent())return;
        panel.querySelector('.kra-manual-response').value=text;submitAnswer();
      }catch(error){if(stillCurrent()){importButton.disabled=false;panel.querySelector('.kra-manual-apply').disabled=false;note(`导入失败：${error.message||error}`);}}
    };
    panel.querySelector('.kra-manual-cancel').onclick=()=>{cancelTask();status('已取消手动审核',0);};
    document.body.append(panel,reopen);return panel;
  }

  function recoverManualConnection(task,reason){
    const backup=task.manualBackup;
    if(task.finished||currentTask!==task)return false;
    if(task.mergedGroup){
      // A shared prompt can include source positions belonging to other
      // iframe documents. Never apply a main-frame-only backup to them.
      panelStatus('合并跨框架审核的后台连接已中断；完整提示词和已粘贴答案保留在本窗口。请先保存后重新开始审核，不能将其他框架的答案误写到主页面。');
      return false;
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
       /^(?:[cnxp]\d+)$/i.test(choiceId))return null;
    const hanja=/^[\p{Script=Han}]+$/u.test(choiceId)&&meta.hanja===true&&task.modes.hanja===true;
    const loanword=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u.test(choiceId)&&
      /\p{Script=Latin}/u.test(choiceId)&&meta.loanword===true&&task.modes.loanword===true;
    if(!hanja&&!loanword)return null;
    if(entry.text.slice(binding.start,binding.end)!==binding.surface)return null;
    const surface=binding.surface,type=hanja?'hanja':'loanword',annotations=[];
    const base={type,entry_id:'experimental:'+type,origin_source:'model-unverified',confidence:1};
    let replacement=choiceId;
    // Match experimental-options.js splitAlignedHanja for spaced Korean words.
    const words=hanja&&/^[가-힣]+(?: [가-힣]+){1,3}$/u.test(surface)?surface.split(' '):null;
    // The model may write the genuine Sino-Korean stem without copying a
    // following native suffix. Accept only an explicit Kiwi XSN/XSM tail.
    let suffixStem=null;
    if(hanja&&!words&&/^[가-힣]+$/u.test(surface)){
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
    }else if(words){
      const characters=[...choiceId];
      if(characters.length!==words.join('').length)return null;
      let start=binding.start,index=0;
      for(const word of words){
        const written=characters.slice(index,index+word.length).join('');
        annotations.push({...base,start,end:start+word.length,surface:word,replacement:written});
        start+=word.length+1;index+=word.length;
      }
      replacement=annotations.map(a=>a.replacement).join(' ');
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
    if(meta.known?.some(o=>o.type===type&&o.replacement===replacement))return null;
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
      eligible:true,hanja:task.modes.hanja===true,loanword:task.modes.loanword===true,
      known:[],morphology:[]}};
    const row={target_id:'repair',choice_id};
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
      if(!repair||repair.op==='delete'||typeof repair.choice_id!=='string')continue;
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

  // Construct a retry prompt from the original shared pool, keeping the
  // same batch ID and only the sentences/candidates the missing targets need.
  function manualRetryPrompt(task,missing,reasons){
    const backup=task.manualBackup,batch=backup?.requestId||task.manualRequest;
    const indices=missing.map(b=>backup.bindings.indexOf(b)),original=task.manualOriginalPrompt||'';
    const begin=original.indexOf('{"format":"shared-pools-v4"');
    const intro='positional-v1 部分补交（只回答以下原始索引，不要移动、重排或重新编号）：'+
      indices.join('、')+'。\n返回 {"batch_id":"'+batch+'","partial":true,"results":[[原始索引,答案],...]}。'+
      '保留韩文使用 JSON null；只有经过有效修复的旧目标才能使用 false。\n错误原因：'+
      missing.map((b,i)=>indices[i]+': '+(reasons.get(b.target_id)||'缺少有效答案')).join('；')+'\n\n';
    if(begin>=0)try{
      const old=JSON.parse(original.slice(begin)),want=new Set(indices);
      const targets=(old.targets||[]).flatMap((t,i)=>want.has(i)?[{index:i,...t}]:[]);
      const candidateIds=new Set(targets.flatMap(t=>Object.values(t.options||{})).filter(x=>typeof x==='string'));
      const sentenceIds=new Set(targets.map(t=>t.sentence_id));
      return original.slice(0,begin)+intro+JSON.stringify({...old,batch_id:batch,
        targets,candidates:(old.candidates||[]).filter(x=>candidateIds.has(x.candidate_id)),
        sentences:(old.sentences||[]).filter(x=>sentenceIds.has(x.sentence_id))});
    }catch{}
    return intro+original;
  }

  async function applyManualRecovery(task,text,{advance=true,paint=true}={}){
    const backup=task.manualBackup;
    if(!backup?.bindings?.length||task.manualRequest!==backup.requestId)throw Error('没有当前批次的恢复数据，请保留答案并重新标注。');
    if(typeof text!=='string'||text.length>16*1024*1024)throw Error('请提供不超过 16 MiB 的完整 JSON 结果。');
    let source=text.trim();const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
    let response;try{response=JSON.parse(source);}catch{throw Error('JSON 格式无效，请粘贴或导入完整 JSON 或 json 代码块。');}
    // Without IDs on individual answers, batch identity is mandatory.
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
    const reasons=new Map(stage.reasons);
    for(const item of repairResult.rejected)for(const id of item.old_target_ids||[])
      if(!retired.has(id))reasons.set(id,'分词修复校验失败：'+item.reason);
    task.manualRecoveryRepairs=stage.applied.map(r=>({
      sentence_id:r.sentence_id,op:r.op,old_target_ids:r.old_target_ids,
      start:r.start,end:r.end,surface:r.surface,
      ...(r.op==='delete'?{}:{choice_id:r.choice_id})
    }));
    const positional=await import(chrome.runtime.getURL('positional-results.js'));
    const targets=backup.bindings.map(b=>({
      target_id:b.target_id,
      scan_only:(backup.repairValidation?.targets||[]).some(t=>t.target_id===b.target_id&&t.scan_only===true)
    }));
    const parsed=positional.parsePositionalResults(targets,response,{
      allowPartial:true,smartSegmentation:backup.smartSegmentation===true,retired
    });
    if(parsed.malformed)throw Error('positional-v1 results 长度或原始位置错误，拒绝按顺序猜测缺失项。');
    const saved=new Map(task.manualRecoveryAccepted||[]);
    for(const [index,reason] of parsed.problems)
      reasons.set(backup.bindings[index]?.target_id||String(index),reason);
    for(const [index,value] of parsed.values){
      const binding=backup.bindings[index],id=binding.target_id;
      if(saved.has(id)||retired.has(id)||targets[index].scan_only)continue;
      const sentence=sourceSentences.get(binding.sentenceId)||entries.get(binding.sentenceId);
      let choice=value===null?
        binding.choices.find(o=>o.choice_id==='KEEP'):
        binding.choices.find(o=>o.choice_id===value&&o.choice_id!=='KEEP');
      if(!choice&&typeof value==='string'&&sentence)
        try{choice=await manualLiteralChoice(binding,value,sentence,task);}
        catch{choice=null;}
      if(!choice){
        reasons.set(id,'无效答案 '+JSON.stringify(value));continue;
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
    task.manualRecoveryAccepted=verified;
    const scanOnly=new Set((backup.repairValidation?.targets||[]).filter(t=>t.scan_only).map(t=>t.target_id));
    const missing=backup.bindings.filter(b=>!verified.has(b.target_id)&&
      !retired.has(b.target_id)&&!scanOnly.has(b.target_id));
    if(missing.length){
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
          '\n已保存 '+(verified.size+retired.size)+'/'+bindings.size+' 条；仅需补交 '+missing.length+' 条。';
      }
      const details=missing.slice(0,8).map(b=>b.target_id+'（'+(reasons.get(b.target_id)||'未提交')+'）').join('；');
      const message='本批结果不完整：已验证 '+(verified.size+retired.size)+'/'+bindings.size+' 条，页面已预览 '+count+
        ' 个标注；剩余 '+missing.length+' 条待补交：'+details+
        (missing.length>8?'；其余见补交提示词':'')+

        (repairResult.rejected.length?'。已安全拒绝 '+repairResult.rejected.length+' 条无效修复':'')+
        '。请只提交新提示词中的目标。';
      if(count)status('已预览 '+count+' 个标注，仍有 '+missing.length+' 个目标待补交');
      throw Error(message);
    }
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
    // Persist an accepted batch before switching to the next one. Otherwise a
    // dynamic import in page-only recovery can race with worker messages and
    // invalidate the saved answer by changing manualRequest/manualBackup.
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
      task.manualRequest=event.requestId;panel.dataset.operationId=task.operationId;panel.dataset.requestId=event.requestId;
      panel.querySelector('.kra-manual-summary').textContent=`${event.experimentalPhase==='propose'?'实验性候选补全 · ':event.experimentalPhase==='choose'?'补充候选复审 · ':''}第 ${event.batchNumber}/${event.batchTotal||event.batchNumber} 批次 · ${event.targetCount} 个词 · ${event.text.length.toLocaleString()} 字符（仅任务内容，无 API Key）`;
      if(event.budget){const b=event.budget;panel.querySelector('.kra-manual-summary').textContent+=`\n${b.label}档 · 预估输入 ${b.inputTokens.toLocaleString()} / 答案 ${b.outputTokens.toLocaleString()} tokens${b.contextTokens?` / 余量 ${b.safetyTokens.toLocaleString()}（窗口 ${b.contextTokens.toLocaleString()}）`:''}${b.limitReason==='output'?' · 受答案长度预算限制':''}。估算与实际分词可能不同。`;}
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
      clearTimeout(task.manualTimer);if(event.recoverable&&recoverManualConnection(task,event.error))return;
      if(Array.isArray(event.acceptedRows)&&!task.mergedGroup){
        const answer=JSON.stringify({batch_id:event.requestId,partial:true,results:event.acceptedRows,
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
      clearTimeout(task.manualTimer);
      const submitted=Array.isArray(event.acceptedRows)?
        JSON.stringify({batch_id:event.requestId,partial:true,results:event.acceptedRows,
           ...(event.acceptedRepairs?{repairs:event.acceptedRepairs}:{})}):
        (task.manualSubmitted?.requestId===event.requestId?task.manualSubmitted.text:panel.querySelector('.kra-manual-response').value);
      // The background already validated any model-origin string. Do not
      // overwrite it with a page-only recovery that lacks these options.
      let requiresBackground=false;
      try{
        const bindings=task.manualBackup?.bindings||[],parsed=JSON.parse(submitted);
        const values=parsed.partial===true?
          (parsed.results||[]).map(pair=>Array.isArray(pair)?pair:[-1,undefined]):
          (parsed.results||[]).map((value,i)=>[i,value]);
        requiresBackground=parsed.repairs!==undefined&&(!Array.isArray(parsed.repairs)||parsed.repairs.length>0)||
         values.some(([index,value])=>{
          const binding=bindings[index];
          return !binding||(typeof value==='string'&&
            !binding.choices.some(o=>o.choice_id===value&&o.choice_id!=='KEEP'));
        });
      }catch{}
      if(!task.mergedGroup&&!requiresBackground){
        const requestId=event.requestId;
        const pending=applyManualRecovery(task,submitted,{advance:false,paint:false})
          .catch(error=>addDiagnostic({level:'warning',message:'页面批次备份未确认：'+error.message}));
        task.pendingAcceptedRecovery=pending;
        void pending.finally(()=>{
          if(task.pendingAcceptedRecovery===pending)task.pendingAcceptedRecovery=null;
          if(task.manualRequest===requestId)task.manualRequest=null;
        });
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
    clearTimeout(task.manualTimer);task.manualBackup=null;
    task.manualRequest=null;
    const manual=document.querySelector('.kra-manual-review');
    if(manual?.dataset.operationId===task.operationId){
      manual.querySelector('.kra-manual-apply').disabled=true;manual.querySelector('.kra-manual-import').disabled=true;manual.querySelector('.kra-manual-cancel').disabled=true;manual.querySelector('.kra-manual-status').textContent=reason;
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
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();history.length=0;seenSources.clear();
    // Unwrap owned rubies in both the document and open Shadow DOM.
    for(const root of openTextRoots())for(const ruby of root.querySelectorAll(OWN_RUBY))
      ruby.replaceWith(document.createTextNode(ruby.dataset.kraOriginal||''));
    status('已还原', 0);
    send({ type: 'SET_BADGE', text: '' });
    publishState();
  }

  function undoLast() {
    cancelTask();pageCompleted=false;configureAutomaticAnnotation();
    const operation=history.pop();if(!operation){status('没有可撤销的标注',0);return {ok:false,error:'没有可撤销的标注'};}
    for(const [block,before]of operation.recoveryBefore||[])if(recoveryBlocks.has(block))block.annotations=new Map(before);
    for(const record of [...operation].reverse()){
      if(!record.inserted.every((node,i)=>node.parentNode===record.parent&&node.isEqualNode(record.snapshots[i])&&(i===0||record.inserted[i-1].nextSibling===node)))continue;
      record.inserted[0].before(record.original.isEqualNode(record.originalSnapshot)?record.original:record.originalSnapshot.cloneNode(true));for(const node of record.inserted)node.remove();
    }
    configureRecovery();status('已撤销上次标注',0);publishState();return {ok:true};
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
    const entries = collectTextNodes(ranges,Boolean(ranges||message.forceRegenerate),Boolean(message.automatic),true);
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
    try{
      paragraphPlan=entries.size?
        createParagraphPlan(entries,sourceOf,BLOCK_TAGS):
        {sentences:[],context:'',projectBinding:()=>[],idByNode:new WeakMap()};
    }catch(error){return {ok:false,error:error.message};}
    const operationId = `page-${Date.now().toString(36)}-${++sequence}`;
    let port;
    try { port = chrome.runtime.connect({ name: 'KRA_SENTENCE_STREAM_V1' }); }
    catch (error) { status('扩展已更新，请刷新网页后重试', 0); return { ok: false, error: error.message }; }
    const task = { operationId, port, entries, paragraphPlan, modes, scan,
      mergedGroup:typeof message.mergeGroupId==='string'&&message.mergeGroupId.length>0,
      mergedHost:message.mergeHost===true,startedAutomatically:message.automatic===true,
      startPageUrl:typeof location!=='undefined'?location.href:document.location?.href||'', finished: false, progressive:uiSettings.progressiveAnnotation===true, wholePage:!ranges,
      operation:[], historyRecorded:false };
    const paint=(changed=entries)=>{insertConversions(changed,task.operation);const count=[...entries.values()].reduce((n,entry)=>n+(entry.renderCount||0),0);if((task.operation.length||task.operation.recoveryBefore?.size)&&!task.historyRecorded){history.push(task.operation);task.historyRecorded=true;}return count;};
    task.paint=paint;
    task.reconcile=()=>{for(const entry of entries.values())if(entry.hasPreview){entry.modelAnnotations=entry.committedModelAnnotations||[];entry.modelReviewed=entry.committedModelReviewed||false;entry.hasPreview=false;const model=entry.modelAnnotations;entry.annotations=[...(entry.localAnnotations||[]).filter(a=>!
           [...model,...(entry.modelReviewedRanges||[])].some(b=>b.start<a.end&&b.end>a.start)),...model];}if(task.progressive)paint();};
    const byId = new Map([...entries.values()].map(entry => [entry.id, entry]));
    currentTask = task;
    status('加载词典…');
    port.onDisconnect.addListener(() => {
      if (task.finished||task.manualLocalOnly) return;
      clearInterval(task.keepalive);
      if(recoverManualConnection(task,'标注后台连接已中断。'))return;
      status('分析连接中断，请重试', 0);
      finishTask(task);
    });
    port.onMessage.addListener(result => {
      if (task.finished || currentTask !== task || result.operationId !== operationId) return;
      if(task.manualLocalOnly)return;
      if(result.type==='MANUAL_REVIEW_PLAN'){
        task.manualPlan=result.batches;
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
      // Catch sections hydrated during the original analysis (or just after
      // it) without enabling unlimited post-completion model requests.
      // The user's "stop after page complete" setting still controls
      // CONTINUOUS future monitoring; this is one bounded settling pass.
      if(!ranges&&!task.mergedGroup&&!task.startedAutomatically&&!task.manualPanelShown&&
         uiSettings.stopAutoAfterPageComplete!==false){
        const generation=sequence,originalUrl=task.startPageUrl;
        setTimeout(()=>{
          if(sequence!==generation||!pageCompleted||currentTask||location.href!==originalUrl)return;
          const unseen=collectTextNodes(null,false,true,false);
          if(!unseen.size)return;
          addDiagnostic({stage:'scan',level:'info',
            message:`页面初次标注后的异步加载补扫：新发现 ${unseen.size} 个韩文文本节点，仅补扫一次。`,
            detail:JSON.stringify({late_nodes:unseen.size,source:'hydration-grace'})});
          startAnnotation({automatic:true,modes:task.modes});
        },1200);
      }
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
      case 'KRA_FRAME_PROBE': respond(probeKoreanFrame()); break;
      case 'KRA_FRAME_DISPATCH_DIAGNOSTIC':
        if(window===window.top)addDiagnostic({stage:'frames',
          level:message.detail?.inaccessible||message.detail?.failed?'warning':'info',
          message:String(message.summary||'iframe 扫描完成'),
          detail:JSON.stringify(message.detail||{})});
        respond({ok:true});break;
      case 'START_ANNOTATION': if(message.uiSettings)applySettings(message.uiSettings);Promise.resolve(startAnnotation(message)).then(respond,error=>respond({ok:false,error:error.message}));return true;
      case 'RESTORE_ANNOTATION': restorePage();respond({ok:true});break;
      case 'UNDO_LAST_ANNOTATION':respond(undoLast());break;
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
