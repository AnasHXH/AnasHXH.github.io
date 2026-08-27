const scholarProfile="https://scholar.google.com/citations?user=eBVRL_gAAAAJ&hl=en";
let publications=[],showAll=false;
const formatNumber=value=>Number(value||0).toLocaleString("en-US");

function safeUrl(url,title){
  return typeof url==="string"&&url.startsWith("https://")?url:`https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
}

function canonicalType(publication){
  const raw=String(publication.type||"").toLowerCase();
  const venue=String(publication.venue||"").toLowerCase();
  const title=String(publication.title||"").toLowerCase();
  const combined=`${raw} ${venue}`;
  if(/chapter|book section|book chapter/.test(combined))return "chapter";
  if(/preprint|arxiv|biorxiv|medrxiv/.test(combined))return "preprint";
  if(/conference|proceedings|workshop|symposium/.test(combined)||/\bntire\b/.test(title))return "conference paper";
  return "article";
}

function typeLabel(type){
  return({article:"Journal article","conference paper":"Conference paper",chapter:"Book chapter",preprint:"Preprint"})[type]||"Publication";
}

function authorText(publication){
  if(Array.isArray(publication.authors)&&publication.authors.length)return publication.authors.join(", ");
  if(typeof publication.authors==="string"&&publication.authors.trim())return publication.authors.trim();
  return "Ali, A. M., et al.";
}

function apaText(publication){
  const authors=authorText(publication);
  const year=publication.year||"n.d.";
  const title=String(publication.title||"Untitled").replace(/[.\s]+$/,"");
  const venue=String(publication.venue||"").replace(/[.\s]+$/,"");
  const doi=String(publication.doi||"").replace(/^https?:\/\/doi\.org\//i,"");
  return `${authors} (${year}). ${title}.${venue?` ${venue}.`:""}${doi?` https://doi.org/${doi}`:""}`;
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

function updateTypeOptions(){
  const counts=publications.reduce((result,publication)=>{
    const type=canonicalType(publication);result[type]=(result[type]||0)+1;return result;
  },{});
  document.querySelectorAll("#publication-type option[data-label]").forEach(option=>{
    option.textContent=`${option.dataset.label} (${counts[option.value]||0})`;
  });
}

function renderPublications(){
  const query=document.querySelector("#publication-search").value.trim().toLowerCase();
  const type=document.querySelector("#publication-type").value;
  const filtered=publications.filter(publication=>{
    const publicationType=canonicalType(publication);
    const haystack=`${authorText(publication)} ${publication.title||""} ${publication.year||""} ${publicationType} ${publication.venue||""} ${publication.doi||""}`.toLowerCase();
    return(!query||haystack.includes(query))&&(type==="all"||publicationType===type);
  });
  const visible=showAll||query||type!=="all"?filtered:filtered.slice(0,12);
  const list=document.querySelector("#publication-list");
  list.replaceChildren();

  visible.forEach(publication=>{
    const item=document.createElement("article");item.className="publication";
    const year=document.createElement("div");year.className="pub-year";year.textContent=publication.year||"—";
    const body=document.createElement("div");body.className="pub-body";
    const citation=document.createElement("p");citation.className="apa-citation";
    const authors=document.createElement("span");authors.className="apa-authors";authors.textContent=`${authorText(publication)} `;
    const date=document.createElement("span");date.textContent=`(${publication.year||"n.d."}). `;
    const title=document.createElement("a");title.className="pub-title";title.href=safeUrl(publication.url,publication.title);title.target="_blank";title.rel="noopener";title.textContent=String(publication.title||"Untitled").replace(/[.\s]+$/,"");
    citation.append(authors,date,title,document.createTextNode("."));
    if(publication.venue){
      const venue=document.createElement("em");venue.textContent=` ${String(publication.venue).replace(/[.\s]+$/,"")}.`;citation.append(venue);
    }
    if(publication.doi){
      const cleanDoi=String(publication.doi).replace(/^https?:\/\/doi\.org\//i,"");
      const doi=document.createElement("a");doi.className="doi-link";doi.href=`https://doi.org/${cleanDoi}`;doi.target="_blank";doi.rel="noopener";doi.textContent=` https://doi.org/${cleanDoi}`;citation.append(doi);
    }
    const meta=document.createElement("div");meta.className="pub-meta";
    const kind=document.createElement("span");kind.className="pub-kind";kind.textContent=typeLabel(canonicalType(publication));meta.append(kind);
    const scholar=document.createElement("a");scholar.href=safeUrl(publication.url,publication.title);scholar.target="_blank";scholar.rel="noopener";scholar.textContent="Find on Google Scholar ↗";meta.append(scholar);
    const copy=document.createElement("button");copy.type="button";copy.className="copy-citation";copy.textContent="Copy APA";
    copy.addEventListener("click",async()=>{
      try{await navigator.clipboard.writeText(apaText(publication));copy.textContent="Copied";setTimeout(()=>{copy.textContent="Copy APA"},1500)}
      catch{copy.textContent="Copy unavailable";setTimeout(()=>{copy.textContent="Copy APA"},1500)}
    });
    meta.append(copy);body.append(citation,meta);item.append(year,body);
    if(Number(publication.citedby)>0){
      const cites=document.createElement("div");cites.className="cites";cites.textContent=`${formatNumber(publication.citedby)} cites`;item.append(cites);
    }
    list.append(item);
  });

  if(!visible.length){
    const empty=document.createElement("div");empty.className="publication-empty";empty.textContent="No matching publications. Try another search or publication type.";list.append(empty);
  }
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
    updateMetrics(data);updateTypeOptions();renderPublications();
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
