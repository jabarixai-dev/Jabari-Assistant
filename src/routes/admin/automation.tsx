import { createFileRoute } from "@tanstack/react-router"
import { WorkflowBuilder } from "../../components/workflow-builder"
import { TaskBoard } from "../../components/task-board"
import { AgentActionCenter } from "../../components/agent-action-center"
import { AgentControls } from "../../components/agent-controls"
export const Route = createFileRoute("/admin/automation")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Automation</h1><p className="mt-1 text-sm text-white/45">Workflows, tasks and AI actions in one workspace.</p></div><AgentControls /><AgentActionCenter /><WorkflowBuilder /><TaskBoard /></div> })
