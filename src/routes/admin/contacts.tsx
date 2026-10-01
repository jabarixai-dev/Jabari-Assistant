import { createFileRoute } from "@tanstack/react-router"
import { ContactsCrm } from "../../components/contacts-crm"
export const Route = createFileRoute("/admin/contacts")({ component: () => <Page title="Contacts" text="Manage people, notes and CRM activity."/> })
function Page({title,text}:{title:string;text:string}) { return <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">{title}</h1><p className="mt-1 text-sm text-white/45">{text}</p></div><ContactsCrm /></div> }
