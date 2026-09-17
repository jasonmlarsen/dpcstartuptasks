# Task: verify mail.directcaretools.com in Resend

Type: task (HITL)
Status: open
Blocked by: —
Map: ../map.md

## Question

Not a decision — manual work that a later decision waits on. The owner has Resend verified on `notifications.jasonlarsen.net`, but product email must come from the product's own domain: a physician receiving a login link from an unfamiliar personal domain is both a trust problem and a spam-filter problem, on the one email that absolutely must land.

Work to be done:

1. Add `mail.directcaretools.com` as a sending domain in Resend.
2. Add the DNS records Resend issues (DKIM, SPF, and the return-path/MX record) in Cloudflare, where `directcaretools.com` is hosted. **Make sure the records are DNS-only, not proxied** — proxying mail records through Cloudflare's orange cloud breaks them.
3. Confirm verification in Resend.
4. Add a DMARC record for the domain if one is not already present, and decide the policy (start at `p=none` for monitoring).
5. Send one test email and confirm it lands in an inbox, not spam. Check Gmail and Outlook specifically.

The agent drives what it can and hands the owner a precise checklist for the dashboard steps.

## Answer should record

The verified sending domain, the exact from-address to use in the spec, the DMARC policy chosen, and the API key location (never the key itself).
