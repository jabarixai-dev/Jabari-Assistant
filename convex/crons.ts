import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "sync Gmail outreach",
  { minutes: 15 },
  internal.outreach.syncGmailOutreachInternal,
  {},
)

export default crons
