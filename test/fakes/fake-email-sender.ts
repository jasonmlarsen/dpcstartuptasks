import type {
  EmailMessage,
  EmailSender,
  SentEmail,
} from "~/services/email-sender";

/**
 * An in-memory `EmailSender` that keeps what it was given.
 *
 * ADR-0004's mandatory test — request, email, verify, session — reads the
 * Sign-in Link out of `lastTo(address)` and posts it. That is the only reason
 * this exists: not to assert that mail was "sent", but to let a test follow
 * the link a physician would have clicked.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  private nextId = 1;

  async send(message: EmailMessage): Promise<SentEmail> {
    this.sent.push(message);
    return { id: `fake-email-${this.nextId++}` };
  }

  /** The most recent message to an address, or undefined if there was none. */
  lastTo(address: string): EmailMessage | undefined {
    return this.sent.findLast((message) => message.to === address);
  }

  /**
   * Every absolute URL in the most recent message to an address, in the order
   * they appear in the text part. A Sign-in Link test wants the first one.
   */
  linksTo(address: string): string[] {
    const message = this.lastTo(address);
    if (!message) return [];
    return message.text.match(/https?:\/\/\S+/g) ?? [];
  }
}
