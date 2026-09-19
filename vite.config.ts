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
  },
});
