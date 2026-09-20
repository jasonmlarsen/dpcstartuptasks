# Admin access runbook

**Who may reach `/admin`, and how they come to.**

There is no promotion screen, and there is never going to be one. Becoming
the Admin is a `UPDATE` typed on the VPS against the live database, which is
the whole of the mechanism: an endpoint that could grant the role is an
endpoint that can be attacked, and over the life of this product the
statement below will be run perhaps twice.

---

## Promote a User to Admin

**Before you start:** the person must already have signed in at least once.
The Admin signs in exactly the way every physician does — a Sign-in Link and
the Continue Screen — so there is a `user` row to update only after they
have used the door. Registration also gives that address a Practice of its
own; that is expected, and it will appear in the Active list on the
dashboard like anyone else's.

On the VPS, against the app's SQLite file:

```sh
sqlite3 /path/to/launch-tasks.sqlite \
  "UPDATE user SET role = 'admin' WHERE email = 'operator@directcaretools.com';"
```

`sqlite3` reports nothing on success. Confirm it landed:

```sh
sqlite3 /path/to/launch-tasks.sqlite \
  "SELECT email, role FROM user WHERE role = 'admin';"
```

The change takes effect on the person's **next request** — there is no
session cache (ADR-0004), so the role is read from the database every time.
They do not need to sign out and back in.

## Demote

The same statement in reverse, and it lands just as quickly:

```sh
sqlite3 /path/to/launch-tasks.sqlite \
  "UPDATE user SET role = NULL WHERE email = 'operator@directcaretools.com';"
```

`NULL` and `'user'` both mean *not the Admin*. Write `'admin'` and nothing
else: the app compares the column exactly, so a row reading `'admin,user'` —
which Better Auth's own plugin would accept — is refused here. New Users are stamped `'user'`
by Better Auth's `admin` plugin on creation; nothing in the app ever writes
this column again.

## What a non-Admin sees

Every address under `/admin` answers **404** — the page could not be found —
to a signed-out visitor, a physician, a Member, and an Admin who has just
been demoted. Not a redirect to sign-in and not a 403: either would tell a
stranger that there is something there and that they are not it.

So *"I can't get into the admin panel"* and *"that URL doesn't exist"* look
identical from the outside, which is the design. If the statement above has
been run and the page is still a 404, check the address for a typo — it is
matched exactly — and that you are signed in as that address and not another
one.

## Why none of this is a screen

Spelled out in the spec ([#23](https://github.com/jasonmlarsen/dpcstartuptasks/issues/23))
and in [#5](https://github.com/jasonmlarsen/dpcstartuptasks/issues/5): the
admin panel lives inside the same app, guarded by one role column, and
promotion is deliberately never a UI. Better Auth's `admin` plugin ships
endpoints that would do it — `set-role` among them — and they are unreachable
because `auth.handler` is never mounted (ADR-0004). `test/admin.test.ts`
asserts that they stay unreachable.
