import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { mutation, query } from "./_generated/server"

const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}

export const list=query({args:{search:v.optional(v.string())},returns:v.array(v.any()),handler:async(ctx,args)=>{
  await owner(ctx)
  const rows=await ctx.db.query("companies").withIndex("by_updatedAt").order("desc").take(200)
  const q=args.search?.trim().toLowerCase()
  return q?rows.filter((r:any)=>[r.name,r.website||"",r.industry||"",r.notes||""].join(" ").toLowerCase().includes(q)):rows
}})

export const syncFromContacts=mutation({args:{},returns:v.object({companies:v.number(),linked:v.number()}),handler:async(ctx)=>{
  await owner(ctx)
  const contacts=await ctx.db.query("contacts").withIndex("by_updatedAt").order("desc").take(500)
  const map=new Map<string,any>()
  for(const c of contacts){const name=String(c.company||"").trim();if(!name)continue;const key=name.toLowerCase();if(!map.has(key))map.set(key,{name})}
  let linked=0
  for(const item of map.values()){
    let company=await ctx.db.query("companies").withIndex("by_name",q=>q.eq("name",item.name)).first()
    if(!company){const id=await ctx.db.insert("companies",{name:item.name,createdAt:Date.now(),updatedAt:Date.now()});company=await ctx.db.get(id)}
    if(!company)continue
    const matching=contacts.filter((c:any)=>String(c.company||"").trim().toLowerCase()===item.name.toLowerCase())
    for(const c of matching){if(c.companyId!==company._id){await ctx.db.patch(c._id,{companyId:company._id,updatedAt:Date.now()});linked++}}
  }
  return {companies:map.size,linked}
}})

export const update=mutation({args:{companyId:v.id("companies"),website:v.optional(v.string()),industry:v.optional(v.string()),notes:v.optional(v.string())},returns:v.null(),handler:async(ctx,args)=>{
  await owner(ctx)
  const c=await ctx.db.get(args.companyId);if(!c)throw new Error("Company not found.")
  await ctx.db.patch(c._id,{website:args.website?.trim()||undefined,industry:args.industry?.trim()||undefined,notes:args.notes?.trim()||undefined,updatedAt:Date.now()})
  return null
}})
