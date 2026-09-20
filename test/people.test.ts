import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { invite, membership, taskEntry, user } from "~/database/schema";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on who is in a Practice.
 *
 * Everything here goes through the screens: the Owner's invite box, the
 * acceptance screen, the Withdraw and Remove buttons, and the Continue press
 * that turns an offer into a Membership. Nothing writes a Membership
 * directly, because the whole of this ticket is *which act creates one* —
 * and a test that inserted the row would be testing nothing. The single
 * exception is the *practice full* refusal, which drives the rows to a state
 * the cap makes unreachable, and says so where it does it.
 *
 * **ADR-0004's second mandatory test lives here**: remove a Member, and
 * assert their next request is unauthenticated. It is what makes a Better
 * Auth bump that changes revocation fail in CI rather than leave an Owner
 * believing they removed somebody who is still reading.
 */

const OWNER = "dr.reed@example.com";
const SPOUSE = "jamie.reed@example.com";
const MANAGER = "pat.okafor@example.com";
const STRANGER = "someone.else@example.com";

const OWNER_NAME = "Dr Alex Reed";
const PRACTICE_NAME = "Reed Direct Care";

const FOUNDATION = "/tasks/foundation-planning";
const EIN = "obtain-ein-employer-identification-number";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

/**
 * A page with the two things that differ between two runs taken out: the
 * generated User id, and the expiry a timestamp puts in the payload. What is
 * left is everything the page could ever say about the address that was
 * typed into the invite box, which is the thing under test.
 */
function normalised(app: TestApp, html: string): string {
  return html
    .replaceAll(userIdOf(app, OWNER), "<owner-id>")
    .replaceAll(/\["D",\d+\]/g, '["D",<when>]');
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/** The Owner's invite box, filling in the two names it asks for the first time. */
async function sendInvite(
  app: TestApp,
  email: string,
  named: { yourName?: string; practiceName?: string } = {},
): Promise<Response> {
  return app.fetch(
    "/settings",
    post({
      intent: "invite",
      email,
      yourName: named.yourName ?? OWNER_NAME,
      practiceName: named.practiceName ?? PRACTICE_NAME,
    }),
  );
}

/** The token out of the most recent email to an address. */
function tokenIn(app: TestApp, email: string): string {
  const link = app.emailSender.linksTo(email).at(-1);
  if (!link) throw new Error(`Nothing was mailed to ${email}`);
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`The link mailed to ${email} carries no token`);
  return token;
}

/**
 * Take up an invitation exactly as the invitee does: open the link, press
 * the one button, then follow the Sign-in Link that arrives.
 */
async function acceptInvite(
  app: TestApp,
  email: string,
  name: string,
): Promise<Response> {
  const inviteToken = tokenIn(app, email);

  await app.fetch(`/invite?token=${inviteToken}`);
  await app.fetch("/invite", post({ token: inviteToken, name }));

  return app.fetch("/continue", post({ token: tokenIn(app, email) }));
}

/** Sign in an Owner and put a Member alongside them. */
async function practiceOfTwo(app: TestApp): Promise<void> {
  await signInAs(app, OWNER);
  await sendInvite(app, SPOUSE);
  app.clearCookies();
  await acceptInvite(app, SPOUSE, "Jamie Reed");
}

function membershipsOf(app: TestApp, email: string) {
  return app.database
    .select({ practiceId: membership.practiceId, role: membership.role })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, email))
    .all();
}

function userIdOf(app: TestApp, email: string): string {
  const row = app.database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (!row) throw new Error(`No User for ${email}`);
  return row.id;
}

async function signInAsOwnerAgain(app: TestApp): Promise<void> {
  app.clearCookies();
  await signInAs(app, OWNER);
}

