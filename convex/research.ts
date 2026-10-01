import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { action, internalMutation, internalQuery, query, mutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { createMacalyLanguageModel } from "./macalyModel"
import { generateText } from "ai"
import { serpApiSearch } from "./serpApiSearch"

const OWNER_EMAIL = "jabari.xai@gmail.com"

async function requireOwner(ctx: any) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Authentication required.")
  const user = await ctx.runQuery(internal.research.getUser, { userId })
  const identity=await ctx.auth.getUserIdentity();const identityEmail=String((identity as any)?.email??"").toLowerCase();if (identityEmail !== OWNER_EMAIL && user?.email?.toLowerCase() !== OWNER_EMAIL) throw new Error("Owner access required.")
}

function env(name:string){ const x=process.env[name]; if(!x) throw new Error(`Missing required Convex environment variable: ${name}`); return x }

export const getUser = internalQuery({ args:{userId:v.id("users")}, handler:async(ctx,args)=>ctx.db.get(args.userId) })

export const search = action({
  args:{niche:v.string(),location:v.string(),keywords:v.string(),platform:v.optional(v.string())},
  handler:async(ctx,args)=>{
    await requireOwner(ctx)
    const niche=args.niche.trim(), location=args.location.trim(), keywords=args.keywords.trim()
    if(!niche) throw new Error("Enter a niche.")
    const platform=(args.platform??"Google Search").trim(); const queryText=[niche,location,keywords,platform,"business contact"].filter(Boolean).join(" ")
    const results=await serpApiSearch(queryText,20)
    const rows=results.slice(0,20).map((item:any)=>({query:queryText,name:String(item.title??"Untitled prospect"),url:String(item.url??""),snippet:String(item.snippet??""),source:"google"})).filter((row:any)=>row.url)
    await ctx.runMutation(internal.research.saveResults,{rows})
    return {query:queryText,count:rows.length}
  },
})


