import {
  CONTINUE_LIMIT,
  SHORT_WINDOW_LIMIT,
  SHORT_WINDOW_MINUTES,
} from "~/auth/rate-limit";
import { CONTINUE_PATH } from "~/auth/server";
import { PRACTICE_STATES } from "~/database/schema";
import { INVITE_PATH } from "~/practice/invite";

/**
 * The dev tool: dummy Practices, built through the screens a physician uses.
 *
 * It is a second tool and not a flag on the Seed Script, on purpose. The Seed
 * knows only Phases, Tasks and Helpful Links and literally cannot create a
 * Practice, a User or a Membership, which is what makes it safe to point at
 * production; this one creates all three, so it is kept apart and refuses to
 * run anywhere but development (`not-production.ts`).
 *
 * **Nothing here writes a row.** Every Practice, User and Membership it makes
 * comes out of the sign-in form, the Continue Screen, the invite box and the
 * acceptance screen, because a tool that inserted a Practice would hand a
 * developer a
 * Practice no registration ever produced — no Task Entries, no Membership,
 * no Wizard — and the bugs it hid would be exactly the ones on the paths
 * every physician takes. Going the long way round is the feature: a
 * development pass that wants somewhere to sign in re-exercises registration,
 * invites, the three-person cap and the Tailoring Wizard for free, and a
 * broken one stops this tool before it stops a physician.
 *
 * Which is why every step below checks what came back. A run that quietly
 * built two of three people, or sent no invitation, would be a smoke test
 * that cannot fail — so each step names what it expected and throws.
 */

/**
 * What the builder drives: a browser and the mailbox it can read.
 *
 * Two implementations and no third — the CLI's Vite-backed handler over a
 * development database, and the test harness. Both are the real request
 * handler; the interface exists because the mail sender differs, since in
 * development there is nowhere for a Sign-in Link to be delivered *to*.
 */
export interface DummySite {
  /** Dispatch a request through the real handler, carrying cookies. */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Drop the session. A Practice of three is three people in turn. */
  clearCookies(): void;
  /** Every link in the most recent message to an address. */
  linksTo(email: string): string[];
}

/** What to build. */
export interface DummyPlan {
  /** How many Practices. Each one is an Owner and two Members. */
  practices?: number;
  /**
   * What makes this run's addresses its own.
   *
   * Defaulted to a timestamp so that a second run builds new Practices
   * rather than signing the first run's Owners back in — registration asks
   * *where do you belong?*, and an address that already belongs somewhere
   * gets the Practice it already has. Pass a label to pin them.
   */
  label?: string;
}

/** A Practice this run built, and everyone it can be entered as. */
export interface DummyPractice {
  practiceName: string;
  owner: string;
  /** Two, both of whom took up an Invite on a Sign-in Link of their own. */
  members: string[];
  /** The address the cap turned away. Never a User, and never mailed. */
  refused: string;
  tailoring: "answered" | "skipped";
  /**
   * A Sign-in Link for the Owner that this run did *not* press.
   *
   * The reason the tool mints one: in development nothing delivers mail, so
   * an account a developer cannot sign in to is an account they cannot use.
   * It lives ten minutes and works once, like every other one.
   */
  signInLink: string;
}

/** A step that did not do what the product says it does. */
export class DummyPracticeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DummyPracticeError";
  }
}

/**
 * Where dummy addresses live.
 *
 * `.invalid` is reserved by RFC 2606 and can never be delivered to, which
 * is the belt to the refusal's braces: a run that somehow found a real mail
 * provider would still mail nobody at all.
 */
export const DUMMY_EMAIL_DOMAIN = "dummy.invalid";

const DEFAULT_PRACTICES = 2;

/**
 * Continue presses per Practice: the Owner registering, each Member taking
 * up their Invite, and the Owner signing back in to check the Practice holds.
 */
const CONTINUE_PRESSES_PER_PRACTICE = 4;

