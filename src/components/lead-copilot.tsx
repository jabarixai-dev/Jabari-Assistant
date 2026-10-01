import { useState } from "react";
import { neonFetch } from "../lib/neon-api";

type Result = { summary: string; qualification: string; recommendation: string; draft: string };

export function LeadCopilot({ leadId }: { leadId: string }) {
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true); setError("");
    try {
      setResult(await neonFetch<Result>("/api/lead-copilot", {
        method: "POST",
        body: JSON.stringify({ leadId, focus: focus.trim() || undefined }),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copilot analysis failed.");
    } finally { setBusy(false); }
  };

  const propose = async (type: "create_task" | "create_email_draft", payload: Record<string, unknown>) => {
    try {
      setActionBusy(type); setError("");
      await neonFetch("/api/agent-actions?action=create", {
        method: "POST",
        body: JSON.stringify({ leadId, type, payload }),
      });
      setError("Added to Action Center as a pending action. Review and approve it before execution.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the pending action.");
    } finally { setActionBusy(""); }
  };

  return (
    <section className="border-b border-white/10 bg-[#d4af37]/[0.035] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[#d4af37]">AI Copilot</p>
          <h3 className="mt-1 text-base font-semibold">Analyze this lead</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">Reviews the Neon CRM record, conversation, and activity. Suggested actions never execute automatically.</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{busy ? "Analyzing…" : "Analyze lead"}</button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional focus: pricing questions, qualification, follow-up…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none placeholder:text-white/25" />
      </div>
      {error && <div className="mt-3 rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/5 p-3 text-xs text-[#f1d97a]">{error}</div>}
      {result && <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {[
          ["Summary", result.summary, "border-white/10 bg-black/20"],
          ["Qualification", result.qualification, "border-white/10 bg-black/20"],
          ["Recommended next step", result.recommendation, "border-[#d4af37]/20 bg-[#d4af37]/[0.04]"],
        ].map(([label, text, cls]) => <div key={label} className={"rounded-xl border p-4 " + cls}><p className="text-[10px] uppercase tracking-wider text-white/35">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/75">{text}</p></div>)}
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-[10px] uppercase tracking-wider text-white/35">Suggested follow-up</p><span className="text-[10px] text-white/25">Review before sending</span></div>
            <button type="button" disabled={!result.draft || !!actionBusy} onClick={() => void propose("create_email_draft", { subject: "Follow-up", body: result.draft })} className="rounded-lg border border-[#d4af37]/30 px-3 py-2 text-xs text-[#d4af37] disabled:opacity-40">{actionBusy === "create_email_draft" ? "Adding…" : "Send to Action Center"}</button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/75">{result.draft || "No draft returned."}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-[10px] uppercase tracking-wider text-white/35">Recommended action</p><span className="text-[10px] text-white/25">Creates a pending task only</span></div>
            <button type="button" disabled={!!actionBusy} onClick={() => void propose("create_task", { title: "Follow up with " + (leadId ? "lead" : "contact"), description: result.recommendation })} className="rounded-lg border border-[#d4af37]/30 px-3 py-2 text-xs text-[#d4af37] disabled:opacity-40">{actionBusy === "create_task" ? "Adding…" : "Create pending task"}</button>
          </div>
          <p className="mt-2 text-sm leading-6 text-white/75">{result.recommendation}</p>
        </div>
      </div>}
    </section>
  );
}