function cleanQueryPart(value:string){return value.replace(/["']/g," ").replace(/\s+/g," ").trim()}
function expandCustomQuery(raw:string, depth:string){
  const normalized=raw.replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g," ").trim()
  const domains=[...normalized.matchAll(/@([a-z0-9.-]+)/gi)].map(m=>m[1].toLowerCase())
  const uniqueDomains=[...new Set(domains)]
  const variants=[normalized]
  if(uniqueDomains.length>1){
    for(const domain of uniqueDomains){
      variants.push(normalized.replace(/"?@[a-z0-9.-]+"?(?:\s+OR\s+"?@[a-z0-9.-]+"?)+/i, "@"+domain))
    }
  }
  const limit=depth==="Deep"?10:depth==="Quick"?3:6
  return [...new Set(variants)].slice(0,limit)
}

function buildQueries(service:string,niche:string,location:string,condition:string,avoid:string,siteDomain:string,emailDomains:string){
  const svc=cleanQueryPart(service),n=cleanQueryPart(niche),l=cleanQueryPart(location),a=cleanQueryPart(avoid)
  const site=cleanQueryPart(siteDomain).replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/$/,"")
  const domains=emailDomains.split(/[,;|\s]+/).map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/^@/,"")).filter(Boolean)
  const exclusions="-jobs -hiring -career -agency -agencies -freelancer -freelance -directory -directories -yellowpages -yelp -review -reviews -news"
  const target=[n,l].filter(Boolean).map(x=>"\"" + x + "\"").join(" ")
  const emailPart=domains.length ? " ("+domains.map(d=>"\"@"+d+"\"").join(" OR ")+")" : ""
  const avoidPart=a ? " -" + a.split(/[,;|]/).map(x=>x.trim()).filter(Boolean).join(" -") : ""
  const platform=site ? "site:"+site+" " : ""
  const noSite=condition==="No website" ? " (\"no website\" OR \"without a website\")" : ""
  const weak=condition==="Weak/outdated website" ? " (\"old website\" OR \"outdated website\" OR \"broken website\" OR \"website not working\")" : ""
  return [
    platform+target+" "+svc+emailPart+" "+exclusions+avoidPart,
    platform+target+" "+svc+" (\"contact\" OR \"email\" OR \"WhatsApp\") "+emailPart+" "+exclusions+avoidPart,
    target+" "+svc+" \"contact us\" "+emailPart+" "+exclusions+avoidPart,
    target+" "+svc+" (\"WhatsApp\" OR \"call\" OR \"email\") "+emailPart+" "+exclusions+avoidPart,
    target+" "+svc+noSite+weak+" "+exclusions+avoidPart,
    "intitle:\""+n+"\" "+(l?"\""+l+"\" ":"")+svc+" contact "+emailPart+" "+exclusions+avoidPart,
  ].filter(Boolean).map(x=>x.replace(/\s+/g," ").trim()).slice(0,7)
}
function canonicalUrl(raw:string){try{const u=new URL(raw);u.hash="";u.search="";return u.toString().replace(/\/$/,"").toLowerCase()}catch{return raw.trim().toLowerCase()}}
function isIndependentWebsite(raw:string){
  try{
    const host=new URL(raw).hostname.toLowerCase().replace(/^www\./,"")
    const social=["facebook.com","instagram.com","linkedin.com","tiktok.com","x.com","twitter.com","youtube.com","wa.me","whatsapp.com"]
    return Boolean(host) && !social.some(d=>host===d||host.endsWith("."+d))
  }catch{return false}
}
function candidateIsNoise(row:any,avoidTerms:string){
  const hay=(String(row.name)+" "+String(row.url)+" "+String(row.snippet)).toLowerCase()
  const path=String(row.url).toLowerCase()
  const defaults=["directory","yellow pages","business listing","company listings","list of businesses","find businesses","top 10","top 20","ranking","rankings","news","jobs","job board","hiring","career","events/","/blog/","/news/","/category/","/tag/","/rankings/","/directory/","upwork.com","fiverr.com","freelancer.com","clutch.co","yelp.com"]
  const custom=avoidTerms.split(/[,;|]/).map(x=>x.trim().toLowerCase()).filter(Boolean)
  return [...defaults,...custom].some(x=>x&&hay.includes(x)) || path.includes("/search?")
}
function parseJson(text:string){const cleaned=text.trim();try{return JSON.parse(cleaned)}catch{const a=cleaned.indexOf("[");const b=cleaned.lastIndexOf("]");if(a>=0&&b>a){try{return JSON.parse(cleaned.slice(a,b+1))}catch{}}return []}}
async function websiteCrossCheck(name:string, location:string){
  const q=[`"${name}"`, location ? `"${location}"` : "", `"official website"`].filter(Boolean).join(" ")
  try{
    const results=await serpApiSearch(q,10)
    const independent=results.filter((x:any)=>isIndependentWebsite(String(x.url||"")))
    return {found:independent.length>0,evidence:independent.slice(0,5).map((x:any)=>({title:String(x.title||""),url:String(x.url||""),snippet:String(x.snippet||"")}))}
  }catch{return {found:false,evidence:[]}}
}