describe("an Owner inviting someone", () => {
  it("mails the invitation and holds a place for it", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    await sendInvite(app, SPOUSE);

    const sent = app.emailSender.lastTo(SPOUSE);
    expect(sent?.subject).toContain(OWNER_NAME);
    expect(sent?.subject).toContain(PRACTICE_NAME);
    expect(app.emailSender.linksTo(SPOUSE).at(-1)).toContain("/invite?token=");

    const rows = app.database.select().from(invite).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(SPOUSE);
    expect(rows[0].acceptedAt).toBeNull();
    // The token is never stored in the clear, so a copy of the database is
    // not a drawer full of working invitations.
    expect(rows[0].tokenDigest).not.toContain(tokenIn(app, SPOUSE));

    const settings = await readable(await app.fetch("/settings"));
    expect(settings).toContain(SPOUSE);
    expect(settings).toContain("Invited");
  });

  it("answers identically for an address the product knows and one it does not", async () => {
    // The same address invited by the same Owner in two worlds: one where a
    // physician has been using the product for a while, and one where
    // nobody has ever heard of them. The Owner must not be able to tell the
    // two pages apart, and here they cannot be told apart at all.
    const known = newApp();
    await signInAs(known, SPOUSE);
    known.clearCookies();

    const unknown = newApp();

    const pages = await Promise.all(
      [known, unknown].map(async (app) => {
        await signInAs(app, OWNER);
        return normalised(app, await readable(await sendInvite(app, SPOUSE)));
      }),
    );

    expect(pages[0]).toContain("Invitation sent.");
    expect(pages[0]).toBe(pages[1]);
  });

  it("asks for the Owner's name and the practice's name the first time", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const box = await readable(await app.fetch("/settings"));
    expect(box).toContain('name="yourName"');
    expect(box).toContain('name="practiceName"');

    const refused = await readable(
      await sendInvite(app, SPOUSE, { yourName: "", practiceName: "" }),
    );
    expect(refused).toContain("Please fill in");
    expect(app.database.select().from(invite).all()).toHaveLength(0);

    await sendInvite(app, SPOUSE);

    // Kept, so the second invitation never asks again — and so the email
    // reads as being from a person and a clinic.
    const again = await readable(await app.fetch("/settings"));
    expect(again).not.toContain('name="yourName"');
    expect(again).toContain(PRACTICE_NAME);
    expect(again).toContain(OWNER_NAME);
  });

  it("refuses an address it cannot read, and says nothing about who holds one", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const refused = await readable(await sendInvite(app, "not an address"));

    expect(refused).toContain("does not look like an email address");
    expect(app.database.select().from(invite).all()).toHaveLength(0);
  });
});

describe("the three-person cap", () => {
  it("counts a pending Invite, so acceptance can never make a fourth", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    await sendInvite(app, SPOUSE);
    await sendInvite(app, MANAGER);

    // The Owner and two outstanding offers is three people.
    const full = await readable(await sendInvite(app, STRANGER));
    expect(full).toContain("This practice is full");
    expect(app.database.select().from(invite).all()).toHaveLength(2);
    expect(app.emailSender.lastTo(STRANGER)).toBeUndefined();

    app.clearCookies();
    await acceptInvite(app, SPOUSE, "Jamie Reed");
    app.clearCookies();
    await acceptInvite(app, MANAGER, "Pat Okafor");

    const practiceId = membershipsOf(app, OWNER)[0].practiceId;
    const inside = app.database
      .select()
      .from(membership)
      .where(eq(membership.practiceId, practiceId))
      .all();
    expect(inside).toHaveLength(3);
  });

  it("frees the place again when the Owner withdraws the invitation", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    await sendInvite(app, MANAGER);

    const pending = app.database
      .select()
      .from(invite)
      .where(eq(invite.email, MANAGER))
      .get()!;
    await app.fetch(
      "/settings",
      post({ intent: "revoke-invite", inviteId: String(pending.id) }),
    );

    const settings = await readable(await app.fetch("/settings"));
    expect(settings).not.toContain("This practice is full");
    expect(settings).not.toContain(MANAGER);
  });
});