/**
 * How many Practices one run can build, which is the per-IP limit on the
 * Continue leg and not a number picked here.
 *
 * Everything in a run presses Continue from one address, so a big enough run
 * would trip the product's own rate limiting half way through and read as a
 * broken Continue Screen. Refusing up front says what it is instead: wait
 * ten minutes and run again.
 *
 * The product's other axis, the per-address one, is not a limit on the size
 * of a run at all — every Practice has its own Owner — but it is a limit on
 * repeating one, and `rateLimitedSignIn` below is where that is explained.
 */
export const MOST_PRACTICES_PER_RUN = Math.floor(
  CONTINUE_LIMIT / CONTINUE_PRESSES_PER_PRACTICE,
);

export async function buildDummyPractices(
  site: DummySite,
  plan: DummyPlan = {},
): Promise<DummyPractice[]> {
  const { practices = DEFAULT_PRACTICES, label = runLabel() } = plan;

  if (practices > MOST_PRACTICES_PER_RUN) {
    throw new DummyPracticeError(
      `${practices} Practices is more than one run can build: ${CONTINUE_PRESSES_PER_PRACTICE} ` +
        `Continue presses each would pass the limit of ${CONTINUE_LIMIT} from one address. ` +
        `Build ${MOST_PRACTICES_PER_RUN} at a time.`,
    );
  }

  const built: DummyPractice[] = [];
  for (let index = 1; index <= practices; index++) {
    built.push(await buildOne(site, label, index));
  }
  return built;
}

/**
 * One Practice, in the order it happens to a physician.
 *
 * The third invitation is sent while both real ones are still *pending*,
 * which is the half of the cap worth exercising: an Invite holds one of the
 * three places for as long as it stands, so acceptance can never breach a
 * cap that was checked when the offer was made.
 */
async function buildOne(
  site: DummySite,
  label: string,
  index: number,
): Promise<DummyPractice> {
  const practiceName = `Dummy Practice ${index} (${label})`;
  const ownerName = `Dr Dummy ${index}`;
  const owner = address(label, index, "owner");
  const members = [address(label, index, "spouse"), address(label, index, "manager")];
  const refused = address(label, index, "latecomer");

  // Consent is asked at registration as a ticked checkbox, and declining is
  // an unticked box that is simply absent from the submission. Alternating
  // means a run leaves both kinds of Owner behind.
  const emailConsent = index % 2 === 1;
  await register(site, owner, { emailConsent });

  // Both roads, alternately: answering writes a Practice Profile and sets
  // fourteen Tasks aside, skipping writes neither and settles the screen
  // just as finally.
  const tailoring = index % 2 === 1 ? "answered" : "skipped";
  await settleTailoring(site, tailoring, index);

  const inviting = { ownerName, practiceName };
  for (const member of members) {
    await sendInvite(site, member, inviting);
  }

  await expectTheCapToRefuse(site, refused, inviting);

  for (const [position, member] of members.entries()) {
    await acceptInvite(site, member, `Dummy Member ${index}.${position + 1}`);
  }

  await confirmThePracticeHolds(site, owner, members);

  // The Owner's third and last link request, which is exactly the short
  // window's allowance for one address — hence no fourth anywhere in here.
  const signInLink = await mintSignInLink(site, owner);

  return { practiceName, owner, members, refused, tailoring, signInLink };
}

/**
 * Registration: the sign-in form, the email, the Continue press.
 *
 * The first time an address does this it becomes a Practice with a Task
 * Entry for every Task; there is no other act in the product that does that,
 * which is the whole reason this tool exists.
 */
async function register(
  site: DummySite,
  email: string,
  { emailConsent }: { emailConsent: boolean },
): Promise<void> {
  site.clearCookies();

  await post(site, "/sign-in", {
    email,
    ...(emailConsent ? { emailConsent: "on" } : {}),
  });

  await pressContinue(site, email);
}

/** Follow the Sign-in Link that was mailed, as a physician does. */
async function pressContinue(site: DummySite, email: string): Promise<void> {
  const token = tokenIn(site, email, CONTINUE_PATH, "a Sign-in Link");

  await post(site, CONTINUE_PATH, { token });

  const list = await site.fetch("/tasks");
  if (signedOut(list)) {
    throw new DummyPracticeError(
      `${email} pressed Continue and is still signed out: the Sign-in Link minted no session.`,
    );
  }
}