export const leadMachine=action({
  args:{service:v.string(),niche:v.string(),location:v.string(),condition:v.string(),avoid:v.string(),siteDomain:v.optional(v.string()),emailDomains:v.optional(v.string()),customQuery:v.optional(v.string()),searchDepth:v.optional(v.string())},
  handler:async(ctx,args)=>{
    await requireOwner(ctx)
    const service=args.service.trim(),niche=args.niche.trim(),location=args.location.trim(),condition=args.condition.trim()||"Either",avoid=args.avoid.trim(),siteDomain=(args.siteDomain||"instagram.com").trim(),emailDomains=(args.emailDomains||"gmail.com yahoo.com hotmail.com outlook.com aol.com").trim(),customQuery=(args.customQuery||"").trim(),searchDepth=(args.searchDepth||"Standard").trim()
    if(!service||!niche)throw new Error("Enter what you sell and who you want to reach.")
    const baseQueries=customQuery ? expandCustomQuery(customQuery,searchDepth) : buildQueries(service,niche,location,condition,avoid,siteDomain,emailDomains)
    const expandedQueries=customQuery && location && !customQuery.toLowerCase().includes(location.toLowerCase())
      ? baseQueries.map(q=>`${q} "${cleanQueryPart(location)}"`)
      : baseQueries
    const queryLimit=searchDepth==="Quick"?3:searchDepth==="Deep"?10:6
    const queries=expandedQueries.slice(0,queryLimit)
    const candidates:any[]=[]
    for(const queryText of queries){
      const perQueryLimit=searchDepth==="Quick"?10:searchDepth==="Deep"?20:15
      const results=await serpApiSearch(queryText,perQueryLimit,location||undefined)
      for(const item of results.slice(0,perQueryLimit)){
        const row={query:queryText,name:String(item.title??"Untitled prospect"),url:String(item.url??""),snippet:String(item.snippet??""),source:"google"}
        if(!row.url||candidateIsNoise(row,avoid))continue
        candidates.push(row)
      }
    }
    const unique:any[]=[];const seen=new Set<string>()
    for(const row of candidates){const key=canonicalUrl(row.url);if(seen.has(key))continue;seen.add(key);unique.push(row);if(unique.length>=(searchDepth==="Deep"?60:searchDepth==="Quick"?30:40))break}
    if(!unique.length)return {queries:queries.length,results:0,qualified:0,review:0}
    // Website verification is expensive: only check ambiguous candidates.
    // Independent business websites are already conclusive; social/profile results are checked in a small top slice.
    const needsWebsiteCheck=(row:any)=>{
      if(isIndependentWebsite(row.url)) return false
      if(condition==="Any potential buyer") return false
      return true
    }
    const crossChecked:any[]=[]
    const checkLimit=searchDepth==="Quick"?5:searchDepth==="Deep"?20:10
    for(const row of unique.filter(needsWebsiteCheck).slice(0,checkLimit)){
      const check=await websiteCrossCheck(row.name,location)
      crossChecked.push({...row,websiteEvidence:check.evidence,websiteFound:check.found})
    }
    const checkedMap=new Map(crossChecked.map((x:any)=>[canonicalUrl(x.url),x]))
    const enrichedCandidates=unique.map((row:any)=>{
      if(isIndependentWebsite(row.url)) return {...row,websiteEvidence:[],websiteFound:true}
      return checkedMap.get(canonicalUrl(row.url))||{...row,websiteEvidence:[],websiteFound:false}
    })
    const prompt=JSON.stringify({target:{service,niche,location,condition,avoid},candidates:enrichedCandidates})
    const ai=await generateText({
      model:createMacalyLanguageModel({baseUrl:env("MACALY_BASE_URL"),apiToken:env("MACALY_API_TOKEN"),chatId:env("MACALY_CHAT_ID"),bypassHeader:process.env.MACALY_BYPASS_HEADER,preset:"FAST"}),
      system:"You qualify public business prospects for Jabari Tech. Return ONLY a JSON array with keys url, real_business, buyer_fit, website_status, qualified, reason, contact_email, contact_name. website_status must be no_website, social_only, weak_or_broken, has_website, or unknown. Do not invent facts. A social-media result is NOT proof that the business has no website. For no_website, use the supplied website cross-check evidence: if an independent website belonging to the business is found, use has_website; if no plausible independent website is found in the supplied cross-check, use no_website with a reason that this is based on the public search performed, not absolute proof. A social-media result alone does not prove has_website or no_website. For weak_or_broken require explicit evidence of an outdated, broken, unavailable, or basic site. If the supplied candidate URL itself is an independent business website, website_status must be has_website. Reject directories, articles, rankings, agencies, freelancers, job pages, and competitors. A candidate is qualified only when it is a real potential buyer and matches the requested website condition. Emails and names must be explicitly shown in the supplied text or be empty.",
      prompt,
    })
    const analyzed=parseJson(ai.text);const byUrl=new Map<string,any>()
    for(const item of Array.isArray(analyzed)?analyzed:[]){if(item&&item.url)byUrl.set(canonicalUrl(String(item.url)),item)}
    const rows:any[]=[];let qualified=0,review=0;const now=Date.now()
    for(const row of unique){
      const q=byUrl.get(canonicalUrl(row.url));if(!q||q.real_business===false||q.buyer_fit===false)continue
      const evidenceRow=checkedMap.get(canonicalUrl(row.url))
      let websiteStatus=String(q.website_status||"unknown")
      if(isIndependentWebsite(row.url)) websiteStatus="has_website"
      else if(evidenceRow?.websiteFound) websiteStatus="has_website"
      else if(websiteStatus==="unknown" && condition==="No website") websiteStatus="no_website"
      const websiteEvidence=evidenceRow?.websiteEvidence||[]
      const conditionMatches =
        condition==="No website"
          ? websiteStatus==="no_website"
          : condition==="Weak/outdated website"
            ? websiteStatus==="weak_or_broken"
            : condition==="Either"
              ? ["no_website","weak_or_broken"].includes(websiteStatus)
              : true
      const qualifies=q.qualified===true && websiteStatus!=="has_website" && conditionMatches
      const status=qualifies?"qualified":"review";if(status==="qualified")qualified++;else review++
      rows.push({...row,targetService:service,targetNiche:niche,targetLocation:location,targetCondition:condition,avoidTerms:avoid,qualificationStatus:status,qualificationReason:String(q.reason||"Requires manual review.")+(websiteEvidence.length?` Website cross-check found: ${websiteEvidence.map((x:any)=>x.url).join(", ")}`:" Website cross-check did not surface an independent site; this is not absolute proof the business has no website."),websiteStatus,websiteEvidence:JSON.stringify(websiteEvidence),contactEmail:String(q.contact_email||"")||undefined,contactName:String(q.contact_name||"")||undefined,fitReason:String(q.reason||""),status:"research",createdAt:now,updatedAt:now})
    }
    if(rows.length)await ctx.runMutation(internal.research.saveQualifiedResults,{rows})
    return {queries:queries.length,results:rows.length,qualified,review}
  },
})

