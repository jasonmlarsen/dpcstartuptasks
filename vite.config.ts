import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    // Pinned, and not left at Vite's 5173. `APP_URL` defaults to
    // `http://localhost:3000` and `react-router-serve` answers there in
    // production, so the port is not a preference — a Sign-in Link is minted
    // against `APP_URL` and the Continue `POST` is refused unless the browser's
    // `Origin` matches it. A dev server on any other port mails links to a door
    // that is not open, and opening them by hand meets *That did not come from
    // here*. `strictPort` so a port already in use fails loudly instead of
    // drifting to 3001 and reintroducing the same mismatch.
    port: 3000,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Node, not jsdom: seam 1 dispatches a `Request` at the server and reads
    // the `Response`. There is no browser in any of these tests, because there
    // is no client JS on any path worth testing.
    environment: "node",
    include: ["test/**/*.test.ts", "app/**/*.test.ts"],
    server: {
      deps: {
        // Better Auth pulls in `@opentelemetry/semantic-conventions`, whose
        // published ESM build uses directory imports that Node's own resolver
        // rejects. Letting Vite process it instead of externalising it is the
        // whole fix; nothing else here needs inlining.
        inline: [/better-auth/],
      },
    },
  },
});
