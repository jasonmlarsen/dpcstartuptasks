/**
 * Seam 2, half one: transactional mail as an injected client.
 *
 * v1 sends exactly two emails — the Sign-in Link and the Invite — through
 * Resend. Nothing outside the implementation of this interface may import a
 * mail library, and no test may reach for module mocking: a test is handed a
 * fake that records what was sent, and reads the Sign-in Link back out of it.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<SentEmail>;
}

export interface EmailMessage {
  /**
   * Who it comes from, spelled out by the caller rather than left to the
   * provider. The from-address is app config, not a Resend setting, so that
   * changing it is a diff in this repo and not a click in someone's dashboard.
   */
  from: string;
  /** Where a physician's reply goes: a human, not a black hole. */
  replyTo: string;
  /** The single recipient. v1 has no path that mails two people at once. */
  to: string;
  subject: string;
  /** Both bodies are required: a text/plain-only reader is not a rare bird. */
  html: string;
  text: string;
}

export interface SentEmail {
  /** The provider's id for the message, for tracing a delivery complaint. */
  id: string;
}

/**
 * The two addresses every message this app sends carries.
 *
 * `noreply@` is on the `mail.` subdomain because that is the sending domain
 * with DKIM, SPF and a return-path MX verified against it. The reply address
 * is on the bare domain and is read by a person — a physician who replies to a
 * Sign-in Link asking what it is deserves an answer rather than a bounce.
 */
export const MAIL_FROM = "DirectCareTools <noreply@mail.directcaretools.com>";
export const MAIL_REPLY_TO = "admin@directcaretools.com";
