import { isAbsolute, relative, resolve } from "node:path";

/**
 * The guard on the dev tool: three signs of production, and any one refuses.
 *
 * The Seed Script is safe to point at production because it *cannot* create a
 * Practice, a User or a Membership. This tool is the other one — it creates
 * all three, through the same screens a physician uses — so the thing that
 * keeps it away from real data cannot be a capability it lacks. It has to be
 * a refusal, and a refusal is only worth anything if it is checked before
 * anything is opened.
 *
 * So the signs are read off the environment and the file path, not off a flag
 * somebody has to remember to pass: an operator on the VPS typing this by
 * mistake has `NODE_ENV`, `APP_URL` and `/data` all saying where they are,
 * and any one of the three is enough.
 */

export interface DevelopmentCheck {
  environment: NodeJS.ProcessEnv;
  /** The SQLite file the run would open, as it was typed or defaulted. */
  databaseFile: string;
  /** The checkout the run was started from. */
  workingDirectory?: string;
}

/**
 * Every sign of production visible from here, in the operator's words.
 *
 * All of them rather than the first, because a refusal that names one sign
 * invites a second run with that one sign removed, which is exactly the run
 * that must not happen.
 */
export function productionSigns({
  environment,
  databaseFile,
  workingDirectory = process.cwd(),
}: DevelopmentCheck): string[] {
  const signs: string[] = [];

  if (environment.NODE_ENV === "production") {
    signs.push("NODE_ENV is production");
  }

  const appUrl = environment.APP_URL;
  if (appUrl !== undefined && !isLoopback(appUrl)) {
    signs.push(
      `APP_URL is ${appUrl}, which is not this machine — a deployed app answers there`,
    );
  }

  // In development all of the auth environment has defaults and nothing needs
  // setting; in production the app refuses to start without this one. So a
  // real secret in the environment is somebody standing in production, and a
  // developer who has one set can unset it for the length of a run.
  if (environment.AUTH_SECRET !== undefined) {
    signs.push("AUTH_SECRET is set: development does not need one");
  }

  // The container puts the real file on a volume at `/data`, and a restored
  // cold copy is opened from wherever it was unpacked. Neither is inside the
  // checkout, and nothing in development is outside it.
  const file = resolve(workingDirectory, databaseFile);
  const within = relative(resolve(workingDirectory), file);
  if (within.startsWith("..") || isAbsolute(within)) {
    signs.push(`${databaseFile} is outside this checkout`);
  }

  return signs;
}

/** A refusal, which is the tool doing its job rather than failing at it. */
export class NotDevelopmentError extends Error {
  constructor(signs: string[]) {
    super(
      "This tool builds dummy Practices, Users and Memberships, so it only " +
        "ever runs against a development database:\n- " +
        signs.join("\n- "),
    );
    this.name = "NotDevelopmentError";
  }
}

/**
 * Throw unless this is development.
 *
 * Throwing rather than returning the signs, so that a caller who forgot to
 * look at them still does not get a run.
 */
export function assertDevelopment(check: DevelopmentCheck): void {
  const signs = productionSigns(check);
  if (signs.length > 0) throw new NotDevelopmentError(signs);
}

/** Loopback, in the spellings a development `APP_URL` actually has. */
function isLoopback(appUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(appUrl).hostname;
  } catch {
    // Unreadable is not development: a value nothing can parse is a value
    // nothing here should be guessing about.
    return false;
  }

  // `0.0.0.0` is deliberately not here: it is an address to bind to rather
  // than one to answer at, so an app reached there is not obviously this
  // machine and the benefit of the doubt belongs to the refusal.
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}
