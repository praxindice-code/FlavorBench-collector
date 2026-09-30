"use strict";

const FLAVOR_GROUPS = [
  ["Taste", ["sweetness", "bitterness", "sourness", "saltiness", "umami"]],
  ["Trigeminal", ["pungency", "astringency"]],
  ["Aroma", ["aroma_intensity"]],
  ["Texture", ["crisp", "tender", "viscosity"]],
];
const FLAVOR_LABELS = {aroma_intensity:"Aroma intensity",crisp:"Crispness",tender:"Tenderness"};

function renderFlavor(result, placeholder="Select a case or enter ingredients, then calculate an estimate.") {
  const root=document.getElementById("flavor-output");
  root.replaceChildren();
  const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node};
  if(!result){root.append(make("p","empty-view",placeholder));document.getElementById("flavor-count").textContent="LOCAL ENGINE";return}
  const scored=Object.values(result.axes).filter(axis=>axis.score!==null).length;
  const modeled=Object.values(result.axes).filter(axis=>axis.score_source==="ingredient_model").length;
  const proxy=Object.values(result.axes).filter(axis=>axis.score_source==="illustrative_reference_proxy").length;
  document.getElementById("flavor-count").textContent=`${scored}/11 SCORED`;
  const summary=make("div","flavor-summary-strip");
  for(const [value,label] of [[modeled,"Model estimates"],[proxy,"Demo reference proxies"],[11-scored,"Unscored"]]){
    const item=make("div","flavor-source-count");item.append(make("strong","",value),make("span","",label));summary.append(item)
  }
  root.append(summary);
  const grid=make("div","flavor-grid");
  for(const [groupName,names] of FLAVOR_GROUPS){
    const card=make("section","flavor-group");
    const scores=names.map(name=>result.axes[name]?.score).filter(value=>value!==null&&value!==undefined);
    const average=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100):null;
    const head=make("div","flavor-group-head");
    head.append(make("h3","",groupName),make("span","",average===null?"—":`${average}/100 descriptive avg · ${scores.length}/${names.length}`));
    card.append(head);
    for(const name of names){
      const axis=result.axes[name]||{score:null,score_source:null};
      const source=axis.score_source==="ingredient_model"?"Model estimate":axis.score_source==="illustrative_reference_proxy"?"Demo reference proxy":axis.score_source==="user_observed"?"User observation":"No numeric evidence";
      const line=make("div","flavor-axis");
      const top=make("div","flavor-axis-head");top.append(make("span","",FLAVOR_LABELS[name]||name),make("strong","",axis.score===null?"—":`${Math.round(axis.score*100)}/100`));line.append(top);
      const track=make("div","flavor-track");const fill=make("span",axis.score_source==="illustrative_reference_proxy"?"flavor-fill proxy":"flavor-fill model");fill.style.width=axis.score===null?"0%":`${Math.max(0,Math.min(100,axis.score*100))}%`;track.append(fill);line.append(track);
      line.append(make("small","flavor-source",source));card.append(line)
    }
    grid.append(card)
  }
  root.append(grid);
  if(result.comparison){
    const compare=make("div","flavor-comparison");
    compare.append(make("h3","","Order effect · model estimates"));
    compare.append(make("p","muted",`Current recipe versus ${result.comparison.title}. Both use the same ingredient amounts; these differences come from the provisional process model.`));
    for(const name of ["sweetness","bitterness","sourness","saltiness","umami"]){
      const current=result.axes[name];const other=result.comparison.axes[name];
      if(current?.score_source!=="ingredient_model"||other===undefined)continue;
      const change=Math.round((current.score-other)*100);
      const row=make("div","flavor-compare-row");
      row.append(make("span","",FLAVOR_LABELS[name]||name),make("span","",`${Math.round(current.score*100)} vs ${Math.round(other*100)}`),make("strong",change>0?"positive":change<0?"negative":"",`${change>0?"+":""}${change} pts`));
      compare.append(row)
    }
    root.append(compare)
  }
  const notes=make("div","flavor-notes");
  notes.append(make("p","",result.timeline_basis==="recipe_order_model_schedule"?"Model schedule follows recipe order; these positions are not observed video timestamps.":"The estimate uses the event times provided in this session."));
  if(result.reference_proxies)notes.append(make("p","","Demo reference proxies come from the original authored showcase case and may reflect different process assumptions. They are not measurements of this session."));
  if(result.sequence_model?.requested==="mamba")notes.append(make("p","","Mamba uses a synthetic-trained checkpoint and has not been validated against measured cooking outcomes."));
  if(result.unsupported_ingredients?.length)notes.append(make("p","",`Unsupported ingredients: ${result.unsupported_ingredients.join(", ")}.`));
  const versions=result.versions||{};
  notes.append(make("p","",`Engine ${versions.deterministic_engine||"unknown"} · sensory dataset ${versions.sensory_dataset||"unknown"}`));
  root.append(notes);
}