describe("the acceptance screen", () => {
  it("shows the invited address, asks a name, and grants no session", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    app.clearCookies();

    const token = tokenIn(app, SPOUSE);
    const opened = await app.fetch(`/invite?token=${token}`);
    const screen = await readable(opened);

    expect(screen).toContain(PRACTICE_NAME);
    expect(screen).toContain(SPOUSE);
    const address = screen.match(/<input[^>]*id="email"[^>]*>/)?.[0];
    expect(address).toContain("readOnly");
    expect(screen).toContain('name="name"');
    expect(screen).toContain("Email me a sign-in link");

    // The link carries no authority at all: opening it mints nothing, so a
    // forwarded invitation cannot hand away a place and a mail scanner
    // cannot burn one.
    expect(opened.headers.getSetCookie()).toEqual([]);
    expect(app.cookies.size).toBe(0);
    expect(app.database.select().from(membership).all()).toHaveLength(1);

    // Nor does pressing the button, which only sends mail.
    const pressed = await app.fetch("/invite", post({ token, name: "Jamie Reed" }));
    expect(pressed.headers.get("Location")).toBe("/check-your-email");
    expect(app.cookies.size).toBe(0);
    expect(app.database.select().from(membership).all()).toHaveLength(1);
    expect(app.emailSender.lastTo(SPOUSE)?.subject).toContain("sign-in link");
  });

  it("refuses a press that did not come from here", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    app.clearCookies();
    const token = tokenIn(app, SPOUSE);
    const body = new URLSearchParams({ token, name: "Jamie Reed" });

    // The button sends mail, so a form on somebody else's page must not be
    // able to reach it. React Router refuses a mismatched `Origin` itself,
    // before any action runs.
    const elsewhere = await app.fetch("/invite", {
      method: "post",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://not-this-app.example.com",
      },
      body,
    });
    expect(elsewhere.status).toBe(400);

    // A `POST` carrying no `Origin` at all is what that check does nothing
    // about, and what ours is for.
    const anonymous = await app.fetch(
      new Request("http://localhost:3000/invite", {
        method: "post",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
    expect(anonymous.status).toBe(403);

    expect(app.emailSender.linksTo(SPOUSE)).toHaveLength(1);
  });

  it("makes the Membership on the Sign-in Link, and keeps the name typed on it", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    const ownersPractice = membershipsOf(app, OWNER)[0].practiceId;
    await sendInvite(app, SPOUSE);
    app.clearCookies();

    const landed = await acceptInvite(app, SPOUSE, "Jamie Reed");

    expect(landed.headers.get("Location")).toBe("/tasks");
    expect(membershipsOf(app, SPOUSE)).toEqual([
      { practiceId: ownersPractice, role: "member" },
    ]);
    expect(
      app.database.select().from(user).where(eq(user.email, SPOUSE)).get()?.name,
    ).toBe("Jamie Reed");
  });
});

describe("what the invite link says when it will not work", () => {
  async function refusal(app: TestApp, token: string): Promise<string> {
    return readable(await app.fetch(`/invite?token=${token}`));
  }

  it("names used, revoked, expired and full, and stays generic for a token nobody was sent", async () => {
    const app = newApp();

    // Used.
    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    const spouseToken = tokenIn(app, SPOUSE);
    app.clearCookies();
    await acceptInvite(app, SPOUSE, "Jamie Reed");
    expect(await refusal(app, spouseToken)).toContain(
      "This invitation has been used",
    );

    // Revoked.
    await signInAsOwnerAgain(app);
    await sendInvite(app, MANAGER);
    const managerToken = tokenIn(app, MANAGER);
    const pending = app.database
      .select()
      .from(invite)
      .where(eq(invite.email, MANAGER))
      .get()!;
    await app.fetch(
      "/settings",
      post({ intent: "revoke-invite", inviteId: String(pending.id) }),
    );
    expect(await refusal(app, managerToken)).toContain(
      "This invitation was withdrawn",
    );

    // Expired: the one condition that is a clock rather than an act.
    await sendInvite(app, STRANGER);
    const strangerToken = tokenIn(app, STRANGER);
    app.database
      .update(invite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invite.email, STRANGER))
      .run();
    expect(await refusal(app, strangerToken)).toContain(
      "This invitation has expired",
    );

    // Unrecognised, and the only generic answer of the five. This asymmetry
    // against the byte-identical invite box is the deliberate one: whoever
    // holds a link was sent it, and a token nobody was sent has no story.
    const generic = await refusal(app, "a-token-nobody-was-ever-sent");
    expect(generic).toContain("This link does not work");
    expect(generic).not.toContain("expired");
    expect(generic).not.toContain("withdrawn");
  });

  it("says the practice is full when every place has been taken", async () => {
    const app = newApp();
    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    const spouseToken = tokenIn(app, SPOUSE);

    // The cap makes this state unreachable through the product — a pending
    // Invite holds one of the three places for as long as it stands, which
    // is exactly the invariant the test above pins. This drives the rows to
    // it anyway, because the guard behind the invariant has to be the one
    // that speaks if the invariant ever breaks.
    const practiceId = membershipsOf(app, OWNER)[0].practiceId;
    app.clearCookies();
    await signInAs(app, MANAGER);
    await signInAs(app, STRANGER);
    for (const email of [MANAGER, STRANGER]) {
      app.database
        .update(membership)
        .set({ practiceId, role: "member" })
        .where(eq(membership.userId, userIdOf(app, email)))
        .run();
    }

    expect(await refusal(app, spouseToken)).toContain("That practice is full");
  });
});

