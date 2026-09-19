# Mail scanner prefetch and single-use magic links

Research date: 2026-09-18. Question: do corporate email security systems issue real GET requests
against URLs in email, and will they burn a single-use magic link sent to a physician on a
hospital/clinic mail system?

## TL;DR

**Yes, and for this audience it is routine, not an edge case.** Treat prefetch-burn as the
*expected* behaviour of the deployment environment, not a tail risk.

- **Documented fact:** Microsoft Defender for Office 365 Safe Links scans URLs **before message
  delivery**, not only at click time, and URLs without an established reputation are **"detonated
  asynchronously in the background."** Detonation means loading the page in a sandboxed browser —
  that is a GET, not a HEAD.
  ([MS Learn](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about))
- **Documented fact:** Proofpoint TAP performs **predictive (pre-delivery) sandboxing** of
  suspicious URLs "before users can click on them," in addition to real-time sandboxing at click.
  ([Proofpoint TAP datasheet](https://www.proofpoint.com/sites/default/files/pfpt-us-ds-targeted-attack-protection-tap.pdf))
- **Vendor acknowledgement of the exact failure mode:** Stytch sells a feature
  (*Protected Email Magic Links*) whose entire purpose is surviving this. They say scanners are
  "very prevalent" in corporate environments and that "most security scanners will inspect and
  **click** on any links present in emails."
  ([Stytch docs](https://stytch.com/docs/b2b/guides/magic-links/protected-eml))
- **Vendor acknowledgement #2:** Supabase's official troubleshooting page names email prefetching
  as the cause of tokens appearing "instantly expired or invalid."
  ([Supabase docs](https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0))
- **HEAD-only handling is NOT a sufficient mitigation.** NextAuth's tutorial says Safe Links sends
  HEAD, but Microsoft's own docs describe *detonation*, and Microsoft's BingPreview crawler
  advertises a full browser User-Agent — those are GETs. Stytch had to resort to device
  intelligence rather than method/UA sniffing, which is strong evidence that method and UA checks
  are insufficient on their own.
- **The only robust mitigation is architectural:** make GET on the link *non-consuming*. Land on a
  page that validates-for-display only, and consume the token on an explicit same-origin **POST**
  (a "Confirm sign-in" button). Secondary options: put the token in the **URL fragment** (never
  sent to the server), allow N uses within a short window, or offer a copy-paste OTP fallback.
- `Sec-Purpose` / `Sec-Fetch-*` sniffing is **not** a real mitigation here. Those headers come from
  *browser* speculative loads, not from mail gateways.
- Mail *clients* also fetch: Outlook.com/BingPreview and Microsoft Preview fetch link targets for
  previews; Slack unfurls with a real GET. Gmail's proxy fetches **images only**, not anchor hrefs.

Bottom line for physicians on hospital/clinic mail: **assume the link will be fetched before the
human sees it.** A magic link that is consumed on GET will fail for a meaningful fraction of this
population, and for those users it is a *total lockout* if magic link is the only auth method. No
source gives a clean percentage for magic-link burn specifically (see
[Quantification](#quantification)); the closest proxy figures are bot-click rates on B2B email,
commonly cited at 10–25% **[UNVERIFIED]**.

---

## 1. Microsoft Defender for Office 365 — Safe Links

Primary source: <https://learn.microsoft.com/en-us/defender-office-365/safe-links-about>

### Delivery-time vs click-time — documented fact

The docs are explicit that it is **both**:

> "Safe Links provides URL scanning and rewriting of inbound email messages **during mail flow**,
> and **time-of-click verification** of URLs and links in email messages, Teams, and supported
> Office 365 apps."

And, importantly, delivery-time scanning happens even when rewriting is turned off:

> "As long as Safe Links protection is turned on, **URLs are scanned prior to message delivery**,
> regardless of whether the URLs are rewritten or not."

> "**Do not rewrite URLs, do checks via SafeLinks API only**: If this setting is selected (on), no
> URL wrapping takes place but **the URLs are scanned prior to message delivery**."

So "we disabled URL rewriting" does not remove the delivery-time fetch.

### Does it issue a GET / detonate? — documented fact

> "URLs that don't have a valid reputation are **detonated asynchronously in the background**."

Plus the real-time scanning setting:

> "**Apply real-time URL scanning for suspicious links and links that point to files**: Turns on
> real-time scanning of links, including links in email messages that point to downloadable
> content."

…and the hold-mail option:

> "**Wait for URL scanning to complete before delivering the message**: Selected (on): Messages that
> contain URLs are held until scanning is finished."

**Inference (high confidence):** "Detonation" in the anti-malware sense means executing/rendering
the target in a sandbox. You cannot detonate a page you only sent HEAD to. A brand-new,
low-reputation domain — exactly what a startup's magic-link domain is — is precisely the case that
triggers detonation. This is inference from the documented word "detonated", not a Microsoft
statement that says "we issue GET".

Note also this line, which matters if the target org chains multiple gateways:

> "Using another service to wrap links before Defender for Office 365 might prevent Safe Links from
> processing links. This processing includes wrapping, **detonating**, or otherwise validating the
> 'maliciousness' of the link."

### Microsoft acknowledging the one-time-link failure mode

Microsoft Q&A, "How to replicate one-time links rendered invalid by Microsoft SafeLinks"
(<https://learn.microsoft.com/en-us/answers/questions/4647398/how-to-replicate-one-time-links-rendered-invalid-b>).
The answer states:

> "Microsoft SafeLinks, a feature in Outlook, re-encodes all URLs in incoming email messages for
> security purposes. When you click on a link, Microsoft checks the website to make sure it's safe
> to visit before they let you through. However, occasionally there are sites whose links only
> allow a **single visit, and SafeLink uses up that click**."

The same answer states the issue **affects all users, not just new ones** — it is a function of how
SafeLinks operates. Caveat: MS Q&A answers are community/support-agent content, not normative
product documentation. Call this **semi-official**.

Corroborating anecdote: a Microsoft Q&A thread on Safe Links and URL detonation
(<https://learn.microsoft.com/en-us/answers/questions/5283972/safe-links-and-url-detonation>) where
an admin running phishing simulations reports:

> "After the first test was over, the results showed that a majority of the clicks were originating
> from **URL detonation in Microsoft Defender**."

> "This was proved by looking at the IP location of the failed clicks (which were all in Microsoft
> data Centres)."

This is anecdote, but it is exactly the observable signature of delivery-time GETs: clicks recorded
from Microsoft datacentre IPs before any human interaction.

### Documented mitigation: allow-listing

Safe Links policies have a **"Do not rewrite the following URLs"** list, with documented wildcard
syntax (`contoso.com/*` and `*.contoso.com/*` to cover a domain and its subdomains). But the docs
add two important caveats:

> "Entries in the 'Do not rewrite the following URLs' list **aren't scanned or wrapped** by Safe
> Links during mail flow, **but might still be blocked at time of click**."

> "The following clients **don't recognize** the 'Do not rewrite the following URLs' lists...:
> Microsoft Teams, Office web apps."

**Practical consequence:** allow-listing works, but it is a *per-tenant admin action performed by
someone else's IT department*. For a consumer-ish/SMB clinic audience you cannot rely on it. It is
a support escape hatch, not a product strategy.

---

## 2. Proofpoint URL Defense / TAP

- **Pre-delivery sandboxing is documented.** Proofpoint's TAP materials describe "predictive
  analysis to identify and sandbox suspicious URLs **before users can click on them**" and
  "predictive defense... to proactively perform advanced dynamic malware analysis on potentially
  suspicious URLs and email attachments **before users click links**."
  ([TAP datasheet](https://www.proofpoint.com/sites/default/files/pfpt-us-ds-targeted-attack-protection-tap.pdf),
  [Proofpoint press release](https://www.proofpoint.com/us/proofpoint-adds-next-generation-predictive-defense-targeted-attack-protection-solution))
- **Click-time sandboxing is documented.** Stanford's URL Defense FAQ
  (<https://uit.stanford.edu/security/url-defense/faq>) states: "Each time a URL is clicked, the
  status of that URL is verified before the redirect is allowed," and "Protected URLs are checked
  in real-time." Stanford's FAQ does **not** mention one-time links being broken.
- **Sandboxing a URL means rendering it** → GET. Same inference as Microsoft. **[INFERENCE]**
- Proofpoint Browser/Email Isolation renders the destination in a remote browser
  ([tech brief](https://www.proofpoint.com/sites/default/files/technical-briefs/pfpt-us-tb-browser-and-email-isolation.pdf)) —
  unambiguously a full page load, though this is at click time.
- I could not reach Proofpoint's own URL Defense FAQ (login-walled) to get a verbatim statement
  about one-time links. **[UNVERIFIED]** whether Proofpoint documents the one-time-link failure
  mode anywhere public.

Net: Proofpoint's *predictive* sandboxing is the dangerous one for magic links, because it runs
pre-delivery and is triggered by reputation/traffic-pattern heuristics — again, exactly the profile
of a new sender domain.

---

## 3. Mimecast URL Protect

- URL Protect rewrites nearly all links in inbound mail; clicks pass through Mimecast.
- Mimecast offers **Managed URLs** with an explicit **"Disable rewriting for this entry"** option,
  and **Bypass Policies** for senders — the standard recommended remedy when one-time links break.
  ([Mimecast: Create Managed URL](https://integrations.mimecast.com/documentation/endpoint-reference/targeted-threat-protection-url-protect/create-managed-url/),
  [TTP URL Protect — Verifying a URL](https://mimecastsupport.zendesk.com/hc/en-us/articles/34000782363539-Targeted-Threat-Protection-URL-Protect-Verifying-a-URL),
  [TTP Optimization](https://mimecastsupport.zendesk.com/hc/en-us/articles/34000726395155-Targeted-Threat-Protection-Optimization))
- Mimecast also has a **"scan on delivery"** aggressiveness setting in URL Protect. **[UNVERIFIED]**
  — I did not get a verbatim quote from Mimecast docs confirming a pre-delivery fetch of link
  *content* as opposed to reputation lookup. The existence of the Managed-URL "disable rewriting"
  remedy, and its widespread recommendation for one-time links, is the strongest available signal.

---

## 4. Barracuda Link Protection

- Barracuda Email Gateway Defense rewrites links through `linkprotect.cudasvc.com`.
  ([Understanding Link Protection](https://campus.barracuda.com/product/emailgatewaydefense/doc/96023012/understanding-link-protection/))
- Barracuda maintains a **built-in exempted-domain list** to reduce false positives — e.g. it does
  not wrap `google.com` but does wrap `googlegroups.com`. Customer exemptions are configurable
  **only at the account level, not the domain level**.
- Barracuda is explicitly named as a scanner that burns Supabase magic links in
  [supabase/auth#1214](https://github.com/supabase/auth/issues/1214) ("Magic Links are invalidated
  by corporate link scanning software", opened Aug 2023, **still open**). That report names
  *Barracuda SafeLinks* and Microsoft Defender. That issue is anecdote, not vendor documentation.

---

## 5. Cisco Secure Email

- Outbreak Filters rewrite URLs above a threat threshold and redirect clicks through the Cisco web
  security proxy.
  ([Cisco AsyncOS admin guide — Outbreak Filters](https://www.cisco.com/c/en/us/td/docs/security/esa/esa15-0/user_guide/b_ESA_Admin_Guide_15-0/b_ESA_Admin_Guide_12_1_chapter_01111.html),
  [URL Rewriting and Analysis](https://docs.ces.cisco.com/docs/url-rewriting-and-analysis))
- Cisco supports per-domain exclusions from URL modification.
- Cisco's rewriting is largely **click-time redirection** based on reputation, which is the least
  dangerous pattern for magic links. **[UNVERIFIED]** whether Cisco performs pre-delivery content
  fetches of URLs.

---

## 6. Google Workspace

- Google's documented email-side prefetching is the **image proxy** (`googleusercontent.com`),
  which fetches **embedded images**, not anchor `href` targets.
  ([Filippo Valsorda's writeup](https://words.filippo.io/how-the-new-gmail-image-proxy-works-and-what-this-means-for-you/),
  [Google Workspace admin — image URL proxy allowlist](https://knowledge.workspace.google.com/admin/gmail/advanced/set-up-an-image-url-proxy-allowlist))
- I found **no documentation** that Gmail/Workspace pre-fetches link targets in email. Google's
  link protection is primarily Safe Browsing reputation lookups plus a click-time interstitial.
  **[UNVERIFIED]** — absence of evidence, and Google does not publish scanner internals.
- **Practical consequence:** Gmail/Workspace tenants are materially *safer* for magic links than
  Microsoft 365 tenants. Most hospital and clinic systems, however, run Microsoft 365 + a SEG.

---

## 7. Mail clients and chat unfurls

| Surface | Fetches link target? | Method | Evidence |
|---|---|---|---|
| Outlook.com / BingPreview | **Yes** | GET (full browser UA) | [Drupal #2828034](https://www.drupal.org/project/drupal/issues/2828034), [phpList #415](https://github.com/phpList/phplist3/issues/415) |
| Microsoft Preview (Teams/Outlook/OneDrive/Copilot link cards) | **Yes** | HEAD and/or GET | [DataDome bot profile](https://datadome.co/bots/microsoft-preview/) |
| Gmail image proxy | Images only | GET (images) | [Litmus](https://www.litmus.com/blog/gmail-prefetching-images) |
| Apple Mail Privacy Protection | Images only | GET (images) | [Mailgun bot detection](https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/open-click-bot-detect) |
| Slack unfurl (link pasted into a channel/DM) | **Yes** | **GET** | [api.slack.com/robots](https://api.slack.com/robots) |

BingPreview's User-Agent is a fully browser-shaped string:

```
Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b
```

Slack's is honest:

```
Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)
```

Slack unfurls up to 5 URLs per message and fetches as little as it can via HTTP `Range` headers,
but it is still a GET against the URL. Relevant if a physician pastes a magic link into a group
chat to "send it to my other device" — which they will.

**The Drupal case is the strongest long-running corroboration available.** Drupal core issue
[#2828034](https://www.drupal.org/project/drupal/issues/2828034), "Bingpreview invalidates one time
login links", has been open since 2016 and is still unresolved. The diagnosis in that thread is
exactly the architectural point:

> Drupal uses HTTP **GET** requests to modify user state (activating blocked accounts) — this
> violates HTTP protocol standards. The problematic route is
> `/user/reset/UID/TIMESTAMP/HASH/login`, which directly logs users in via GET rather than requiring
> form submission.

Drupal's proposed structural fix: **remove the auto-login GET route entirely and force users through
a confirmation form requiring POST.** An early patch tried blocking BingPreview and Slackbot by
User-Agent; that approach was not adopted as the fix, which tells you something about how well
UA-blocking scales.

---

## 8. Identity/auth vendor acknowledgements and recommended mitigations

### Stytch — strongest vendor evidence (documented fact)

<https://stytch.com/docs/b2b/guides/magic-links/protected-eml> and
<https://stytch.com/docs/b2b/guides/magic-links/overview>

Stytch ships a dedicated product feature, **Protected Email Magic Links**, on by default for all
customers. Their framing:

> Email security scanners are "very prevalent" in corporate environments, and "in corporate
> environments where email security scanners are prevalent, this security measure can sometimes
> make Email Magic Links **unusable**." "Most security scanners will inspect and **click** on any
> links present in emails."

> "When we identify that the Magic Link has been clicked by an email security scanner, we do not
> treat the click as an authentication attempt — **meaning the token is not consumed**."

How they do it: **device intelligence** to distinguish humans from scanners. They explicitly do
**not** describe it as HEAD-detection or User-Agent matching.

**This is the single most load-bearing finding in this document.** A commercial auth vendor with
broad corporate deployment built and productised a whole detection layer for this. You do not do
that for a rare edge case. And the fact that they needed *device intelligence* (fingerprinting,
JS execution, behavioural signals) rather than header inspection is direct evidence that
**scanners look like real browsers issuing real GETs.**

### Supabase — documented vendor troubleshooting page

<https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0>

> "Email prefetching is a mechanism used by email clients or security tools to automatically scan
> and sometimes access URLs embedded in emails." … "automated prefetching services can consume the
> OTP token by accessing the link **before the legitimate user does**," making "the token appear
> instantly expired or invalid to the user."

Supabase's recommended mitigations, in their own order:
1. Email-provider-level hints such as `rel="noreferrer noopener"` or headers that "signal security
   scanners not to follow links." — **This is weak advice; see §10.**
2. "Consider if your system can be configured to invalidate the OTP token only **after a user
   explicitly submits it**, rather than upon initial access of a confirmation URL." — this is the
   real fix.
3. Drop clickable links entirely: copy-paste OTP code.

Open, unresolved: [supabase/auth#1214](https://github.com/supabase/auth/issues/1214) (Aug 2023),
naming Barracuda SafeLinks and Microsoft Defender.

### NextAuth.js / Auth.js — dedicated tutorial (documented, but partly wrong)

<https://next-auth.js.org/tutorials/avoid-corporate-link-checking-email-provider>
— titled "Allow Email Signups Behind Corporate Link Checker".

> "they send a **HEAD** request to each link in the Email."

Recommended fix:

```js
if (req.method === "HEAD") {
  return res.status(200).end()
}
```

Plus two alternatives: (a) ask the org's IT to add a Safe Links URL exception; (b) "redirect the
user to a hosted confirmation page which requires a final button click to confirm verification."

**Caution:** the HEAD claim is the weakest link in the chain. It is contradicted by Microsoft's own
"detonated" language, by the BingPreview browser User-Agent, and by Stytch needing device
intelligence. Treat "scanners only send HEAD" as **false in general** — it may be true of *one*
Safe Links code path at *one* point in time. Related community report:
[nextauthjs/next-auth#4585](https://github.com/nextauthjs/next-auth/discussions/4585), which
attributes token consumption to "firewalls prefetching/preflighting content with **actual GETs**".

### Mailgun / SendGrid — deliverability side (documented fact, adjacent)

- Mailgun exposes a `client-info.bot` field on open/click events with values `apple`, `gmail`,
  `generic`. "Various third-party automated systems will automatically open a message and **follow
  the links** for virus scanning and user activity obfuscation."
  ([Mailgun docs](https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/open-click-bot-detect))
- SendGrid: "Non-human Clicks and Open Engagement Recorded" — their system "does not distinguish
  between legitimate and illegitimate clicks because the signal is essentially the same for a human
  user and a bot."
  ([SendGrid support](https://support.sendgrid.com/hc/en-us/articles/4416801410459-Spam-Filters-Non-Human-Clicks-and-Open-Engagement-Recorded))

That second quote is the key operational point: **from the origin server's perspective, a scanner
click and a human click are the same request.** That is an ESP with enormous visibility stating
that the signal is not reliably separable.

---

## 9. Is GET vs HEAD actually distinguishable? Is `Sec-Purpose` a mitigation?

### HEAD vs GET

- Yes, `req.method` is trivially distinguishable at the server.
- **No, it does not help much.** Refusing to consume on HEAD is free and you should do it — but
  it only defends against the subset of scanners that use HEAD. The evidence above (detonation,
  browser UA on BingPreview, Stytch's device intelligence, the NextAuth thread's "actual GETs")
  says a large share of scanner traffic is GET.
- **Verdict: necessary, nowhere near sufficient.** Do it as defence-in-depth, never as the plan.

### `Sec-Purpose` / `Sec-Fetch-*`

- `Sec-Purpose: prefetch` is emitted by **browsers** doing speculative navigation:
  `<link rel=prefetch>`, `<link rel=prerender>`, and the Speculation Rules API. Chrome sends both
  `Purpose: prefetch` and `Sec-Purpose: prefetch`; Firefox sends `Sec-Purpose`.
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Purpose),
  [Chromium intent-to-ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/0yrUBDA8uUs))
- Mail gateways and SEGs are **not browsers implementing speculation rules.** There is no
  specification, convention, or vendor commitment that a link scanner sends `Sec-Purpose`.
- `Sec-Fetch-Mode` / `Sec-Fetch-Dest` are sent by browsers on all fetches; a headless-Chromium-based
  detonation sandbox would send `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document` — **identical
  to a real user.** They do not discriminate.
- **Verdict: `Sec-Purpose` sniffing defends only against in-browser prefetch (a real but different
  problem — e.g. Next.js `<Link>` prefetch, browser speculative loads). It is NOT a mitigation for
  mail scanners.** **[INFERENCE, high confidence]**

### `robots.txt` / `X-Robots-Tag` / `nosniff`

- `robots.txt` is a convention for *crawlers indexing content*. Security scanners are adversarial
  tools designed to see what a victim would see; there is no reason to expect them to honour it,
  and no vendor documents honouring it. Slack documents a robots policy
  ([api.slack.com/robots](https://api.slack.com/robots)) — Slack is the friendly case, not the SEG
  case.
- `X-Content-Type-Options: nosniff` is about MIME sniffing. It has nothing to do with this.
- Supabase's suggestion of `rel="noreferrer noopener"` as a prefetch hint is, as far as I can find,
  **not grounded in any spec or vendor behaviour** — those attributes control referrer leakage and
  `window.opener`, not fetching. **[UNVERIFIED / likely incorrect advice]**

### What actually works

Ranked by robustness:

1. **Consume on POST, never on GET.** GET renders an interstitial ("You're signing in as
   `dr@clinic.org` — [Continue]"), validating the token *for display only* with zero side effects.
   The button POSTs same-origin with a CSRF token; only that POST burns the link. A scanner cannot
   forge it without executing your JS, submitting a form, and passing CSRF. This is the fix Drupal
   core converged on and the one Supabase points at.
   - Cost: one extra click. Also a genuine security *improvement* — it makes the login step a
     deliberate, non-forgeable user action.
2. **Token in the URL fragment.** `https://app/auth/confirm#token=…` — fragments are never sent to
   the server, so *no* server-side fetch can see the token, no matter how thoroughly it detonates.
   Client JS reads the fragment and POSTs it. Strong, but requires JS and makes the token visible
   to anything running in the page.
3. **Allow N uses in a short window** (e.g. 3 uses / 10 minutes). Cheap, no UX cost, but it weakens
   the one-time property and doesn't help if the scanner's fetch *completes a login* and sets a
   session. Best as a complement, not a substitute.
4. **HEAD → 200 no-op, and known-scanner UA → 200 no-op.** Free, harmless, partial.
5. **Ask the customer's IT to allow-list your domain** in Safe Links / Mimecast Managed URLs /
   Barracuda exemptions. Works, but it is a per-tenant human process. Fine as a support runbook,
   useless as a default.
6. **Offer a copy-paste OTP code as an alternative or primary.** Immune to this class of problem
   entirely. Several write-ups argue B2B products should simply prefer OTP over magic links for
   this reason.

---

## 10. Quantification

**No high-trust source I found publishes a magic-link burn rate.** What exists:

- **Stytch:** qualitative only — scanners "very prevalent"; "most security scanners will inspect
  and click on any links"; can make magic links "unusable." (documented, unquantified)
- **Microsoft:** documents that delivery-time scanning happens to *all* mail under a Safe Links
  policy, and that detonation happens for URLs "that don't have a valid reputation." No rate given.
  (documented, unquantified)
- **Marketing-email bot-click rates** are the nearest available proxy. Secondary sources commonly
  cite **10–25% bot clicks on B2B sends**, attributing them to corporate security scanners.
  **[UNVERIFIED]** — I saw this range only in a search summary of secondary deliverability blogs,
  not in a primary ESP report. Do not cite this number.
- **Important caveat on the proxy:** bot-click rate is *not* the same as burn rate. It is arguably
  a **lower bound** for your case, because marketing links are typically on established,
  high-reputation sender domains, whereas a new startup's magic-link domain has no reputation and
  is therefore *more* likely to be detonated rather than merely reputation-checked.

### Reasoning about the physician population specifically **[INFERENCE]**

- Hospital and health-system mail is overwhelmingly Microsoft 365, very often with a SEG
  (Proofpoint, Mimecast, Barracuda) layered on top. Healthcare is a top-targeted phishing sector,
  so these tenants run *aggressive*, not default, policies.
- Small independent clinics are more mixed (Google Workspace, or M365 Business Premium — which
  includes Defender for Office 365 and therefore Safe Links **Built-in protection**, which the
  Microsoft docs say applies "to all recipients" even with no policy configured).
- A new domain sending authentication mail has no reputation → detonation path, not the
  reputation-lookup path.
- Physicians read mail on phones, often hours later, frequently forwarding to a personal address or
  pasting into a chat — each of which adds another fetch (Slack unfurl, BingPreview).

**Judgement: for this audience, prefetch-burn is a routine occurrence, not a rare edge case.** I
would not ship a magic-link-only flow that consumes on GET. The consequence is not a degraded
experience; it is a hard lockout on the *first* interaction a new physician has with the product,
with an error message ("invalid or expired link") that blames them for something they did not do.

---

## 11. Confidence ledger

| Claim | Status |
|---|---|
| Safe Links scans URLs pre-delivery, even with rewriting off | **Documented fact** (MS Learn) |
| Safe Links detonates low-reputation URLs asynchronously | **Documented fact** (MS Learn) |
| "Detonation" implies a GET / full page load | **Inference**, high confidence |
| Safe Links consumes single-visit links | **Semi-official** (MS Q&A answer) |
| Proofpoint TAP sandboxes URLs pre-delivery ("predictive") | **Documented fact** (Proofpoint datasheet) |
| Mimecast/Barracuda/Cisco offer per-domain rewrite exemptions | **Documented fact** (vendor docs) |
| Mimecast fetches link *content* pre-delivery | **[UNVERIFIED]** |
| Cisco fetches link content pre-delivery | **[UNVERIFIED]** |
| Google Workspace does not prefetch anchor hrefs in mail | **[UNVERIFIED]** (no evidence found either way; Gmail image proxy is images-only and is documented) |
| Stytch built a feature because scanners burn magic links; scanners "very prevalent" | **Documented fact** (Stytch docs) |
| Stytch uses device intelligence, not method/UA sniffing | **Documented fact** (Stytch docs) |
| Supabase names prefetching as cause of `otp_expired` | **Documented fact** (Supabase docs) |
| NextAuth's claim that scanners send HEAD | **Documented claim, but contradicted** by other evidence — do not rely on |
| BingPreview issues GETs with a browser UA and burns one-time links | **Well-corroborated anecdote** (Drupal core issue open since 2016, phpList issue) |
| Slack unfurl issues GET | **Documented fact** (api.slack.com/robots) |
| `Sec-Purpose` is browser-only and useless against SEGs | **Inference** from MDN/Chromium specs, high confidence |
| `rel="noreferrer noopener"` deters scanners | **[UNVERIFIED / likely incorrect]** — no spec basis |
| 10–25% bot-click rate on B2B email | **[UNVERIFIED]** — secondary sources only, do not cite |
| Burn rate for magic links specifically | **No source quantifies this** |

## 12. Sources

- Microsoft Learn — Complete Safe Links overview: <https://learn.microsoft.com/en-us/defender-office-365/safe-links-about>
- Microsoft Q&A — one-time links rendered invalid by SafeLinks: <https://learn.microsoft.com/en-us/answers/questions/4647398/how-to-replicate-one-time-links-rendered-invalid-b>
- Microsoft Q&A — Safe Links and URL Detonation: <https://learn.microsoft.com/en-us/answers/questions/5283972/safe-links-and-url-detonation>
- Proofpoint TAP datasheet: <https://www.proofpoint.com/sites/default/files/pfpt-us-ds-targeted-attack-protection-tap.pdf>
- Proofpoint — predictive defense press release: <https://www.proofpoint.com/us/proofpoint-adds-next-generation-predictive-defense-targeted-attack-protection-solution>
- Proofpoint Browser and Email Isolation tech brief: <https://www.proofpoint.com/sites/default/files/technical-briefs/pfpt-us-tb-browser-and-email-isolation.pdf>
- Stanford UIT — URL Defense FAQ: <https://uit.stanford.edu/security/url-defense/faq>
- Mimecast — Create Managed URL: <https://integrations.mimecast.com/documentation/endpoint-reference/targeted-threat-protection-url-protect/create-managed-url/>
- Mimecast — TTP URL Protect, Verifying a URL: <https://mimecastsupport.zendesk.com/hc/en-us/articles/34000782363539-Targeted-Threat-Protection-URL-Protect-Verifying-a-URL>
- Mimecast — TTP Optimization: <https://mimecastsupport.zendesk.com/hc/en-us/articles/34000726395155-Targeted-Threat-Protection-Optimization>
- Barracuda — Understanding Link Protection: <https://campus.barracuda.com/product/emailgatewaydefense/doc/96023012/understanding-link-protection/>
- Cisco — Outbreak Filters (AsyncOS 15.0): <https://www.cisco.com/c/en/us/td/docs/security/esa/esa15-0/user_guide/b_ESA_Admin_Guide_15-0/b_ESA_Admin_Guide_12_1_chapter_01111.html>
- Cisco CES — URL Rewriting and Analysis: <https://docs.ces.cisco.com/docs/url-rewriting-and-analysis>
- Stytch — Protected Email Magic Links: <https://stytch.com/docs/b2b/guides/magic-links/protected-eml>
- Stytch — Email Magic Links overview: <https://stytch.com/docs/b2b/guides/magic-links/overview>
- Supabase — OTP verification failures troubleshooting: <https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0>
- supabase/auth#1214 — Magic Links invalidated by corporate link scanning software: <https://github.com/supabase/auth/issues/1214>
- NextAuth.js — Allow Email Signups Behind Corporate Link Checker: <https://next-auth.js.org/tutorials/avoid-corporate-link-checking-email-provider>
- nextauthjs/next-auth discussion #4585: <https://github.com/nextauthjs/next-auth/discussions/4585>
- Drupal core #2828034 — BingPreview invalidates one-time login links: <https://www.drupal.org/project/drupal/issues/2828034>
- phpList#415 — Block BingPreview (auto-visits links in emails): <https://github.com/phpList/phplist3/issues/415>
- Slack — Slack Robots: <https://api.slack.com/robots>
- DataDome — Microsoft Preview bot profile: <https://datadome.co/bots/microsoft-preview/>
- Mailgun — Open/Click bot detection: <https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/open-click-bot-detect>
- SendGrid — Non-human clicks and open engagement: <https://support.sendgrid.com/hc/en-us/articles/4416801410459-Spam-Filters-Non-Human-Clicks-and-Open-Engagement-Recorded>
- Gmail image proxy: <https://words.filippo.io/how-the-new-gmail-image-proxy-works-and-what-this-means-for-you/>
- Google Workspace — image URL proxy allowlist: <https://knowledge.workspace.google.com/admin/gmail/advanced/set-up-an-image-url-proxy-allowlist>
- MDN — Sec-Purpose: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Purpose>
- Chromium — Intent to Ship: Sec-Purpose with link rel=prefetch: <https://groups.google.com/a/chromium.org/g/blink-dev/c/0yrUBDA8uUs>
