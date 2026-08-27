const scholarProfile="https://scholar.google.com/citations?user=eBVRL_gAAAAJ&hl=en";
let publications=[],showAll=false;
const formatNumber=value=>Number(value||0).toLocaleString("en-US");

function safeUrl(url,title){
  return typeof url==="string"&&url.startsWith("https://")?url:`https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
}

function updateMetrics(data){
  const m=data.metrics||{};
  document.querySelector("#metric-publications").textContent=formatNumber(m.publications||publications.length);
  document.querySelector("#metric-citations").textContent=formatNumber(m.citations||1569);
  document.querySelector("#metric-hindex").textContent=formatNumber(m.hindex||26);
  document.querySelector("#metric-i10index").textContent=formatNumber(m.i10index||34);
  if(data.updated){
    const date=new Date(data.updated);
    if(!Number.isNaN(date.getTime()))document.querySelector("#metrics-updated").textContent=`updated ${date.toLocaleDateString("en-US",{month:"long",year:"numeric"})}`;
  }
}

function renderPublications(){
  const query=document.querySelector("#publication-search").value.trim().toLowerCase();
  const type=document.querySelector("#publication-type").value;
  const filtered=publications.filter(p=>{
    const haystack=`${p.title||""} ${p.year||""} ${p.type||""} ${p.venue||""}`.toLowerCase();
    return(!query||haystack.includes(query))&&(type==="all"||String(p.type||"").toLowerCase()===type);
  });
  const visible=showAll||query||type!=="all"?filtered:filtered.slice(0,12);
  const list=document.querySelector("#publication-list");
  list.replaceChildren();

  visible.forEach(p=>{
    const item=document.createElement("article");item.className="publication";
    const year=document.createElement("div");year.className="pub-year";year.textContent=p.year||"—";
    const body=document.createElement("div");
    const link=document.createElement("a");link.className="pub-title";link.href=safeUrl(p.url,p.title);link.target="_blank";link.rel="noopener";link.textContent=p.title;
    const meta=document.createElement("div");meta.className="pub-meta";meta.textContent=[p.type,p.venue].filter(Boolean).join(" • ");
    body.append(link,meta);item.append(year,body);
    if(Number.isFinite(Number(p.citedby))){
      const cites=document.createElement("div");cites.className="cites";cites.textContent=`${formatNumber(p.citedby)} cites`;item.append(cites);
    }
    list.append(item);
  });

  document.querySelector("#publication-results").textContent=`Showing ${visible.length} of ${filtered.length} matching outputs`;
  const button=document.querySelector("#show-all-publications");
  button.hidden=filtered.length<=12||Boolean(query)||type!=="all";
  button.textContent=showAll?"Show latest 12":`Show all ${filtered.length}`;
}

async function loadScholarData(){
  try{
    const response=await fetch("scholar_data.json",{cache:"no-store"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    publications=Array.isArray(data.publications)?data.publications:[];
    publications.sort((a,b)=>Number(b.year||0)-Number(a.year||0)||Number(b.citedby||0)-Number(a.citedby||0));
    updateMetrics(data);renderPublications();
  }catch(error){
    const list=document.querySelector("#publication-list");
    const message=document.createElement("article");message.className="card";
    const link=document.createElement("a");link.href=scholarProfile;link.target="_blank";link.rel="noopener";link.className="pub-title";link.textContent="View the complete publication list on Google Scholar";
    message.append(link);list.replaceChildren(message);
    document.querySelector("#publication-results").textContent="The cached publication file is temporarily unavailable.";
    document.querySelector("#show-all-publications").hidden=true;
  }
}

document.querySelector("#publication-search").addEventListener("input",renderPublications);
document.querySelector("#publication-type").addEventListener("change",renderPublications);
document.querySelector("#show-all-publications").addEventListener("click",()=>{showAll=!showAll;renderPublications()});
loadScholarData();