describe("a physician who signed up alone and is then invited", () => {
  it("has their own empty Practice abandoned on acceptance", async () => {
    const app = newApp();

    // They registered first, and did nothing with the list they were given.
    await signInAs(app, SPOUSE);
    const theirOwn = membershipsOf(app, SPOUSE)[0].practiceId;
    app.clearCookies();

    await signInAs(app, OWNER);
    const ownersPractice = membershipsOf(app, OWNER)[0].practiceId;
    await sendInvite(app, SPOUSE);
    app.clearCookies();

    await acceptInvite(app, SPOUSE, "Jamie Reed");

    expect(membershipsOf(app, SPOUSE)).toEqual([
      { practiceId: ownersPractice, role: "member" },
    ]);
    // Abandoned, along with the ninety-eight Entries nobody touched: one
    // Practice per User is a unique index, and without this the two of them
    // are stranded apart permanently.
    expect(
      app.database
        .select()
        .from(taskEntry)
        .where(eq(taskEntry.practiceId, theirOwn))
        .all(),
    ).toHaveLength(0);
  });

  it("keeps a Practice that has work in it, and the link says so", async () => {
    const app = newApp();

    await signInAs(app, SPOUSE);
    const theirOwn = membershipsOf(app, SPOUSE)[0].practiceId;
    await app.fetch(
      FOUNDATION,
      post({ taskRef: EIN, status: "in_progress" }),
    );
    app.clearCookies();

    await signInAs(app, OWNER);
    await sendInvite(app, SPOUSE);
    const token = tokenIn(app, SPOUSE);
    app.clearCookies();

    const screen = await readable(await app.fetch(`/invite?token=${token}`));
    expect(screen).toContain("You already have a practice of your own");

    // Nothing was destroyed and nothing was joined: deleting a list with
    // work in it is the physician's decision, never a side effect of
    // opening someone else's invitation.
    expect(membershipsOf(app, SPOUSE)).toEqual([
      { practiceId: theirOwn, role: "owner" },
    ]);
  });
});

describe("what a Member can do", () => {
  it("has full write access to the list", async () => {
    const app = newApp();
    await practiceOfTwo(app);

    const moved = await app.fetch(
      FOUNDATION,
      post({ taskRef: EIN, status: "done" }),
    );
    expect(moved.status).toBe(302);

    const noted = await app.fetch(
      FOUNDATION,
      post({ intent: "note", taskRef: EIN, note: "Filed it on Tuesday" }),
    );
    expect(noted.status).toBe(302);

    const added = await app.fetch(
      FOUNDATION,
      post({ intent: "add-task", title: "Call the landlord back", body: "" }),
    );
    expect(added.status).toBe(302);

    const list = await readable(await app.fetch(FOUNDATION));
    expect(list).toContain("Call the landlord back");
  });

  it("cannot invite or remove, and is not shown either control", async () => {
    const app = newApp();
    await practiceOfTwo(app);

    const settings = await readable(await app.fetch("/settings"));
    expect(settings).not.toContain('name="yourName"');
    expect(settings).not.toContain("Send invitation");
    expect(settings).not.toContain("Remove");
    expect(settings).toContain("Leave this practice");

    // And the controls being absent is not the whole of it: posting the
    // form by hand is refused too.
    const invited = await sendInvite(app, MANAGER);
    expect(invited.status).toBe(403);
    expect(app.emailSender.lastTo(MANAGER)).toBeUndefined();

    const removed = await app.fetch(
      "/settings",
      post({ intent: "remove-member", userId: userIdOf(app, OWNER) }),
    );
    expect(removed.status).toBe(403);
  });

  it("never meets the Tailoring Wizard", async () => {
    const app = newApp();
    await practiceOfTwo(app);

    // The flag is on the Practice, so a Member joining a Practice in flight
    // is never handed a screen that sets fourteen Tasks aside (ADR-0002).
    const welcome = await app.fetch("/welcome");
    expect(welcome.headers.get("Location")).toBe("/tasks");
  });
});

