import { useState } from "react"
import { Link, Outlet, useLocation } from "@tanstack/react-router"
import { useAuthActions } from "@convex-dev/auth/react"
import { useConvexAuth } from "convex/react"
import { OwnerSignIn } from "./owner-sign-in"

const nav = [
 ["Overview","/admin","⌂"],["Leads","/admin/leads","◉"],["Contacts","/admin/contacts","◎"],["Companies","/admin/companies","▣"],["Pipeline","/admin/pipeline","◆"],["Conversations","/admin/conversations","◌"],["Outreach","/admin/outreach","✉"],["Calendar","/admin/calendar","□"],["Automation","/admin/automation","ϟ"],["Reports","/admin/reports","▥"],["Billing","/admin/billing","₦"],["Settings","/admin/settings","⚙"],
] as const

export function AdminShell(){
 const location=useLocation()
 const {isAuthenticated,isLoading}=useConvexAuth()
 const {signOut}=useAuthActions()
 const [mobileOpen,setMobileOpen]=useState(false)

 if(isLoading)return <div className="min-h-screen grid place-items-center bg-[#080808] text-white">Checking secure session…</div>
 if(!isAuthenticated)return <OwnerSignIn/>

 const links=<nav className="space-y-1">{nav.map(([label,to,icon])=><Link key={to} to={to} activeOptions={{exact:to==="/admin"}} onClick={()=>setMobileOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/50 transition hover:bg-white/5 hover:text-white" activeProps={{className:"flex items-center gap-3 rounded-xl bg-[#d4af37]/10 px-3 py-2.5 text-sm text-[#d4af37]"}}><span className="w-5 text-center">{icon}</span>{label}</Link>)}</nav>

 return <div className="min-h-screen bg-[#080808] text-white">
  <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/10 bg-[#0a0a0a] lg:flex lg:flex-col"><div className="border-b border-white/10 px-5 py-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#d4af37]/10 text-sm font-black text-[#d4af37]">JT</div><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af37]">Jabari Tech</p><p className="mt-1 text-xs text-white/40">Command Center</p></div></div></div><div className="flex-1 overflow-y-auto p-3">{links}</div><div className="border-t border-white/10 p-3"><button onClick={()=>void signOut()} className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm text-white/50 hover:bg-white/5 hover:text-white">Sign out</button></div></aside>
  {mobileOpen&&<div className="fixed inset-0 z-50 bg-black/70 lg:hidden" onClick={()=>setMobileOpen(false)}><aside className="h-full w-72 border-r border-white/10 bg-[#0a0a0a] p-4" onClick={e=>e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div className="font-bold">Jabari Tech</div><button onClick={()=>setMobileOpen(false)} className="rounded-lg border border-white/10 px-3 py-2">×</button></div>{links}</aside></div>}
  <div className="lg:pl-64"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#080808]/90 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button className="rounded-lg border border-white/10 px-3 py-2 lg:hidden" onClick={()=>setMobileOpen(true)}>☰</button><div><p className="text-xs text-white/35">Jabari Tech</p><p className="text-sm font-semibold">{nav.find(([,to])=>to===location.pathname)?.[0]??"Command Center"}</p></div></div><div className="flex items-center gap-3"><span className="hidden text-xs text-white/35 sm:block">Owner</span><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">ONLINE</span></div></header><main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8"><Outlet/></main></div>
 </div>
}
