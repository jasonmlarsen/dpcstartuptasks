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

  // The Tailoring Wizard, which sits in front of the journey map exactly
  // once per Practice. A path rather than a query on `/tasks`, so that being
  // owed it is a redirect a test and a browser can both see.
  route("welcome", "routes/welcome.tsx"),

  // The journey map. The Phase in view is the URL, and so is the Task whose
  // drawer is open, so nothing about where a physician is reading lives in a
  // cookie or in a column.
  route("tasks", "routes/tasks.tsx"),
  route("tasks/:phaseSlug", "routes/phase.tsx"),

  // The invitation, which is a door of its own and not the door: it signs
  // nobody in, it asks for a name, and its one button emails a Sign-in Link
  // to the address the Invite was sent to.
  route("invite", "routes/invite.tsx"),

  // Settings, which so far is the People section: who is in a Practice, and
  // the three acts that change it.
  route("settings", "routes/settings.tsx"),

  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
] satisfies RouteConfig;
