import { convexAuth } from "@convex-dev/auth/server"
import { Password } from "@convex-dev/auth/providers/Password"

const OWNER_EMAIL = "jabari.xai@gmail.com"

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => {
        const email = String(params.email ?? "").trim().toLowerCase()
        if (email !== OWNER_EMAIL) {
          throw new Error("This account is not authorized for the Jabari Tech Command Center.")
        }
        return { email }
      },
    }),
  ],
})
