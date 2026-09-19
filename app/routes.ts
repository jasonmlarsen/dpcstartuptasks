import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),

  // The only door into the product, and the whole of it: ask for a Sign-in
  // Link, be told to check your email, press Continue. Every one of these is a
  // plain form at zero client JS.
  route("sign-in", "routes/sign-in.tsx"),
  route("check-your-email", "routes/check-your-email.tsx"),
  route("continue", "routes/continue.tsx"),

  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
] satisfies RouteConfig;
