import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { MacalyBridge } from '@macaly/bridge'
import AppConvexProvider from '../components/convex-client-provider'
import '../styles.css'
import siteMetadata from '../metadata.json'

const rootMeta = siteMetadata['/']

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: rootMeta.title },
      { name: 'description', content: rootMeta.description },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <MacalyBridge>
        <AppConvexProvider>
          <body>
            {children}
            <Scripts />
          </body>
        </AppConvexProvider>
      </MacalyBridge>
    </html>
  )
}
