import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
if (!convexUrl) throw new Error("missing envar VITE_CONVEX_URL")

const convex = new ConvexReactClient(convexUrl)

export default function AppConvexProvider({
  children,
}: {
  children: ReactNode
}) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
