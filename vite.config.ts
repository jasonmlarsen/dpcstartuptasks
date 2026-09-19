import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
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
