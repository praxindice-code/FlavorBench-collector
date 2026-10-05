"use strict";
const $=id=>document.getElementById(id);
const blank=()=>({schema_version:"1.2",title:"Untitled cooking session",source_name:"",source_sha256:null,duration_s:0,recipe_text:"",ingredients:[],events:[],analysis_model:"manual"});
let session=blank(),mediaUrl=null,mediaKind=null,cameraStream=null,analysisBusy=false,noticeTimer=null,cases=[],activeCaseId=null,flavorResult=null,flavorKey=null,flavorSerial=0;
const num=id=>$(id).value===""?null:Number($(id).value);
const msg=(value)=>{const box=$("message");box.textContent=value;box.classList.add("show");clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>box.classList.remove("show"),7000)};
const escapeFile=s=>s.replace(/[^a-z0-9_-]+/gi,"-").replace(/^-|-$/g,"").slice(0,60)||"session";
const LOCAL_SAVE_KEY="flavorbench-collector-session-v1";
const row=(title,meta,reviewed,onReview,onDelete)=>{const el=document.createElement("div");el.className="record";const left=document.createElement("div");const a=document.createElement("div");a.className="record-title";a.textContent=title;const b=document.createElement("div");b.className="record-meta";b.textContent=meta;left.append(a,b);const actions=document.createElement("div");actions.className="record-actions";const label=document.createElement("label");const check=document.createElement("input");check.type="checkbox";check.checked=reviewed;check.addEventListener("change",()=>onReview(check.checked));label.append(check,document.createTextNode("Reviewed"));const del=document.createElement("button");del.className="ghost";del.textContent="Remove";del.addEventListener("click",onDelete);actions.append(label,del);el.append(left,actions);return el};
function pairedCase(){const other=activeCaseId==="tomato-miso-late"?"tomato-miso-early":activeCaseId==="tomato-miso-early"?"tomato-miso-late":null;return other?cases.find(item=>item.id===other)?.session:null}
function predictionKey(){return JSON.stringify([activeCaseId,$("flavor-model").value,session.source_sha256,session.duration_s,session.ingredients,session.events])}
function seekTo(time){const video=$("video");if(mediaKind!=="video"||video.hidden)return;video.currentTime=Math.min(time,video.duration||time);video.scrollIntoView({behavior:"smooth",block:"center"})}
function render(){
  $("ingredient-count").textContent=`${session.ingredients.length} ITEMS`;
  $("event-count").textContent=`${session.events.length} EVENTS`;
  const ingredients=$("ingredients"),events=$("events");
  ingredients.replaceChildren();events.replaceChildren();
  session.ingredients.forEach((item,i)=>ingredients.append(row(item.name,`${item.quantity_g??"?"} g · ${item.preparation} · ${item.evidence}`,item.reviewed,v=>{item.reviewed=v;render()},()=>{session.ingredients.splice(i,1);render()})));
  session.events.forEach((item,i)=>{
    const entry=row(`${item.timestamp_s===null?"—":item.timestamp_s+"s"} · ${item.action}: ${item.description}`,`${item.ingredient||"No ingredient"} · ${item.vessel} · ${item.evidence} · ${item.confidence}`,item.reviewed,v=>{item.reviewed=v;render()},()=>{session.events.splice(i,1);render()});
    const actions=entry.querySelector(".record-actions");
    for(const [label,offset,glyph] of [["up",-1,"↑"],["down",1,"↓"]]){
      const move=document.createElement("button");move.className="ghost move-step";move.textContent=glyph;
      move.setAttribute("aria-label",`Move step ${i+1} ${label}`);
      move.disabled=i+offset<0||i+offset>=session.events.length;
      move.addEventListener("click",()=>{[session.events[i],session.events[i+offset]]=[session.events[i+offset],session.events[i]];render()});
      actions.insertBefore(move,actions.querySelector("label"));
    }
    events.append(entry);
  });
  renderVisuals(session,pairedCase(),seekTo);
  if(flavorKey&&flavorKey!==predictionKey()){
    flavorResult=null;flavorKey=null;flavorSerial++;
    $("calculate-flavor").disabled=false;
    $("flavor-status").textContent="Annotations changed. Recalculate the flavor estimate.";
  }
  renderFlavor(flavorResult,flavorResult?"":"No current estimate. Calculate after reviewing annotations.");
}
function readMeta(){session.title=$("title").value.trim()||"Untitled cooking session";session.source_name=$("source-name").value.trim();session.duration_s=Number($("duration").value);session.recipe_text=$("recipe-text").value;return session}
function showMeta(){for(const [id,key] of [["title","title"],["source-name","source_name"],["duration","duration_s"],["recipe-text","recipe_text"]])$(id).value=session[key];render()}
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null}$("camera-preview").srcObject=null;$("camera-preview").hidden=true;$("camera-snap").hidden=true;$("camera-cancel").hidden=true;$("camera-open").hidden=false}
function resetMedia(){stopCamera();if(mediaUrl)URL.revokeObjectURL(mediaUrl);mediaUrl=null;mediaKind=null;$("video").pause();$("video").removeAttribute("src");$("video").hidden=true;$("image").removeAttribute("src");$("image").hidden=true;$("media-empty").hidden=false;$("media-file").value="";updateAnalyze()}
function updateAnalyze(){$("analyze").disabled=analysisBusy||!$("model").value||!(mediaKind==="image"||(mediaKind==="video"&&Number($("duration").value)>0))}
async function inspectMedia(file,kind){
  const url=URL.createObjectURL(file);
  try{
    const probe=kind==="video"?document.createElement("video"):new Image();
    const ready=kind==="video"?"loadedmetadata":"load";
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Media could not be decoded within 15 seconds.")),15000);probe.addEventListener(ready,()=>{clearTimeout(timer);resolve()},{once:true});probe.addEventListener("error",()=>{clearTimeout(timer);reject(Error("Unsupported or damaged media."))},{once:true});probe.src=url});
    if(kind==="video"&&(!Number.isFinite(probe.duration)||probe.duration>600))throw Error("Use a video under 10 minutes for this annotation format.");
    return kind==="video"?Number(probe.duration.toFixed(1)):0;
  }finally{URL.revokeObjectURL(url)}
}
async function attachMedia(file){
  const kind=file.type.startsWith("video/")?"video":file.type.startsWith("image/")?"image":null;
  if(!kind){msg("Choose a video or image.");return}
  if(file.size>250*1024*1024){msg("Choose media smaller than 250 MB.");return}
  let duration;
  try{duration=await inspectMedia(file,kind)}catch(error){msg(error.message);return}
  let sourceHash=null;
  try{if(crypto.subtle)sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,"0")).join("")}catch{msg("Source fingerprint unavailable; verify the source manually.")}
  const verifiedSame=sourceHash!==null&&session.source_sha256===sourceHash;
  const sameSource=verifiedSame||(!session.source_sha256&&file.name===$("source-name").value.trim()&&file.name===session.source_name);
  if(session.events.length||session.ingredients.some(item=>item.reviewed)){
    if(!verifiedSame){const prompt=sameSource?"These older notes have no source fingerprint. Confirm this is the same source version and keep the timeline?":"This is different source media. Clear the old timeline and ingredient review before attaching it?";if(!confirm(prompt))return}
  }
  resetMedia();
  mediaUrl=URL.createObjectURL(file);mediaKind=kind;
  $("media-empty").hidden=true;
  const view=$(kind);view.src=mediaUrl;view.hidden=false;
  if(!sameSource){session.events=[];session.ingredients.forEach(item=>item.reviewed=false);session.analysis_model="manual";activeCaseId=null}
  session.source_name=file.name;session.source_sha256=sourceHash;$("source-name").value=file.name;
  session.duration_s=duration;
  if(session.events.some(event=>event.timestamp_s!==null&&event.timestamp_s>duration)){session.events=[];session.ingredients.forEach(item=>item.reviewed=false);msg("Timeline cleared because it exceeds this source's duration.")}
  $("duration").value=session.duration_s;
  render();updateAnalyze();
  msg(verifiedSame?"Source fingerprint matches. Timeline retained.":sameSource?"Source reattached; older notes had no fingerprint. Verify prior events.":"New source attached. Old timeline and ingredient reviews cleared.");
}
$("media-file").addEventListener("change",async()=>{const file=$("media-file").files[0];if(file)await attachMedia(file);$("media-file").value=""});
$("camera-open").addEventListener("click",async()=>{
  if(!navigator.mediaDevices?.getUserMedia){msg("Camera access is unavailable in this browser.");return}
  try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});const preview=$("camera-preview");preview.srcObject=cameraStream;preview.hidden=false;$("camera-open").hidden=true;$("camera-snap").hidden=false;$("camera-cancel").hidden=false;await preview.play();msg("Camera is local. Take one photo to attach it.")}
  catch(error){stopCamera();msg(`Camera unavailable: ${error.message}`)}
});
$("camera-cancel").addEventListener("click",stopCamera);
$("camera-snap").addEventListener("click",async()=>{
  const preview=$("camera-preview");if(!cameraStream||!preview.videoWidth){msg("Camera frame is not ready.");return}
  const canvas=document.createElement("canvas");const scale=Math.min(1,1280/Math.max(preview.videoWidth,preview.videoHeight));canvas.width=Math.max(1,Math.round(preview.videoWidth*scale));canvas.height=Math.max(1,Math.round(preview.videoHeight*scale));canvas.getContext("2d").drawImage(preview,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.85));if(!blob){msg("Could not capture the camera frame.");return}
  const file=new File([blob],`camera-${new Date().toISOString().replace(/[:.]/g,"-")}.jpg`,{type:"image/jpeg"});
  await attachMedia(file);
  stopCamera();
});
$("model").addEventListener("change",updateAnalyze);$("duration").addEventListener("input",()=>{readMeta();render();updateAnalyze()});
$("add-ingredient").addEventListener("click",()=>{const name=$("ingredient-name").value.trim();if(!name){msg("Ingredient name is required.");return}session.ingredients.push({name,quantity_g:num("ingredient-quantity"),preparation:$("ingredient-preparation").value,evidence:$("ingredient-evidence").value,reviewed:true});$("ingredient-name").value="";$("ingredient-quantity").value="";render()});
$("add-event").addEventListener("click",()=>{const description=$("event-description").value.trim();if(!description){msg("Event description is required.");return}session.events.push({timestamp_s:num("event-time"),action:$("event-action").value,ingredient:$("event-ingredient").value.trim(),vessel:$("event-vessel").value.trim()||"bowl",description,evidence:$("event-evidence").value,confidence:$("event-confidence").value,reviewed:true,duration_s:num("event-duration"),target_temperature_c:num("event-temp"),particle_size_mm:num("event-size")});$("event-description").value="";render()});
async function validate(data){const response=await fetch("/api/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});if(!response.ok){const error=await response.json();throw Error(JSON.stringify(error.detail||error))}return response.json()}
$("save").addEventListener("click",async()=>{try{const checked=await validate(readMeta());const blob=new Blob([JSON.stringify(checked,null,2)+"\n"],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`${escapeFile(checked.title)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);msg("Validated annotation exported.")}catch(e){msg(`Fix the session before export: ${e.message}`)}});
$("save-local").addEventListener("click",async()=>{
  try{const snapshot=JSON.parse(JSON.stringify(readMeta())),caseId=activeCaseId;const checked=await validate(snapshot);const savedAt=new Date().toISOString();localStorage.setItem(LOCAL_SAVE_KEY,JSON.stringify({saved_at:savedAt,session:checked,case_id:caseId}));$("saved-status").textContent=`Saved ${checked.title} · ${new Date(savedAt).toLocaleString()}`;msg("Notes saved in this browser. Media is not stored.")}
  catch(error){msg(`Could not save notes: ${error.message}`)}
});
$("restore-local").addEventListener("click",async()=>{
  try{const stored=localStorage.getItem(LOCAL_SAVE_KEY);if(!stored)throw Error("No saved session in this browser.");const saved=JSON.parse(stored);const restored=await validate(saved.session);session=restored;activeCaseId=cases.some(item=>item.id===saved.case_id)?saved.case_id:null;resetMedia();showMeta();$("saved-status").textContent=`Restored ${restored.title} · ${new Date(saved.saved_at).toLocaleString()}`;msg("Saved notes restored. Reattach the source media to inspect it.");runFlavor()}
  catch(error){msg(`Could not restore notes: ${error.message}`)}
});
$("import").addEventListener("click",()=>$("import-file").click());$("import-file").addEventListener("change",async()=>{const file=$("import-file").files[0];if(!file)return;try{if(file.size>1000000)throw Error("Annotation JSON must be smaller than 1 MB.");const imported=JSON.parse(await file.text());session=await validate(imported);activeCaseId=null;resetMedia();showMeta();msg("Session imported. Source media must be reselected.");runFlavor()}catch(e){msg(`Import failed: ${e.message}`)}$("import-file").value=""});
$("clear").addEventListener("click",()=>{session=blank();activeCaseId=null;resetMedia();showMeta();msg("Session cleared.")});
$("sample").addEventListener("click",async()=>{try{const response=await fetch("/sample.json");session=await validate(await response.json());activeCaseId=null;resetMedia();showMeta();msg("Synthetic sample loaded.");runFlavor()}catch(e){msg(e.message)}});
$("case-select").addEventListener("change",()=>{const item=cases.find(entry=>entry.id===$("case-select").value);$("case-description").textContent=item?item.description:"Authored examples have no source media or sensory measurements."});
$("load-case").addEventListener("click",()=>{const item=cases.find(entry=>entry.id===$("case-select").value);if(!item)return;session=JSON.parse(JSON.stringify(item.session));activeCaseId=item.id;resetMedia();showMeta();msg(`Loaded ${item.title||item.session.title}. Illustrative case; no source media.`);runFlavor()});
async function loadCases(){try{const response=await fetch("/api/cases");if(!response.ok)throw Error("Case library unavailable");const data=await response.json();cases=data.cases;const select=$("case-select");select.replaceChildren();for(const item of cases)select.add(new Option(item.session.title,item.id));$("case-count").textContent=`${cases.length} CASES`;$("load-case").disabled=!cases.length;if(cases.length){select.value=cases[0].id;$("case-description").textContent=cases[0].description;if(!session.ingredients.length&&!session.events.length&&$("title").value==="Untitled cooking session"){session=JSON.parse(JSON.stringify(cases[0].session));activeCaseId=cases[0].id;showMeta();runFlavor()}}}catch(e){$("case-count").textContent="CASES UNAVAILABLE";$("case-description").textContent=e.message}}
async function runFlavor(){
  readMeta();const key=predictionKey(),serial=++flavorSerial;
  flavorKey=key;
  const button=$("calculate-flavor");button.disabled=true;
  $("flavor-status").textContent="Calculating with the local research engine…";
  try{
    const response=await fetch("/api/flavor/predict",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session,case_id:activeCaseId,residual:$("flavor-model").value})});
    const data=await response.json();
    if(!response.ok)throw Error(typeof data.detail==="string"?data.detail:"Flavor estimate failed.");
    if(serial!==flavorSerial||key!==predictionKey())return;
    flavorResult=data;flavorKey=key;renderFlavor(data);
    $("flavor-status").textContent=`${Object.values(data.axes).filter(axis=>axis.score!==null).length} dimensions scored · ${data.sequence_model?.requested==="mamba"?"Mamba exploratory":"deterministic"}`;
  }catch(error){
    if(serial!==flavorSerial)return;
    flavorResult=null;flavorKey=null;renderFlavor(null,error.message);
    $("flavor-status").textContent=error.message;
  }finally{if(serial===flavorSerial)button.disabled=false}
}
$("calculate-flavor").addEventListener("click",runFlavor);
$("flavor-model").addEventListener("change",runFlavor);
async function refreshModels(){try{const response=await fetch("/api/local-models");const data=await response.json();const list=$("model");list.replaceChildren(new Option("Manual annotation",""));for(const name of data.models)list.add(new Option(name,name));$("model-note").textContent=data.models.length?"Local vision model available. Drafts require review.":"No local vision model found. Manual annotation is ready."}catch{$("model-note").textContent="Manual annotation is ready."}updateAnalyze()}
function imageFrame(node,time=0){
  const width=node.videoWidth||node.naturalWidth,height=node.videoHeight||node.naturalHeight;
  if(!width||!height)throw Error("The source frame is not ready.");
  const canvas=document.createElement("canvas"),scale=Math.min(1,1280/Math.max(width,height));
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext("2d").drawImage(node,0,0,canvas.width,canvas.height);
  return {timestamp_s:time,jpeg:canvas.toDataURL("image/jpeg",.72).split(",")[1]};
}
async function frameAt(time){
  const video=$("video");
  if(Math.abs(video.currentTime-time)<.001&&video.readyState>=2)return imageFrame(video,time);
  return new Promise((resolve,reject)=>{
    const done=()=>{cleanup();try{resolve(imageFrame(video,time))}catch(error){reject(error)}};
    const fail=()=>{cleanup();reject(Error("Video frame could not be decoded."))};
    const timer=setTimeout(fail,15000);
    function cleanup(){clearTimeout(timer);video.removeEventListener("seeked",done);video.removeEventListener("error",fail)}
    video.addEventListener("seeked",done,{once:true});video.addEventListener("error",fail,{once:true});video.currentTime=time;
  });
}
function analysisKey(){return JSON.stringify([mediaUrl,mediaKind,session.source_sha256,session.ingredients,session.events,$("recipe-text").value,$("source-name").value,$("duration").value,$("model").value])}
$("analyze").addEventListener("click",async()=>{
  readMeta();const key=analysisKey(),originalMediaUrl=mediaUrl,kind=mediaKind,duration=kind==="image"?0:session.duration_s,oldTime=$("video").currentTime;
  analysisBusy=true;updateAnalyze();$("model-note").textContent="Sampling frames and drafting locally. On a CPU this may take minutes.";
  try{
    const frames=[];
    if(kind==="image")frames.push(imageFrame($("image")));
    else{const times=[.01,.2,.4,.6,.8,.98].map(r=>Math.min(duration*.999,Math.max(.001,duration*r)));for(const time of times)frames.push(await frameAt(time))}
    if(key!==analysisKey())throw Error("Source or annotations changed; the draft was discarded.");
    const response=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:$("model").value,source_kind:kind,duration_s:duration,recipe_text:session.recipe_text,frames})});
    const data=await response.json();if(!response.ok)throw Error(typeof data.detail==="string"?data.detail:"Analysis failed");
    if(key!==analysisKey())throw Error("Source or annotations changed; the draft was discarded.");
    session.ingredients.push(...data.ingredients);session.events.push(...data.events);session.analysis_model=data.analysis_model;render();msg("Draft added. Review each item against the source.");
  }catch(error){msg(`Local analysis failed: ${error.message}`)}
  finally{if(kind==="video"&&originalMediaUrl===mediaUrl)$("video").currentTime=oldTime;analysisBusy=false;$("model-note").textContent="Drafts require human review.";updateAnalyze()}
});
render();refreshModels();loadCases();