export const saveResults = internalMutation({
  args:{rows:v.array(v.object({query:v.string(),name:v.string(),url:v.string(),snippet:v.string(),source:v.string()}))},
  handler:async(ctx,args)=>{
    const now=Date.now()
    for(const row of args.rows){
      const existing=await ctx.db.query("prospects").withIndex("by_url",q=>q.eq("url",row.url)).first()
      if(existing) await ctx.db.patch(existing._id,{...row,status:existing.status==="discarded"?"research":existing.status,updatedAt:now})
      else { const id=await ctx.db.insert("prospects",{...row,status:"research",targetService:"",targetNiche:"",targetLocation:"",targetCondition:"",avoidTerms:"",qualificationStatus:"unknown",qualificationReason:"",websiteStatus:"unknown",analysisStatus:"pending",contactStatus:"not_checked",createdAt:now,updatedAt:now}); await ctx.db.insert("outreachEvents",{kind:"prospect_researched",prospectId:id,metadata:{query:row.query,source:row.source},createdAt:now}) }
    }
  },
})

export const saveQualifiedResults=internalMutation({
  args:{rows:v.array(v.any())},
  handler:async(ctx,args)=>{
    const now=Date.now()
    for(const row of args.rows){
      const existing=await ctx.db.query("prospects").withIndex("by_url",q=>q.eq("url",row.url)).first()
      const base={
        query:String(row.query),name:String(row.name),url:String(row.url),snippet:String(row.snippet),source:String(row.source),
        targetService:row.targetService,targetNiche:row.targetNiche,targetLocation:row.targetLocation,targetCondition:row.targetCondition,avoidTerms:row.avoidTerms,
        qualificationStatus:row.qualificationStatus,qualificationReason:row.qualificationReason,websiteStatus:row.websiteStatus,
        contactEmail:row.contactEmail,contactName:row.contactName,fitReason:row.fitReason,analysisStatus:row.analysisStatus||"pending",contactStatus:row.contactStatus||"not_checked",
        status:(existing?.status==="saved"?"saved":"research") as "saved"|"research",updatedAt:now
      }
      if(existing) await ctx.db.patch(existing._id,base)
      else{
        const id=await ctx.db.insert("prospects",{...base,createdAt:now})
        await ctx.db.insert("outreachEvents",{kind:"prospect_researched",prospectId:id,metadata:{query:row.query,qualification:row.qualificationStatus,websiteStatus:row.websiteStatus},createdAt:now})
      }
    }
  },
})

