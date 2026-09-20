/**
 * The dev tool that builds dummy Practices, as a command.
 *
 * A thin wrapper around `runDummyPractices(...)` — the screens it presses,
 * the cap it expects to be refused by, the links it follows and the refusal
 * to run against production all live in `app/dev/`, where a test drives them
 * through the same request handler without a shell.
 *
 *   npm run dev:practices
 *   npm run dev:practices -- --practices 3 --label demo
 *   npm run dev:practices -- --database ./data/scratch.sqlite
 *
 * The second tool, and never a flag on the Seed Script: the Seed cannot
 * create a Practice, a User or a Membership, which is the whole reason it is
 * safe to point at production. This one creates all three through the real
 * registration and invite paths, so it refuses to run anywhere that looks
 * like production before it opens anything.
 *
 * It runs the real routes through a Vite server rather than over HTTP,
 * because there is nothing to talk to: no Sign-in Link can be delivered in
 * development, so the run has to hold the mailbox it reads its own links out
 * of. What the routes see is the same handler either way.
 *
 * **Everything app-side is loaded through that Vite server.** The routes find
 * their database through a module-level context, so a module imported into
 * this process as well as into the server build would be two modules with two
 * contexts, and the injected mailbox would never be read — the run would
 * quietly drive the *production* services instead.
 */
import type { ServerBuild } from "react-router";
import { createServer } from "vite";

type DummyPracticesModule = typeof import("../app/dev/run-dummy-practices");
type Built = Awaited<ReturnType<DummyPracticesModule["runDummyPractices"]>>;

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  await main();
} finally {
  await vite.close();
}

async function main(): Promise<void> {
  const { databasePath } = (await load("/app/database/database-path.ts")) as
    typeof import("../app/database/database-path");
  const { runDummyPractices } = (await load(
    "/app/dev/run-dummy-practices.ts",
  )) as DummyPracticesModule;
  const { DummyPracticeError } = (await load("/app/dev/dummy-practices.ts")) as
    typeof import("../app/dev/dummy-practices");
  const { NotDevelopmentError } = (await load("/app/dev/not-production.ts")) as
    typeof import("../app/dev/not-production");

  const practices = flag("--practices");
  const databaseFile = flag("--database") ?? databasePath();

  try {
    report(
      databaseFile,
      await runDummyPractices({
        build: (await load("virtual:react-router/server-build")) as ServerBuild,
        databaseFile,
        practices: practices === undefined ? undefined : Number(practices),
        label: flag("--label"),
        log: (line) => console.log(line),
      }),
    );
  } catch (error) {
    // Neither of these is a crash. One is the tool refusing to run where it
    // must not, and the other is a step of the real flow not doing what the
    // product says it does — which is this tool earning its place. Both are
    // worth a line rather than a stack trace.
    if (
      !(error instanceof NotDevelopmentError) &&
      !(error instanceof DummyPracticeError)
    ) {
      throw error;
    }

    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}

/** Everything app-side comes through here, and nothing comes around it. */
function load(specifier: string): Promise<unknown> {
  return vite.ssrLoadModule(specifier);
}

function report(databaseFile: string, built: Built): void {
  const many = built.length === 1 ? "Practice" : "Practices";
  console.log(`\nBuilt ${built.length} dummy ${many} in ${databaseFile}:\n`);

  for (const practice of built) {
    console.log(`  ${practice.practiceName}`);
    console.log(`    Owner            ${practice.owner}`);
    for (const member of practice.members) {
      console.log(`    Member           ${member}`);
    }
    console.log(`    Refused by cap   ${practice.refused}`);
    console.log(`    Tailoring Wizard ${practice.tailoring}`);
    console.log(`    Sign in          ${practice.signInLink}`);
    console.log("");
  }

  console.log(
    "Each Sign-in Link is unpressed, lives ten minutes and works once.\n" +
      "Start the app with `npm run dev` and open one.",
  );
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
