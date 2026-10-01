import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { query } from "./_generated/server"
const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}
export const global= query({
 args:{q:v.string()},
 returns:v.object({contacts:v.array(v.any()),companies:v.array(v.any()),leads:v.array(v.any()),prospects:v.array(v.any())}),
 handler:async(ctx,args)=>{
  await owner(ctx); const q=args.q.trim().toLowerCase()
  if(q.length<2)return {contacts:[],companies:[],leads:[],prospects:[]}
  const [contacts,companies,leads,prospects]=await Promise.all([
   ctx.db.query("contacts").withIndex("by_updatedAt").order("desc").take(300),
   ctx.db.query("companies").withIndex("by_updatedAt").order("desc").take(200),
   ctx.db.query("leads").withIndex("by_status_and_updatedAt").order("desc").take(200),
   ctx.db.query("prospects").withIndex("by_status_and_updatedAt").order("desc").take(300),
  ])
  const match=(s:string)=>s.toLowerCase().includes(q)
  return {
   contacts:contacts.filter((x:any)=>match([x.name,x.email,x.company,x.phone||"",x.jobTitle||"",x.website||""].join(" "))).slice(0,8),
   companies:companies.filter((x:any)=>match([x.name,x.website||"",x.industry||"",x.notes||""].join(" "))).slice(0,8),
   leads:leads.filter((x:any)=>match([x.name,x.email,x.company,x.request,x.status].join(" "))).slice(0,8),
   prospects:prospects.filter((x:any)=>match([x.name,x.url,x.contactEmail||"",x.contactPhone||"",x.targetNiche].join(" "))).slice(0,8),
  }
 }
})