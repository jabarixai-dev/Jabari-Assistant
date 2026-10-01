import { useState,type FormEvent } from "react"
import type { UIMessage } from "ai"
import { useMutation } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { useAnonymousThreads } from "../lib/use-anonymous-threads"
import { useDurableChat } from "../lib/use-durable-chat"

export function NoAuthChatShell(){
 const {activeThreadId,capability,createThread,isCreating,selectThread,threads}=useAnonymousThreads()
 const removeThread=useMutation(api.agentChat.deleteThread)
 const [startError,setStartError]=useState<string|null>(null)
 const [deletingId,setDeletingId]=useState<string|null>(null)
 const start=async()=>{setStartError(null);try{await createThread()}catch(error){setStartError(error instanceof Error?error.message:"Could not start chat")}}
 const remove=async(id:string)=>{if(!capability||deletingId)return;setDeletingId(id);try{await removeThread({capability,threadId:id})}catch(error){setStartError(error instanceof Error?error.message:"Could not delete conversation")}finally{setDeletingId(null)}}
 if(!capability||!activeThreadId)return <main data-testid="chat-start-state" data-state={startError?"error":isCreating?"loading":"ready"} className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground"><h1 className="text-3xl font-semibold tracking-tight">Jabari Assistant</h1><p className="max-w-sm text-center text-sm text-muted-foreground">Talk to Jabari Tech about websites, content, AI workflows, or a project you want to build.</p><button type="button" data-testid="chat-start" disabled={isCreating} onClick={()=>void start()} className="rounded-full bg-zinc-100 px-6 py-2.5 font-medium text-zinc-900 transition hover:bg-gold disabled:opacity-50">{isCreating?"Starting…":"Start a private conversation"}</button>{startError&&<p role="alert" className="text-sm text-red-400">{startError}</p>}</main>
 return <main data-testid="chat-root" className="flex h-screen bg-background text-foreground">
  <nav data-testid="chat-threads" className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3">
   <button type="button" onClick={()=>void start()} disabled={isCreating} className="mb-2 rounded-lg border border-border px-3 py-2 text-left text-sm font-medium transition hover:bg-card disabled:opacity-50">+ New chat</button>
   {(threads??[]).map(thread=><div key={thread._id} className="group flex items-center gap-1"><button type="button" data-testid="chat-thread-item" data-active={thread._id===activeThreadId||undefined} onClick={()=>selectThread(thread._id)} className={"min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition hover:bg-card "+(thread._id===activeThreadId?"bg-card text-zinc-100":"text-muted-foreground")}>{thread.title}</button><button type="button" aria-label={"Delete "+thread.title} disabled={deletingId===thread._id} onClick={()=>void remove(thread._id)} className="rounded-md px-2 py-1 text-xs text-red-400 opacity-60 transition hover:bg-red-500/10 hover:opacity-100 disabled:opacity-30">Delete</button></div>)}
  </nav>
  <ChatPanel key={activeThreadId} capability={capability} threadId={activeThreadId as Id<"chatThreads">}/>
 </main>
}

function ChatPanel({capability,threadId}:{capability:string;threadId:Id<"chatThreads">}){
 const {error,isBusy,messages,sendMessage}=useDurableChat({capability,threadId})
 const [draft,setDraft]=useState("")
 const send=async(event:FormEvent)=>{event.preventDefault();const text=draft.trim();if(!text||isBusy)return;setDraft("");try{await sendMessage({text})}catch{setDraft(current=>current||text)}}
 return <section className="flex min-w-0 flex-1 flex-col">
  <div data-testid="chat-status" data-state={error?"error":isBusy?"loading":"ready"} aria-busy={isBusy} className="border-b border-border px-6 py-3 text-xs text-zinc-500">{error?error.message:isBusy?"Thinking…":"Ready"}</div>
  <div data-testid="chat-messages" className="flex-1 space-y-4 overflow-y-auto px-6 py-6">{(messages as UIMessage[]).map(message=><article key={message.id} data-testid="chat-message" data-role={message.role} className={"max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed "+(message.role==="user"?"ml-auto bg-gold text-black":"mr-auto bg-card text-zinc-100")}>{message.parts.map((part,index)=><MessagePart key={message.id+"-"+index} part={part}/>)}</article>)}</div>
  <form data-testid="chat-composer" onSubmit={event=>void send(event)} className="flex items-end gap-2 border-t border-border px-6 py-4"><textarea data-testid="chat-input" value={draft} disabled={isBusy} rows={1} placeholder="Tell Jabari what you need…" onChange={event=>setDraft(event.target.value)} className="max-h-40 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-500 disabled:opacity-50"/><button type="submit" data-testid="chat-send" disabled={isBusy||!draft.trim()} className="rounded-xl bg-zinc-100 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:bg-gold disabled:opacity-40">Send</button></form>
 </section>
}
function MessagePart({part}:{part:UIMessage["parts"][number]}){
 if(part.type==="text")return <p className="whitespace-pre-wrap">{part.text}</p>
 if(!part.type.startsWith("tool-"))return null
 const toolPart=part as typeof part&{state?:string;output?:unknown;errorText?:string},toolName=part.type.slice(5),output=(toolPart.output??{}) as {imageUrl?:string;citations?:string[]}
 return <div data-testid="chat-tool" data-tool={toolName} data-state={toolPart.state??"pending"} className="my-2 text-xs text-muted-foreground">{toolPart.errorText?<span className="text-red-400">{toolPart.errorText}</span>:toolName==="generateImage"?(output.imageUrl?<img src={output.imageUrl} alt="Generated image" className="mt-1 max-w-sm rounded-xl"/>:<span>Generating image…</span>):toolName==="internetSearch"?<span>{toolPart.state==="output-available"?`Searched the web (${output.citations?.length??0} sources)`:"Searching the web…"}</span>:<pre className="overflow-x-auto">{JSON.stringify(toolPart.output??null,null,2)}</pre>}</div>
}
