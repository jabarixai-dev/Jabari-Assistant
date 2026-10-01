import { useState } from "react"
import { useAuthActions } from "@convex-dev/auth/react"

export function OwnerSignIn() {
  const { signIn } = useAuthActions()
  const [email, setEmail] = useState("jabari.xai@gmail.com")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await signIn("password", { flow: mode, email: email.trim().toLowerCase(), password })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-[#080808] px-5 text-white">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d4af37]">Jabari Tech</p>
        <h1 className="mt-3 text-3xl font-bold">Command Center</h1>
        <p className="mt-2 text-sm text-white/60">Private owner access.</p>
        <label className="mt-7 block text-sm text-white/70">Owner email</label>
        <input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" required className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none" />
        <label className="mt-4 block text-sm text-white/70">Password</label>
        <input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" minLength={8} required className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none" placeholder="At least 8 characters" />
        {error && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-xl bg-[#d4af37] px-4 py-3 font-semibold text-black disabled:opacity-50">
          {busy ? "Authenticating…" : mode === "signIn" ? "Sign in" : "Create owner account"}
        </button>
        <button type="button" onClick={()=>{setMode(mode==="signIn"?"signUp":"signIn");setError("")}} className="mt-4 w-full text-sm text-white/60 underline">
          {mode==="signIn" ? "First time? Create the owner account" : "Already registered? Sign in"}
        </button>
      </form>
    </main>
  )
}
