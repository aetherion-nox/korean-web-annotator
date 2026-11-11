(() => {
  const VERSION = '1.1.55';
  if (globalThis.__KRA_CONTENT_SCRIPT_VERSION__ === VERSION) return;
  globalThis.__KRA_CONTENT_SCRIPT_VERSION__ = VERSION;
  globalThis.__KOREAN_RUBY_ANNOTATOR_LOADED__ = true;
  const OWN_RUBY = 'ruby[kra-annotated="true"]';
  const MAX_ENTRIES = 3000;
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
  const seenSources = new Set();
  const history = [];
  const diagnostics = [];
  const recoveryBlocks = new Set();
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

  function recoveryAnchor(node) {
    const element=node.parentElement?.closest(BLOCK_TAGS)||node.parentElement;
    if(!element||element.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball'))return null;
    const identity=pageIdentity();if(recoveryPage!==null&&identity!==recoveryPage)resetRecovery();recoveryPage=identity;
    const source=sourceOf(element),run=source.runs.find(r=>r.node===node);if(!run)return null;
    const scope=element.closest('[itemprop~="articleBody"],article,main')||document.body;
    const selector=scope.matches('[itemprop~="articleBody"]')?'[itemprop~="articleBody"]':scope.tagName.toLowerCase();
    const scopeIndex=Array.from(document.querySelectorAll(selector)).indexOf(scope),context=recoveryContext(element);
    let block=Array.from(recoveryBlocks).find(b=>b.element===element&&b.text===source.text);
    if(!block){
      const previous=Array.from(recoveryBlocks).filter(b=>!b.element.isConnected&&b.text===source.text&&b.context===context&&b.tag===element.tagName.toLowerCase()&&b.selector===selector&&b.scopeIndex===scopeIndex);
      if(previous.length===1){block=previous[0];block.element=element;block.scope=scope;}
      else if(previous.length>1)for(const stale of previous)stale.annotations.clear();
    }
    if(!block){
      if(recoveryBlocks.size>=MAX_ENTRIES)return null;
      block={element,text:source.text,context,tag:element.tagName.toLowerCase(),scope,selector,scopeIndex,annotations:new Map()};recoveryBlocks.add(block);
    }
    block.context=context;
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
    if(uiSettings.toolbarHangulOnly===false||uiSettings.mobileSelectionToolbar===false){hangulVisibilityObserver?.disconnect();hangulVisibilityObserver=null;return;}
    const own='.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball,.kra-manual-reopen';
    const isOwn=node=>(node.nodeType===1?node:node.parentElement)?.closest(own);
    const detect=()=>{
      if(!document?.body)return false;
      const hangul=/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode()))if(hangul.test(node.data)&&!isOwn(node)&&!node.parentElement?.closest('script,style,noscript,input,textarea,select'))return true;
      return Array.from(document.querySelectorAll(OWN_RUBY)).some(r=>!isOwn(r)&&hangul.test(r.getAttribute('data-kra-original')||''));
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
    if(!document.body)return;
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
    if(reopen)reopen.hidden=!toolbar?.isConnected||toolbar.hidden||!panel?.dataset.operationId||!panel.hidden;
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
        if(isOwnMutation(record))return false;
        const parent=record.target.nodeType===1?record.target:record.target.parentElement;
        if(parent?.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball,script,style'))return false;
        const nodes=record.type==='characterData'?[record.target]:Array.from(record.addedNodes);
        return nodes.some(node=>!node.matches?.(OWN_RUBY)&&!node.querySelector?.(OWN_RUBY)&&/[가-힣]/u.test(node.textContent||''));
      });
      if(!relevant)return;
      clearTimeout(automaticTimer);automaticTimer=setTimeout(()=>{if(!currentTask)startAnnotation({automatic:true,modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true}})},900);
    });
    automaticObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  }

  document.addEventListener('selectionchange',()=>{
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
  function collectTextNodes(ranges=null, includeOwned=false, automatic=false, trackRecovery=false) {
    const entries = new Map();
    if (!document.body) return entries;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/[가-힣]/u.test(node.data) || !/\S/u.test(node.data)) return NodeFilter.FILTER_REJECT;
        if (['TEXTAREA', 'RUBY', 'RT', 'INPUT', 'SCRIPT', 'NOSCRIPT', 'SELECT', 'OPTION', 'STYLE'].includes(node.parentNode?.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('ruby,.kra-mobile-selection-bar,.kra-diagnostics,.kra-manual-review,.kra-floating-ball')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode()) && entries.size < MAX_ENTRIES) {
      const selected=selectedIntervals(node,node.data,ranges,false);
      if(!selected.length||automatic&&(seenSources.has(node.data)||isKnownRecoverySource(node)))continue;
      entries.set(node, { node, text: node.data, annotations: [], selected, recoveryAnchor:trackRecovery?recoveryAnchor(node):null, id: String(entries.size) });
    }
    if(includeOwned)for(const node of document.querySelectorAll(OWN_RUBY)){
      if(entries.size>=MAX_ENTRIES)break;
      const text=node.dataset.kraOriginal||'';
      const selected=selectedIntervals(node,text,ranges,true);
      if(!text||!selected.length)continue;
      entries.set(node,{node,text,annotations:[],selected,recoveryAnchor:trackRecovery?recoveryAnchor(node):null,isRuby:true,originalHTML:node.innerHTML,originalOuterHTML:node.outerHTML,id:String(entries.size)});
    }
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
      if(!entry.renderRecord){entry.renderRecord=record;operation.push(record);}
      entry.renderHTML=html;
      seenSources.add(entry.text);
    }
    return [...entries.values()].reduce((n,entry)=>n+(entry.renderCount||0),0);
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
    toolbar.innerHTML = '<div class="kra-task-status"><span class="kra-task-label" role="status">准备标注</span><progress class="kra-task-progress" max="100" value="0"></progress></div><div class="kra-mobile-actions"><button class="kra-mobile-page" type="button">标注整页</button><button class="kra-mobile-primary" type="button">重新标注选区</button><button class="kra-mobile-review" type="button">模型重审选区</button><button class="kra-manual-open" type="button" hidden>手动审核</button><button class="kra-mobile-undo" type="button">撤销</button><button class="kra-diagnostic-button" type="button">诊断</button><button class="kra-mobile-restore" type="button">还原</button><button class="kra-mobile-close" type="button" aria-label="关闭">×</button></div>';
    toolbar.querySelector('.kra-mobile-page').addEventListener('click', () => startAnnotation({ modes: { hanja: uiSettings.hanjaMode ?? true, loanword: uiSettings.loanwordMode ?? true } }));
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
        try{applyManualRecovery(task,panel.querySelector('.kra-manual-response').value);}catch(error){note(error.message);panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;}return;
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

  function applyManualRecovery(task,text,{advance=true,paint=true}={}){
    const backup=task.manualBackup;
    if(!backup?.bindings?.length||task.manualRequest!==backup.requestId)throw Error('没有当前批次的恢复数据，请保留答案并重新标注。');
    if(typeof text!=='string'||text.length>16*1024*1024)throw Error('请提供不超过 16 MiB 的完整 JSON 结果。');
    let source=text.trim();const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
    let response;try{response=JSON.parse(source);}catch{throw Error('JSON 格式无效，请粘贴或导入完整 JSON 或 json 代码块。');}
    // On disconnected recovery, batch_id may be absent, but target count,
    // unique IDs and choices must still match the current page-only backup.
    // An explicitly supplied mismatching ID is always an error.
    if(response&&Object.hasOwn(response,'batch_id')&&response.batch_id!==backup.requestId)
      throw Error('batch_id 与当前批次不一致，未应用任何答案。');
    const rows=response?.results,bindings=new Map(backup.bindings.map(b=>[b.target_id,b])),seen=new Set(),accepted=[];
    if(response.repairs!==undefined&&(!Array.isArray(response.repairs)||response.repairs.length))
      throw Error('分词修复必须由后台核对词界和人名；断线页面备份不能直接应用 repairs，请恢复连接或重新开始。');
    // Page-only backup has approved dictionary choices only. Raw model-origin
    // spellings in choice_id require Python-backed validation in the worker.
    if(Array.isArray(rows)&&rows.some(row=>{
      const binding=bindings.get(row?.target_id);
      return binding&&!binding.choices.some(o=>o.choice_id===row?.choice_id);
    }))
      throw Error('模型直接填写的汉字／拉丁字词源需要后台校验，不能在断线页面备份中应用；请重新连接或重新开始审核。');
    if(!Array.isArray(rows)||rows.length!==bindings.size)throw Error('本批结果不完整，请使用当前批次的全部 target_id。');
    for(const row of rows){
      const binding=bindings.get(row?.target_id),choice=binding?.choices.find(o=>o.choice_id===row?.choice_id);
      if(!binding||seen.has(row.target_id)||!choice)throw Error('本批包含重复、其他批次的 target_id 或无效 choice_id。');
      seen.add(row.target_id);accepted.push({binding,choice});
    }
    const entries=new Map([...task.entries.values()].map(entry=>[entry.id,entry])),groups=new Map();
    for(const {binding,choice} of accepted)for(const b of (task.paragraphPlan?task.paragraphPlan.projectBinding(binding,choice):[{...binding,annotations:choice.annotations}])){
      const entry=entries.get(b.sentenceId);
      if(!entry||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.start<0||b.end<=b.start||entry.text.slice(b.start,b.end)!==b.surface)throw Error('当前批次的原文位置已失效，未应用任何答案。');
      if(!groups.has(entry))groups.set(entry,{annotations:[],reviewed:[]});const group=groups.get(entry);
      if(entry.selected.some(r=>b.start>=r.start&&b.end<=r.end))group.reviewed.push({start:b.start,end:b.end});
      for(const a of b.annotations){
        if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<=a.start||entry.text.slice(a.start,a.end)!==a.surface||typeof a.replacement!=='string'||!['hanja','loanword'].includes(a.type))throw Error('恢复数据的标注位置无效，未应用任何答案。');
        if(task.modes[a.type==='hanja'?'hanja':'loanword']&&entry.selected.some(r=>a.start>=r.start&&a.end<=r.end)){group.annotations.push(a);group.reviewed.push({start:a.start,end:a.end});}
      }
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
    if(complete){for(const entry of task.entries.values())seenSources.add(entry.text);if(task.wholePage)pageCompleted=true;}
    finishTask(task,message,complete);status(message);if(complete)configureAutomaticAnnotation();publishState();
  }

  function panelStatus(message){const panel=document.querySelector('.kra-manual-review');if(panel)panel.querySelector('.kra-manual-status').textContent=message;}

  function handleManualEvent(task,event){
    const panel=manualPanel();
    if(event.type==='MANUAL_REVIEW_REQUEST'){
      clearTimeout(task.manualTimer);task.manualLocalOnly=false;task.manualBackup={requestId:event.requestId,bindings:event.bindings,experimentalPhase:event.experimentalPhase,batchNumber:event.batchNumber,batchTotal:event.batchTotal};
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
      getToolbar().querySelector('.kra-manual-open').hidden=false;status(`等待手动回填：第 ${event.batchNumber}/${event.batchTotal||event.batchNumber} 批次（${event.targetCount} 个词）`);return;
    }
    if(panel.dataset.operationId!==task.operationId||event.requestId!==task.manualRequest)return;
    if(event.type==='MANUAL_REVIEW_ERROR'){
      clearTimeout(task.manualTimer);if(event.recoverable&&recoverManualConnection(task,event.error))return;
      panel.querySelector('.kra-manual-status').textContent=event.error;panel.querySelector('.kra-manual-apply').disabled=false;panel.querySelector('.kra-manual-import').disabled=false;
    }else{
      clearTimeout(task.manualTimer);
      const submitted=task.manualSubmitted?.requestId===event.requestId?task.manualSubmitted.text:panel.querySelector('.kra-manual-response').value;
      // The background already validated any model-origin string. Do not
      // overwrite it with a page-only recovery that lacks these options.
      let requiresBackground=false;
      try{
        const known=new Map((task.manualBackup?.bindings||[]).map(b=>[b.target_id,b]));
        const parsed=JSON.parse(submitted);
        requiresBackground=parsed.repairs!==undefined&&(!Array.isArray(parsed.repairs)||parsed.repairs.length>0)||
         parsed.results?.some(row=>{
          const binding=known.get(row?.target_id);
          return binding&&!binding.choices.some(o=>o.choice_id===row?.choice_id);
        })===true;
      }catch{}
      if(!requiresBackground)try{applyManualRecovery(task,submitted,{advance:false,paint:false});}catch(error){addDiagnostic({level:'warning',message:'页面批次备份未确认：'+error.message});}
      task.manualRequest=null;panel.querySelector('.kra-manual-apply').disabled=true;panel.querySelector('.kra-manual-import').disabled=true;panel.querySelector('.kra-manual-status').textContent=`本批 ${event.targetCount} 个结果已通过校验，正在写入并准备下一步…`;
    }
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
    if(entries.size)pageHasHangul=true;
    if (!entries.size) { status('没有未标注的韩语文字', 100); return { ok: true, started: false }; }
    let paragraphPlan;
    try{paragraphPlan=createParagraphPlan(entries,sourceOf,BLOCK_TAGS);}catch(error){return {ok:false,error:error.message};}
    const operationId = `page-${Date.now().toString(36)}-${++sequence}`;
    let port;
    try { port = chrome.runtime.connect({ name: 'KRA_SENTENCE_STREAM_V1' }); }
    catch (error) { status('扩展已更新，请刷新网页后重试', 0); return { ok: false, error: error.message }; }
    const task = { operationId, port, entries, paragraphPlan, modes, finished: false, progressive:uiSettings.progressiveAnnotation===true, wholePage:!ranges, operation:[], historyRecorded:false };
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
      if(result.type==='MANUAL_REVIEW_PLAN'){task.manualPlan=result.batches;return;}
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
      globalThis.__KRA_PIPELINE_STATUS__ = { stats: result.stats, engine_version: result.engine_version, dictionary_metadata: result.dictionary_metadata };
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
      for(const entry of entries.values())seenSources.add(entry.text);
      status(`完成：${count} 个标注`, 100);
      finishTask(task,`本次标注已完成，当前显示 ${count} 个标注。`,true);
      configureRecovery();
      if(!ranges)pageCompleted=true;configureAutomaticAnnotation();
      addDiagnostic({message:`完成：${count} 个标注`,detail:JSON.stringify(result.stats||{})});
      publishState();
    });
    task.keepalive = setInterval(() => { try { port.postMessage({ type: 'KEEPALIVE' }); } catch { clearInterval(task.keepalive);if(!recoverManualConnection(task,'后台保活连接已断开。'))finishTask(task); } }, 20000);
    try {
      port.postMessage({ type: 'START', operationId, sentences:paragraphPlan.sentences, context:paragraphPlan.context, restrictToSelection:true, progressiveAnnotation:task.progressive, modes, forceRegenerate: Boolean(message.forceRegenerate), reviewAll: message.reviewAll===true });
    } catch (error) { finishTask(task); status(error.message || '无法启动分析', 0); return { ok: false, error: error.message }; }
    return { ok: true, started: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message?.type) {
      case 'KRA_PING': respond({ ok: true, version: VERSION }); break;
      case 'KRA_CONTEXT_STATE': respond(contextState()); break;
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
    pageHasHangul=collectTextNodes().size>0;
    applySettings(reply.uiSettings);
  });
})();