/** The Tailoring Wizard, answered or skipped — and gone either way. */
async function settleTailoring(
  site: DummySite,
  tailoring: "answered" | "skipped",
  index: number,
): Promise<void> {
  const answers: Record<string, string> =
    tailoring === "skipped"
      ? { intent: "skip" }
      : {
          // A different state each time, so a run leaves a spread behind for
          // the `Varies by state` pointer and for segmenting email.
          state: PRACTICE_STATES[index % PRACTICE_STATES.length]!,
          fixedLocation: index % 4 === 1 ? "yes" : "no",
          expectsEmployees: index % 4 === 1 ? "no" : "yes",
        };

  await post(site, "/welcome", answers);

  // Settled means the screen is no longer owed, and the only observable
  // shape of that is /welcome handing the reader on to their list.
  const again = await site.fetch("/welcome");
  if (!redirectsTo(again, "/tasks")) {
    throw new DummyPracticeError(
      `The Tailoring Wizard was ${tailoring} and is still owed: /welcome answered ${again.status}.`,
    );
  }
}

/**
 * What an Owner is inviting someone as: their own name and their clinic's.
 *
 * Asked for at the moment they first invite somebody, because an invitation
 * has to come from a person and a clinic, and registration asked for neither.
 */
interface Inviting {
  ownerName: string;
  practiceName: string;
}

/**
 * One press of the Owner's invite box, handed back as the page it produced.
 *
 * Both readings of that page are worth having — *Invitation sent.* and the
 * cap's refusal are the same press seen from two sides — so the press lives
 * here once and the two callers below say what they expected of it.
 */
async function pressInvite(
  site: DummySite,
  email: string,
  { ownerName, practiceName }: Inviting,
): Promise<string> {
  return readable(
    await post(site, "/settings", {
      intent: "invite",
      email,
      yourName: ownerName,
      practiceName,
    }),
  );
}

/** An invitation offered, and holding one of the three places until it is taken up. */
async function sendInvite(
  site: DummySite,
  email: string,
  inviting: Inviting,
): Promise<void> {
  const page = await pressInvite(site, email, inviting);

  if (!page.includes("Invitation sent.")) {
    throw new DummyPracticeError(
      `The invite box refused ${email}: the settings page did not say the invitation was sent.`,
    );
  }

  // The offer is on the page as a pending Invite, which is the half of the
  // cap a refusal alone would not show: a place held by nobody yet.
  if (!page.includes(email)) {
    throw new DummyPracticeError(
      `${email} was invited and is not listed as invited: the Invite holds no place.`,
    );
  }
}

/**
 * The third person past the Owner, refused.
 *
 * Asserted rather than avoided: the cap is a rule about what the product
 * will not do, and a tool that never asks would not notice it going away.
 */
async function expectTheCapToRefuse(
  site: DummySite,
  refused: string,
  inviting: Inviting,
): Promise<void> {
  const page = await pressInvite(site, refused, inviting);

  if (!page.includes("This practice is full")) {
    throw new DummyPracticeError(
      `The three-person cap let a fourth person in: ${refused} was invited to a full Practice.`,
    );
  }

  if (site.linksTo(refused).length > 0) {
    throw new DummyPracticeError(
      `The cap refused ${refused} and mailed them anyway.`,
    );
  }
}

/**
 * Taking up an invitation: open the link, type a name, then follow the
 * Sign-in Link that arrives.
 *
 * The invite link carries no authority at all — the Membership is written on
 * the Continue press, against the address the Invite was sent to — so this
 * is two emails and not one, and it has to be.
 */
async function acceptInvite(
  site: DummySite,
  email: string,
  name: string,
): Promise<void> {
  site.clearCookies();

  const token = tokenIn(site, email, INVITE_PATH, "an invitation");

  const screen = await readable(await site.fetch(`${INVITE_PATH}?token=${token}`));
  if (!screen.includes(email)) {
    throw new DummyPracticeError(
      `The invitation for ${email} would not open: the acceptance screen does not name them.`,
    );
  }

  await post(site, INVITE_PATH, { token, name });
  await pressContinue(site, email);
}

