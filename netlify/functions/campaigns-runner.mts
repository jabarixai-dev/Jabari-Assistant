import type { Config } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";

export const config: Config = { schedule: "* * * * *" };

function sql() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}

function render(template: string, lead: any) {
  return template
    .replaceAll("{{name}}", String(lead.name || "there"))
    .replaceAll("{{email}}", String(lead.email || ""));
}

async function sendGmail(lead: any, step: any) {
  const clientId=Netlify.env.get("GOOGLE_CLIENT_ID"),clientSecret=Netlify.env.get("GOOGLE_CLIENT_SECRET"),refreshToken=Netlify.env.get("GMAIL_REFRESH_TOKEN");
  if(!clientId||!clientSecret||!refreshToken)throw new Error("Gmail integration credentials are not configured.");
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"})});const token=await tokenResponse.json() as any;if(!tokenResponse.ok||!token.access_token)throw new Error("Google OAuth token refresh failed.");
  const subject=render(String(step.subject||""),lead),body=render(String(step.body||""),lead),sender=Netlify.env.get("OWNER_EMAIL")||"jabari.tech.org@gmail.com",clean=(v:string)=>v.replace(/[\r\n]/g," "),boundary=`----=_Jabari_${crypto.randomUUID().replace(/-/g,"")}`;
  const mime=[`From: Jabari <${clean(sender)}>`,`To: ${clean(lead.email)}`,`Subject: ${clean(subject)}`,"MIME-Version: 1.0",`Content-Type: text/plain; charset=\"UTF-8\"` ,"",body,""].join("\r\n");const bytes=new TextEncoder().encode(mime);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));const raw=btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization: "Bearer " + token.access_token,"content-type":"application/json"},body:JSON.stringify({raw})});if(!response.ok)throw new Error("Gmail rejected the send request.");
}

export default async function handler() {
  const db = sql();
  const now = Date.now();
  const rows = await db`SELECT e.*, c.status AS campaign_status
    FROM campaign_enrollments e
    JOIN campaigns c ON c.id=e.campaign_id
    WHERE e.status='active' AND c.status='active' AND e.next_run_at IS NOT NULL AND e.next_run_at<=${now}
    ORDER BY e.next_run_at ASC LIMIT 40`;

  let processed = 0;
  for (const enrollment of rows as any[]) {
    const step = (await db`SELECT * FROM campaign_steps WHERE campaign_id=${enrollment.campaign_id} AND "order"=${enrollment.current_step} LIMIT 1` as any[])[0];
    const lead = (await db`SELECT * FROM leads WHERE id=${enrollment.lead_id} LIMIT 1` as any[])[0];
    if (!step || !lead) continue;

    try {
      if (step.type === "email") {
        if (!lead.email) throw new Error("Lead has no email address.");
        await sendGmail(lead, step);
      } else if (step.type === "create_task") {
        await db`INSERT INTO workflow_tasks(id,lead_id,title,detail,status,created_at,updated_at)
          VALUES(${crypto.randomUUID()},${lead.id},${render(String(step.body || "Campaign task"), lead)} ,'Created by campaign sequence.','open',${now},${now})`;
      } else if (step.type === "add_note") {
        await db`INSERT INTO crm_activities(id,lead_id,type,title,detail,created_at)
          VALUES(${crypto.randomUUID()},${lead.id},'note','Campaign note',${render(String(step.body || ""), lead)},${now})`;
      } else if (step.type === "update_stage") {
        const stage = String(step.body || "").trim();
        if (!["new","contacted","qualified","won","lost"].includes(stage)) throw new Error("Invalid campaign stage.");
        await db`UPDATE leads SET status=${stage},updated_at=${now} WHERE id=${lead.id}`;
        await db`INSERT INTO crm_activities(id,lead_id,type,title,detail,created_at)
          VALUES(${crypto.randomUUID()},${lead.id},'stage_change','Campaign stage updated',${"Campaign moved lead to " + stage},${now})`;
      }

      const eventType = step.type === "email" ? "email_sent" : step.type === "create_task" ? "task_created" : step.type === "add_note" ? "note_added" : "stage_updated";
      await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at)
        VALUES(${crypto.randomUUID()},${enrollment.campaign_id},${enrollment.id},${lead.id},${enrollment.current_step},${eventType},${"Campaign step completed."},${now})`;

      const next = (await db`SELECT * FROM campaign_steps WHERE campaign_id=${enrollment.campaign_id} AND "order"=${Number(enrollment.current_step)+1} LIMIT 1` as any[])[0];
      if (next) {
        const nextRun = now + Number(next.delay_minutes || 0) * 60000;
        await db`UPDATE campaign_enrollments SET current_step=${next.order},next_run_at=${nextRun} WHERE id=${enrollment.id}`;
        await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at)
          VALUES(${crypto.randomUUID()},${enrollment.campaign_id},${enrollment.id},${lead.id},${next.order},'step_scheduled','Next sequence step scheduled.',${now})`;
      } else {
        await db`UPDATE campaign_enrollments SET status='completed',completed_at=${now},next_run_at=NULL WHERE id=${enrollment.id}`;
        await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at)
          VALUES(${crypto.randomUUID()},${enrollment.campaign_id},${enrollment.id},${lead.id},${enrollment.current_step},'completed','Campaign sequence completed.',${now})`;
      }
      processed++;
    } catch (error) {
      await db`UPDATE campaign_enrollments SET status='stopped',stopped_at=${now},next_run_at=NULL WHERE id=${enrollment.id}`;
      await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at)
        VALUES(${crypto.randomUUID()},${enrollment.campaign_id},${enrollment.id},${lead.id},${enrollment.current_step},'failed',${String(error).slice(0,500)},${now})`;
    }
  }

  console.log(JSON.stringify({ processed, checked: rows.length, at: new Date(now).toISOString() }));
}
