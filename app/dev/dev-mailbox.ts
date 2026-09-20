import type {
  EmailMessage,
  EmailSender,
  SentEmail,
} from "~/services/email-sender";

/**
 * The mailbox a development run reads its own links out of.
 *
 * There is nowhere for a Sign-in Link to be delivered *to* in development —
 * Resend is production's, and the addresses here are `.invalid` and
 * undeliverable on purpose — so the mail has to land somewhere the run can
 * open it. This is that somewhere: every message is kept, and the links in
 * the most recent one to an address are what the invite and Continue steps
 * follow.
 *
 * It prints as it goes, which is the second reason it is not the test fake:
 * a developer who wants to sign in as a dummy Owner by hand tomorrow needs
 * the link on their terminal today.
 */
export class DevMailbox implements EmailSender {
  readonly sent: EmailMessage[] = [];

  private nextId = 1;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  async send(message: EmailMessage): Promise<SentEmail> {
    this.sent.push(message);
    this.log(`  mail → ${message.to}: ${message.subject}`);
    return { id: `dev-email-${this.nextId++}` };
  }

  /** The most recent message to an address. */
  lastTo(address: string): EmailMessage | undefined {
    return this.sent.findLast((message) => message.to === address);
  }

  /** Every absolute URL in the most recent message to an address. */
  linksTo(address: string): string[] {
    return this.lastTo(address)?.text.match(/https?:\/\/\S+/g) ?? [];
  }
}