/** Back in as the Owner, who can now see the two people who joined. */
async function confirmThePracticeHolds(
  site: DummySite,
  owner: string,
  members: string[],
): Promise<void> {
  site.clearCookies();
  await post(site, "/sign-in", { email: owner });
  await pressContinue(site, owner);

  const settings = await readable(await site.fetch("/settings"));
  for (const member of members) {
    if (!settings.includes(member)) {
      throw new DummyPracticeError(
        `${member} accepted an invitation but is not in the Practice: the Owner's settings page does not list them.`,
      );
    }
  }
}

/**
 * One more Sign-in Link for the Owner, left unpressed for a developer.
 *
 * Requested rather than kept from earlier because a Sign-in Link is used up
 * by the Continue press, and every one this run followed is spent.
 */
async function mintSignInLink(site: DummySite, owner: string): Promise<string> {
  site.clearCookies();
  await post(site, "/sign-in", { email: owner });

  return linkIn(site, owner, CONTINUE_PATH, "a Sign-in Link");
}

/** A run's addresses: readable, undeliverable, and its own. */
function address(label: string, index: number, who: string): string {
  return `${who}-${index}-${label}@${DUMMY_EMAIL_DOMAIN}`;
}

/** Short, sortable, and the same for every Practice in one run. */
function runLabel(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(2, 14);
}

/**
 * The most recent link to an address, by what it opens.
 *
 * By path rather than by position, because an invitee is mailed twice and
 * the two links do different things: taking the wrong one would open the
 * acceptance screen with a sign-in token and read as a broken invitation.
 */
function linkIn(
  site: DummySite,
  email: string,
  path: string,
  what: string,
): string {
  const link = site
    .linksTo(email)
    .find((candidate) => new URL(candidate).pathname === path);

  if (!link) {
    throw new DummyPracticeError(
      path === CONTINUE_PATH
        ? rateLimitedSignIn(email)
        : `${what} was never mailed to ${email}.`,
    );
  }
  return link;
}

/** The token out of that link. */
function tokenIn(
  site: DummySite,
  email: string,
  path: string,
  what: string,
): string {
  const token = new URL(linkIn(site, email, path, what)).searchParams.get(
    "token",
  );

  if (!token) {
    throw new DummyPracticeError(`${what} mailed to ${email} carries no token.`);
  }
  return token;
}

/**
 * A Sign-in Link that was asked for and never arrived, said in full.
 *
 * An Owner asks for exactly `SHORT_WINDOW_LIMIT` of them per run —
 * registering, signing back in to check the Practice holds, and the unpressed
 * one at the end — which is the whole of the short window's allowance for one
 * address. So the likeliest cause by a distance is a second run as the same
 * Owner, and the only way to be the same Owner twice is to pin `--label`.
 * Unexplained, this reads as a Sign-in Link that stopped working, which is
 * the one thing in this product that must never be guessed at.
 */
function rateLimitedSignIn(email: string): string {
  return (
    `No Sign-in Link was mailed to ${email}. One address may ask for ` +
    `${SHORT_WINDOW_LIMIT} in ${SHORT_WINDOW_MINUTES} minutes and a run asks for all ` +
    `${SHORT_WINDOW_LIMIT}, so a second run as the same Owner has none left. ` +
    `Run without --label, or wait ${SHORT_WINDOW_MINUTES} minutes.`
  );
}

function post(
  site: DummySite,
  path: string,
  fields: Record<string, string>,
): Promise<Response> {
  return site.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

function redirectsTo(response: Response, path: string): boolean {
  return (
    response.status >= 300 &&
    response.status < 400 &&
    (response.headers.get("Location") ?? "").startsWith(path)
  );
}

function signedOut(response: Response): boolean {
  return redirectsTo(response, "/sign-in");
}
