import { useEffect, useState } from "react"
import { neonApi, neonFetch } from "../lib/neon-api"

export function BillingManager() {
  const [products, setProducts] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [customer, setCustomer] = useState("")
  const [email, setEmail] = useState("")
  const [desc, setDesc] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [selectedItems, setSelectedItems] = useState<any[]>([])
  const [message, setMessage] = useState("")

  const load = async () => {
    const r = await neonApi<{ products: any[]; invoices: any[] }>("billing", { query: { action: "list" } })
    setProducts(r.products)
    setInvoices(r.invoices)
  }

  useEffect(() => { void load() }, [])

  const addProduct = async () => {
    try {
      await neonFetch("/api/billing?action=product-create", {
        method: "POST",
        body: JSON.stringify({ name, price: Number(price), description: desc, currency }),
      })
      setName(""); setPrice(""); setDesc("")
      setMessage("Product created.")
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not create product.")
    }
  }

  const toggle = (id: string) => {
    setSelectedItems((items) =>
      items.some((item) => item.productId === id)
        ? items.filter((item) => item.productId !== id)
        : [...items, { productId: id, quantity: 1 }],
    )
  }

  const sendInvoice = async (id: string) => {
    try {
      await neonFetch("/api/billing?action=send", {
        method: "POST",
        body: JSON.stringify({ id }),
      })
      setMessage("Invoice emailed through Gmail.")
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not email invoice.")
    }
  }

  const addInvoice = async () => {
    try {
      const items = selectedItems.map((item) => {
        const product = products.find((p) => p.id === item.productId)
        if (!product) throw new Error("Selected product no longer exists.")
        return {
          productId: product.id,
          description: product.name,
          quantity: item.quantity,
          unitPrice: Number(product.price),
        }
      })
      const result = await neonFetch<{ id: string }>("/api/billing?action=invoice-create", {
        method: "POST",
        body: JSON.stringify({ customerName: customer, customerEmail: email, currency, items }),
      })
      await sendInvoice(result.id)
      setCustomer(""); setEmail(""); setSelectedItems([])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not create invoice.")
    }
  }

  const archive = async (id: string) => {
    await neonFetch("/api/billing?action=product-archive", {
      method: "POST",
      body: JSON.stringify({ id }),
    })
    await load()
  }

  const paid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0)
  const outstanding = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.total), 0)
  const drafts = invoices.filter((i) => i.status === "draft").length

  return (
    <section id="billing" className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[.03]">
      <div className="border-b border-white/10 p-5">
        <p className="text-xs uppercase tracking-[.18em] text-[#d4af37]">Revenue</p>
        <h2 className="mt-1 text-xl font-bold">Products & invoices</h2>
        <p className="mt-1 text-xs text-white/40">Create products, build invoices and track Paystack payment status.</p>
        {message && <p className="mt-3 text-xs text-[#d4af37]">{message}</p>}
      </div>

      <div className="grid gap-3 border-b border-white/10 p-5 md:grid-cols-[1fr_140px_1fr]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" placeholder="Price" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs" />
        <button onClick={() => void addProduct()} className="rounded-lg bg-[#d4af37] px-4 py-2 text-xs font-bold text-black">Add product</button>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Product description" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs md:col-span-2" />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
          <option>USD</option><option>NGN</option><option>GBP</option><option>EUR</option>
        </select>
      </div>

      <div className="border-b border-white/10 p-5">
        <p className="text-xs uppercase tracking-wider text-white/35">Build invoice</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Customer email" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs" />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {products.filter((p) => p.status === "active").map((p) => {
            const selected = selectedItems.find((item) => item.productId === p.id)
            return <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
              <button onClick={() => toggle(p.id)} className={"h-5 w-5 rounded border " + (selected ? "border-[#d4af37] bg-[#d4af37]" : "border-white/20")}>{selected ? "✓" : ""}</button>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{p.name}</p><p className="text-[10px] text-white/35">{p.currency} {Number(p.price).toFixed(2)}</p></div>
            </div>
          })}
        </div>
        <button onClick={() => void addInvoice()} disabled={!customer.trim() || !email.includes("@") || !selectedItems.length} className="mt-3 rounded-lg border border-[#d4af37]/30 px-4 py-2 text-xs text-[#d4af37] disabled:opacity-40">Create & email invoice</button>
      </div>

      <div className="grid grid-cols-3 gap-3 p-5">
        <div className="rounded-xl border border-white/10 p-4"><p className="text-[10px] text-white/35">PAID REVENUE</p><p className="mt-1 text-xl font-bold">{currency} {paid.toFixed(2)}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><p className="text-[10px] text-white/35">OUTSTANDING</p><p className="mt-1 text-xl font-bold">{currency} {outstanding.toFixed(2)}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><p className="text-[10px] text-white/35">DRAFTS</p><p className="mt-1 text-xl font-bold">{drafts}</p></div>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/35">Products</p>
          {products.map((p) => <div key={p.id} className="mb-2 flex items-center justify-between rounded-xl border border-white/10 p-3"><span className="text-sm">{p.name} · {p.currency} {Number(p.price).toFixed(2)}</span>{p.status === "active" && <button onClick={() => void archive(p.id)} className="text-xs text-white/35">Archive</button>}</div>)}
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/35">Invoices</p>
          {invoices.map((invoice) => <div key={invoice.id} className="mb-2 rounded-xl border border-white/10 p-3">
            <div className="flex justify-between text-sm"><span>{invoice.number}</span><span>{invoice.currency} {Number(invoice.total).toFixed(2)}</span></div>
            <p className="mt-1 text-xs text-white/35">{invoice.customerName} · {invoice.status}</p>
            {invoice.status === "draft" && <button onClick={() => void sendInvoice(invoice.id)} className="mr-2 mt-2 rounded border border-[#d4af37]/30 px-2 py-1 text-[10px] text-[#d4af37]">Email invoice</button>}
            {invoice.status !== "draft" && invoice.status !== "void" && <a href={"/invoice/" + invoice.id} className="mt-2 inline-block rounded border border-white/10 px-2 py-1 text-[10px]">View invoice</a>}
          </div>)}
        </div>
      </div>
    </section>
  )
}
