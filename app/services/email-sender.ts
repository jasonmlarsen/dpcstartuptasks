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