export const listRecent = query({
  args:{},
  handler:async(ctx)=>{ await requireOwner(ctx); return await ctx.db.query("prospects").withIndex("by_status_and_updatedAt").order("desc").take(50) },
})

export const updateStatus = mutation({
  args:{prospectId:v.id("prospects"),status:v.union(v.literal("research"),v.literal("saved"),v.literal("discarded"))},
  handler:async(ctx,args)=>{ await requireOwner(ctx); await ctx.db.patch(args.prospectId,{status:args.status,updatedAt:Date.now()}) },
})

function parseObject(text:string){
  const cleaned=text.trim().replace(/^```json\s*/i,"").replace(/```\s*$/,"").trim()
  try{return JSON.parse(cleaned)}catch{const a=cleaned.indexOf("{"),b=cleaned.lastIndexOf("}");if(a>=0&&b>a){try{return JSON.parse(cleaned.slice(a,b+1))}catch{}}return {}}
}
export const analyze = action({
  args:{prospectId:v.id("prospects")},
  handler:async(ctx,args)=>{
    await requireOwner(ctx)
    const prospect=await ctx.runQuery(internal.research.getProspect,{prospectId:args.prospectId})
    if(!prospect) throw new Error("Prospect not found.")
    await ctx.runMutation(internal.research.markAnalysis,{prospectId:args.prospectId,status:"pending"})
    try {
      const extra=await serpApiSearch("\""+prospect.name+"\" \""+prospect.url+"\" contact email owner founder about",10)
      const result=await generateText({
        model:createMacalyLanguageModel({baseUrl:env("MACALY_BASE_URL"),apiToken:env("MACALY_API_TOKEN"),chatId:env("MACALY_CHAT_ID"),bypassHeader:process.env.MACALY_BYPASS_HEADER,preset:"FAST"}),
        system:"You are Jabari Tech prospect intelligence analyst. Use ONLY the supplied prospect and search evidence. Return ONLY valid JSON with keys email, phone, contact, fit, pain, subject, body. email must be an explicitly displayed public email or empty. phone must be an explicitly displayed public phone number or empty. contact must be an explicitly displayed person/name or empty. fit must explain why this specific business is a plausible buyer for the requested service, grounded in evidence. pain must describe a specific website/digital opportunity visible from evidence; if insufficient, say so. subject must be concise and specific. body must be a short respectful personalized outreach email. Never claim no website as certainty; say I could not find an independent website in the public results I checked when appropriate. Never invent pricing, clients, results, previous contact, or facts.",
        prompt:JSON.stringify({prospect,additionalSearch:extra}),
      })
      const obj=parseObject(result.text)
      const email=normalizeEmail(String(obj.email||""))
      const phone=normalizePhone(String(obj.phone||""),prospect.targetLocation)
      const contact=String(obj.contact||"").trim()
      const fit=String(obj.fit||"").trim() || String(prospect.qualificationReason||"This business matches the selected prospect criteria.")
      const pain=String(obj.pain||"").trim() || ((prospect.websiteStatus==="no_website"||prospect.websiteStatus==="social_only") ? "Public search evidence points to a social-first presence without an independent website surfaced in this research." : "A specific website opportunity needs manual review.")
      const subject=String(obj.subject||"").trim() || "Website opportunity for "+prospect.name
      const body=String(obj.body||"").trim() || ("Hello"+(contact?" "+contact:"")+",\n\nI came across "+prospect.name+" while researching "+(prospect.targetNiche||"local businesses")+" in "+(prospect.targetLocation||"your area")+". I could not find an independent website in the public results I checked. I build practical websites for businesses that want a stronger online presence.\n\nIf this is something you are considering, I would be happy to share a few ideas.\n\nBest,\nJabari Tech")
      await ctx.runMutation(internal.research.saveAnalysis,{prospectId:args.prospectId,contactEmail:email||undefined,contactPhone:phone||undefined,contactName:contact||undefined,fitReason:fit,painPoint:pain,outreachSubject:subject,outreachBody:body,status:"ready"})
      await ctx.runMutation(internal.research.recordAnalyzed,{prospectId:args.prospectId,hasEmail:Boolean(email)})
      return {success:true,hasEmail:Boolean(email),hasPhone:Boolean(phone)}
    } catch(error) {
      await ctx.runMutation(internal.research.markAnalysis,{prospectId:args.prospectId,status:"failed"})
      throw error
    }
  },
})
export const recordAnalyzed = internalMutation({args:{prospectId:v.id("prospects"),hasEmail:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{await ctx.db.insert("outreachEvents",{kind:"prospect_analyzed",prospectId:args.prospectId,metadata:{hasEmail:args.hasEmail},createdAt:Date.now()});return null}})

export const getProspect = internalQuery({args:{prospectId:v.id("prospects")},handler:async(ctx,args)=>ctx.db.get(args.prospectId)})
export const markAnalysis = internalMutation({args:{prospectId:v.id("prospects"),status:v.union(v.literal("pending"),v.literal("ready"),v.literal("failed"))},handler:async(ctx,args)=>{await ctx.db.patch(args.prospectId,{analysisStatus:args.status,updatedAt:Date.now()})}})
export const saveAnalysis = internalMutation({
  args:{prospectId:v.id("prospects"),contactEmail:v.optional(v.string()),contactPhone:v.optional(v.string()),contactName:v.optional(v.string()),fitReason:v.string(),painPoint:v.string(),outreachSubject:v.string(),outreachBody:v.string(),status:v.literal("ready")},
  handler:async(ctx,args)=>{await ctx.db.patch(args.prospectId,{contactEmail:args.contactEmail,contactPhone:args.contactPhone,contactName:args.contactName,fitReason:args.fitReason,painPoint:args.painPoint,outreachSubject:args.outreachSubject,outreachBody:args.outreachBody,analysisStatus:args.status,updatedAt:Date.now()})}
})

function normalizePhone(value:string,location?:string){const raw=String(value||"").trim();if(!raw)return null;let d=raw.replace(/[^0-9]/g,"");if(d.startsWith("00"))d=d.slice(2);if(d.startsWith("0") && /nigeria/i.test(String(location||"")))d="234"+d.slice(1);if(d.length<8||d.length>15)return null;return d}
function normalizeEmail(value:string){const m=value.trim().toLowerCase().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return m?.[0]||null}
export const enrichContact=action({args:{prospectId:v.id("prospects")},handler:async(ctx,args)=>{await requireOwner(ctx);const p=await ctx.runQuery(internal.research.getProspect,{prospectId:args.prospectId});if(!p)throw new Error("Prospect not found.");if(p.contactEmail||p.contactPhone){const checkedAt=Date.now();await ctx.runMutation(internal.research.saveContact,{prospectId:args.prospectId,contactEmail:p.contactEmail,contactPhone:p.contactPhone,contactName:p.contactName,contactSource:p.contactSource||"Public search evidence from prospect analysis",contactEvidence:p.contactEvidence||"Contact detail was explicitly displayed in the public search evidence used during analysis.",status:"verified",checkedAt});return{status:"verified",email:p.contactEmail||null,phone:p.contactPhone||null}}await ctx.runMutation(internal.research.setContactStatus,{prospectId:args.prospectId,status:"needs_review",checkedAt:Date.now()});const qs=[`"${p.name}" "${p.url}" email phone`,`"${p.name}" "${p.url}" founder owner email phone`,`"${p.url}" contact phone`,`"${p.name}" "contact us" email phone`];try{const results:any[]=[];for(const q of qs){const d=await serpApiSearch(q,8);results.push(...d)}const r=await generateText({model:createMacalyLanguageModel({baseUrl:env("MACALY_BASE_URL"),apiToken:env("MACALY_API_TOKEN"),chatId:env("MACALY_CHAT_ID"),bypassHeader:process.env.MACALY_BYPASS_HEADER,preset:"FAST"}),system:"Extract only publicly displayed contact details. Never infer anything. Return exactly EMAIL:, PHONE:, CONTACT:, SOURCE:, EVIDENCE:. Leave EMAIL and PHONE blank if none is explicit.",prompt:JSON.stringify({prospect:p,results})});const pick=(l:string)=>r.text.match(new RegExp(`^\\s*${l}:\\s*(.*?)(?=\\n(?:EMAIL|CONTACT|SOURCE|EVIDENCE):|$)`,"is"))?.[1]?.trim()||"";const email=normalizeEmail(pick("EMAIL")),phone=normalizePhone(pick("PHONE"),p.targetLocation),contact=pick("CONTACT"),source=pick("SOURCE"),evidence=pick("EVIDENCE");const status=(email||phone)&&source&&evidence?"verified":(email||phone||contact||source||evidence)?"needs_review":"no_contact";await ctx.runMutation(internal.research.saveContact,{prospectId:args.prospectId,contactEmail:email||undefined,contactPhone:phone||undefined,contactName:contact||undefined,contactSource:source||undefined,contactEvidence:evidence||undefined,status,checkedAt:Date.now()});return{status,email:email||null,phone:phone||null}}catch(e){await ctx.runMutation(internal.research.setContactStatus,{prospectId:args.prospectId,status:"needs_review",checkedAt:Date.now()});throw e}}})
export const setContactStatus=internalMutation({args:{prospectId:v.id("prospects"),status:v.union(v.literal("not_checked"),v.literal("verified"),v.literal("no_contact"),v.literal("needs_review")),checkedAt:v.number()},handler:async(ctx,args)=>{await ctx.db.patch(args.prospectId,{contactStatus:args.status,contactCheckedAt:args.checkedAt,updatedAt:args.checkedAt})}})
export const saveContact=internalMutation({args:{prospectId:v.id("prospects"),contactEmail:v.optional(v.string()),contactPhone:v.optional(v.string()),contactName:v.optional(v.string()),contactSource:v.optional(v.string()),contactEvidence:v.optional(v.string()),status:v.union(v.literal("not_checked"),v.literal("verified"),v.literal("no_contact"),v.literal("needs_review")),checkedAt:v.number()},handler:async(ctx,args)=>{await ctx.db.patch(args.prospectId,{contactEmail:args.contactEmail,contactPhone:args.contactPhone,contactName:args.contactName,contactSource:args.contactSource,contactEvidence:args.contactEvidence,contactStatus:args.status,contactCheckedAt:args.checkedAt,updatedAt:args.checkedAt});const kind=args.status==="verified"?"contact_verified":args.status==="no_contact"?"contact_not_found":"contact_review_needed";await ctx.db.insert("outreachEvents",{kind:kind as any,prospectId:args.prospectId,metadata:{hasEmail:Boolean(args.contactEmail),hasPhone:Boolean(args.contactPhone),source:args.contactSource||null},createdAt:args.checkedAt})}})

export const convertToContact=mutation({
  args:{prospectId:v.id("prospects")},
  returns:v.object({contactId:v.id("contacts"),created:v.boolean()}),
  handler:async(ctx,args)=>{
    await requireOwner(ctx)
    const p=await ctx.db.get(args.prospectId)
    if(!p)throw new Error("Prospect not found.")
    const email=p.contactEmail?.trim().toLowerCase()
    const phone=p.contactPhone?.trim()
    if(!email&&!phone)throw new Error("Verify a public email or phone before adding this prospect to CRM.")
    let contact:any=email?await ctx.db.query("contacts").withIndex("by_email",q=>q.eq("email",email)).first():null
    if(!contact&&phone){
      const rows=await ctx.db.query("contacts").withIndex("by_updatedAt").order("desc").take(500)
      contact=rows.find((x:any)=>x.phone===phone)
    }
    const now=Date.now()
    if(contact){
      await ctx.db.patch(contact._id,{name:p.contactName||contact.name,phone:phone||contact.phone,email:email||contact.email,company:contact.company||p.name,website:contact.website||p.url,updatedAt:now})
      await ctx.db.insert("crmActivities",{contactId:contact._id,type:"note",title:"Prospect linked to CRM",detail:"Converted from prospect research: "+p.name,createdAt:now})
      return {contactId:contact._id,created:false}
    }
    const contactId=await ctx.db.insert("contacts",{name:p.contactName||p.name,email:email||"unknown@local.invalid",company:p.name,phone:phone||undefined,website:p.url,source:"prospect_research",createdAt:now,updatedAt:now})
    await ctx.db.insert("crmActivities",{contactId,type:"note",title:"Prospect added to CRM",detail:"Added from prospect research: "+p.name,createdAt:now})
    return {contactId,created:true}
  }
})


async function deleteProspectData(ctx:any,id:any){
  const drafts=await ctx.db.query("prospectOutreachDrafts").withIndex("by_prospectId_and_updatedAt",q=>q.eq("prospectId",id)).collect();
  for(const d of drafts) await ctx.db.delete(d._id);
  const events=await ctx.db.query("outreachEvents").withIndex("by_prospectId_and_createdAt",q=>q.eq("prospectId",id)).collect();
  for(const e of events) await ctx.db.delete(e._id);
  await ctx.db.delete(id);
}
export const deleteProspect=mutation({args:{prospectId:v.id("prospects")},handler:async(ctx,args)=>{await requireOwner(ctx);const prospect=await ctx.db.get(args.prospectId);if(!prospect)return{deleted:0};await deleteProspectData(ctx,args.prospectId);return{deleted:1}}});
export const clearResearchHistory=mutation({args:{},handler:async(ctx)=>{await requireOwner(ctx);const rows=await ctx.db.query("prospects").withIndex("by_status_and_updatedAt",q=>q.eq("status","research")).collect();for(const p of rows) await deleteProspectData(ctx,p._id);return{deleted:rows.length}}});
export const clearProspectsHistory=mutation({args:{},handler:async(ctx)=>{
  await requireOwner(ctx)
  // Clearing research history must not delete durable CRM work.
  // Saved prospects and prospects already ready for outreach are protected.
  // Captured leads live in the separate leads table and are never touched here.
  const rows=await ctx.db.query("prospects").collect()
  const deletable=rows.filter((p:any)=>p.status!=="saved" && !(p.contactStatus==="verified" && Boolean(p.contactEmail||p.contactPhone)))
  for(const p of deletable) await deleteProspectData(ctx,p._id)
  return{deleted:deletable.length,protected:rows.length-deletable.length}
}});