describe("removing a Member", () => {
  it("deletes the Membership and leaves their next request unauthenticated", async () => {
    const app = newApp();
    await practiceOfTwo(app);

    // The Member is reading, signed in, right now.
    const theirSession = new Map(app.cookies);
    expect((await app.fetch("/settings")).status).toBe(200);

    await signInAsOwnerAgain(app);
    const removal = await app.fetch(
      "/settings",
      post({ intent: "remove-member", userId: userIdOf(app, SPOUSE) }),
    );
    expect(removal.headers.get("Location")).toBe("/settings");

    // ADR-0004's second mandatory test. Their cookie is unchanged and their
    // sessions are gone, so the very next request is somebody signed out —
    // which is the whole reason `session.cookieCache` must stay off.
    app.clearCookies();
    for (const [name, value] of theirSession) app.cookies.set(name, value);

    const next = await app.fetch("/settings");
    expect(next.headers.get("Location")).toBe("/sign-in");
    expect(membershipsOf(app, SPOUSE)).toEqual([]);
  });

  it("leaves what they wrote with the Practice, and leaves them an account", async () => {
    const app = newApp();
    await practiceOfTwo(app);
    await app.fetch(
      FOUNDATION,
      post({ intent: "note", taskRef: EIN, note: "Filed it on Tuesday" }),
    );

    await signInAsOwnerAgain(app);
    await app.fetch(
      "/settings",
      post({ intent: "remove-member", userId: userIdOf(app, SPOUSE) }),
    );

    const list = await readable(await app.fetch(`${FOUNDATION}?task=${EIN}`));
    expect(list).toContain("Filed it on Tuesday");

    // Removal is the Owner's act and takes the Practice away, not the
    // person. Leaving is the act that takes both, and it is theirs to make.
    expect(
      app.database.select().from(user).where(eq(user.email, SPOUSE)).get(),
    ).toBeDefined();
  });
});

describe("Leaving", () => {
  it("takes the Member's Membership and their User, and leaves their Notes", async () => {
    const app = newApp();
    await practiceOfTwo(app);
    await app.fetch(
      FOUNDATION,
      post({ intent: "note", taskRef: EIN, note: "Filed it on Tuesday" }),
    );

    const left = await app.fetch("/settings", post({ intent: "leave" }));
    expect(left.headers.get("Location")).toBe("/sign-in");

    expect(
      app.database.select().from(user).where(eq(user.email, SPOUSE)).get(),
    ).toBeUndefined();
    expect(membershipsOf(app, SPOUSE)).toEqual([]);

    // A Note belongs to the Practice and not to whoever typed it.
    await signInAsOwnerAgain(app);
    const list = await readable(await app.fetch(`${FOUNDATION}?task=${EIN}`));
    expect(list).toContain("Filed it on Tuesday");
  });

  it("is not offered to an Owner, and is refused if they post it anyway", async () => {
    const app = newApp();
    await signInAs(app, OWNER);

    const settings = await readable(await app.fetch("/settings"));
    expect(settings).not.toContain("Leave this practice");

    // With no co-owners, Leaving would orphan the list. Deleting the
    // Practice is the act an Owner actually means, and it is a different
    // one with a different promise attached.
    const refused = await app.fetch("/settings", post({ intent: "leave" }));
    expect(refused.status).toBe(403);
    expect(membershipsOf(app, OWNER)).toHaveLength(1);
  });
});
