// Convex Auth trusts the deployed Convex site origin configured in .env.local.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
}
