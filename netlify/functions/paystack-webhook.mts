import type { Config } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine.mts";

export const config: Config = { path: "/paystack/webhook" };

const sql = () => neon(Netlify.env.get("DATABASE_URL") || "");
const hex = (bytes: Uint8Array) => Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");

async function verifySignature(secret:string, body:string, signature:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
  const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body));
  return hex(new Uint8Array(digest))===signature;
}

export default async (req:Request)=>{
  const secret=Netlify.env.get("PAYSTACK_SECRET_KEY");
  if(!secret) return new Response("Paystack is not configured.",{status:503});
  const raw=await req.text();
  const signature=req.headers.get("x-paystack-signature");
  if(!signature || !(await verifySignature(secret,raw,signature))) return new Response("Invalid signature.",{status:401});
  let event:any; try{event=JSON.parse(raw)}catch{return new Response("Invalid JSON.",{status:400})}
  if(event?.event!=="charge.success" || !event.data?.reference) return new Response("OK",{status:200});

  const reference=String(event.data.reference);
  const verify=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization: "Bearer " + secret}});
  if(!verify.ok) return new Response("Paystack verification failed.",{status:502});
  const verified:any=await verify.json();
  if(!verified.status || verified.data?.status!=="success") return new Response("OK",{status:200});

  const db=sql();
  const paymentRows=await db`SELECT p.id,p.invoice_id,p.status,i.status AS invoice_status,i.total,i.currency,i.contact_id,i.lead_id,i.opportunity_id,i.number FROM paystack_payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.reference=${reference} LIMIT 1`;
  const payment=paymentRows[0] as any;
  if(!payment) return new Response("OK",{status:200});

  const amount=Number(verified.data.amount||0)/100;
  const currency=String(verified.data.currency||"");
  const now=Date.now();
  await db`UPDATE paystack_payments SET status='success',transaction_id=${typeof verified.data.id==="number"?verified.data.id:null},updated_at=${now} WHERE id=${payment.id}`;

  if(payment.invoice_status!=="paid" && Math.round(amount*100)===Math.round(Number(payment.total)*100) && currency===payment.currency){
    await db`UPDATE invoices SET status='paid',paid_at=${now},updated_at=${now} WHERE id=${payment.invoice_id}`;
    await db`INSERT INTO crm_activities (contact_id,lead_id,type,title,detail,created_at) VALUES (${payment.contact_id},${payment.lead_id},'note','Invoice paid via Paystack',${payment.number+" · "+payment.currency+" "+Number(payment.total).toFixed(2)+" · "+reference},${now})`;
    if(payment.opportunity_id) await db`UPDATE opportunities SET stage='won',updated_at=${now} WHERE id=${payment.opportunity_id} AND stage NOT IN ('won','lost')`;
    if(payment.lead_id){
      const leadRows=await db`SELECT status FROM leads WHERE id=${payment.lead_id} LIMIT 1`;
      const status=String((leadRows[0] as any)?.status||"new");
      if(status!=="won" && status!=="lost") await db`UPDATE leads SET status='won',updated_at=${now} WHERE id=${payment.lead_id}`;
      await fireTrigger(db,"invoice_paid",payment.lead_id,status);
      await processDue(db);
    }
  }
  return new Response("OK",{status:200});
};