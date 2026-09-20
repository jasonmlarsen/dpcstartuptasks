import { data, Link } from "react-router";

import type { TaskStatus } from "~/database/schema";
import {
  journeyMap,
  type DependencyAdvice,
  type HelpfulLinkView,
  type JourneyCard,
  type OpenTaskView,
  type RailPhase,
} from "~/practice/journey-map";
import { requireCurrentPractice } from "~/practice/signed-in-practice";
import { getServices } from "~/services/services";
import type { Route } from "./+types/phase";

export function meta({ loaderData }: Route.MetaArgs) {
  const phaseName = loaderData?.map.phaseName;
  return [{ title: phaseName ? `${phaseName} — Launch Tasks` : "Launch Tasks" }];
}

/**
 * The journey map: one Phase of the list, and the Task that is open.
 *
 * Read-only in this slice. The Status control arrives with the next ticket,
 * and nothing here is ever locked — a physician who already holds an EIN can
 * be anywhere in the list on day one, because no Task knows or cares what
 * the ones above it say.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const practice = await requireCurrentPractice(services, request);

  const map = journeyMap(services.database, practice, {
    phaseSlug: params.phaseSlug,
    taskRef: new URL(request.url).searchParams.get("task"),
  });
  if (!map) throw data("No such phase", { status: 404 });

  return { practiceName: practice.name, map };
}

export default function Phase({ loaderData }: Route.ComponentProps) {
  const { practiceName, map } = loaderData;

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">
            {practiceName ?? "Your practice"}
          </h1>
          <p className="text-sm text-gray-500">
            {map.cards.length} tasks in this phase
          </p>
        </div>
      </header>

      <PhaseRail rail={map.rail} />

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="pt-6 text-2xl font-bold text-gray-900">
          {map.phaseName}
        </h2>

        <ul className="mt-4 space-y-3">
          {map.cards.map((card) => (
            <li key={card.ref}>
              <TaskCard card={card} phaseSlug={map.phaseSlug} />
            </li>
          ))}
        </ul>
      </main>

      {map.openTask && (
        <TaskDrawer task={map.openTask} phaseSlug={map.phaseSlug} />
      )}
    </div>
  );
}

/**
 * The rail: eleven Phases, one of them in view.
 *
 * Every Phase is one press away and only one Phase's Tasks are on the page,
 * which is the whole argument of the screen — 3 to 13 Tasks is a morning's
 * work, and 98 is a wall.
 */
function PhaseRail({ rail }: { rail: RailPhase[] }) {
  return (
    <nav
      aria-label="Phases"
      className="border-b border-gray-200 bg-white overflow-x-auto"
    >
      <ol className="mx-auto flex max-w-3xl gap-2 px-6 py-3">
        {rail.map((phase) => (
          <li key={phase.slug} className="shrink-0">
            <Link
              to={`/tasks/${phase.slug}`}
              aria-current={phase.inView ? "page" : undefined}
              className={
                phase.inView
                  ? "block rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white"
                  : "block rounded-full px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              }
            >
              {phase.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A collapsed Task: its title, and two lines of its Body.
 *
 * Not Applicable dims to its title alone and sinks to the bottom of the
 * Phase, and it never disappears — ADR-0002 rests on that. A Practice must
 * always be able to see what it set aside, whether it was the Tailoring
 * Wizard that set it aside or the Practice itself.
 */
function TaskCard({ card, phaseSlug }: { card: JourneyCard; phaseSlug: string }) {
  const setAside = card.status === "not_applicable";

  return (
    <Link
      to={`/tasks/${phaseSlug}?task=${encodeURIComponent(card.ref)}`}
      preventScrollReset
      className={`block rounded-lg border bg-white px-4 py-3 ${
        card.open ? "border-primary" : "border-gray-200"
      } ${setAside ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`font-medium ${setAside ? "text-gray-500" : "text-gray-900"}`}
        >
          {card.title}
        </span>
        <StatusLabel status={card.status} />
      </div>

      {card.snippet !== null && (
        <>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">
            {card.snippet}
          </p>
          {card.variesByState && (
            <p className="mt-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              Varies by state
            </p>
          )}
        </>
      )}
    </Link>
  );
}

/** Where the Practice has got to, said quietly. Read-only until the next ticket. */
function StatusLabel({ status }: { status: TaskStatus }) {
  if (status === "not_started") return null;

  const wording: Record<Exclude<TaskStatus, "not_started">, string> = {
    in_progress: "In progress",
    done: "Done",
    not_applicable: "Not applicable",
  };

  return (
    <span className="shrink-0 text-xs text-gray-500">{wording[status]}</span>
  );
}

/**
 * The drawer: the full Body, the Helpful Links, and the Dependencies.
 *
 * It is a URL, not a widget. `?task=` on the Phase's own address means the
 * physician never navigates away from their place in the list, the drawer is
 * linkable and back-buttonable, and the whole screen still works with no
 * client JS at all.
 *
 * On a phone it is a 90dvh bottom sheet whose footer clears the home
 * indicator; from 800px up it is a panel down the right-hand side.
 */
function TaskDrawer({
  task,
  phaseSlug,
}: {
  task: OpenTaskView;
  phaseSlug: string;
}) {
  const closed = `/tasks/${phaseSlug}`;

  return (
    <>
      <Link
        to={closed}
        preventScrollReset
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-10 bg-gray-900/20"
      />

      <aside
        role="dialog"
        aria-labelledby="open-task-title"
        className="fixed inset-x-0 bottom-0 z-20 flex h-[90dvh] flex-col rounded-t-2xl bg-white shadow-2xl animate-in duration-200 slide-in-from-bottom min-[800px]:inset-y-0 min-[800px]:right-0 min-[800px]:left-auto min-[800px]:h-dvh min-[800px]:w-[28rem] min-[800px]:rounded-none min-[800px]:slide-in-from-bottom-0 min-[800px]:slide-in-from-right motion-reduce:animate-none"
      >
        {/* No `Varies by state` pill here: the pill belongs to the list row,
            where a physician scanning a Phase meets it. Repeating it over the
            Body would be a second place to keep in step for no second
            reader. */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2
            id="open-task-title"
            className="text-lg font-semibold text-gray-900"
          >
            {task.title}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {task.dependencies.length > 0 && (
            <ul className="mb-4 space-y-1">
              {task.dependencies.map((dependency) => (
                <li
                  key={dependency.title}
                  className="text-sm italic text-gray-500"
                >
                  <DependencySentence dependency={dependency} />
                </li>
              ))}
            </ul>
          )}

          {/* The Body carries everything a Task has to say, a recurrence note
              included — *renews annually* is prose the Admin wrote, and the
              product neither schedules it nor promises a reminder about it. */}
          <div
            className="body-prose text-gray-700"
            dangerouslySetInnerHTML={{ __html: task.bodyHtml }}
          />

          {task.helpfulLinks.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900">
                Helpful links
              </h3>
              <ul className="mt-2 space-y-3">
                {task.helpfulLinks.map((link) => (
                  <li key={link.label}>
                    <HelpfulLinkRow link={link} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* The footer the Status control lands in next ticket. Its padding
            clears the home indicator, so the last thing on the sheet is never
            half under it. */}
        <div className="border-t border-gray-200 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <Link
            to={closed}
            preventScrollReset
            className="block rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700"
          >
            Close
          </Link>
        </div>
      </aside>
    </>
  );
}

/** Advice, in the one sentence it is allowed to be. */
function DependencySentence({ dependency }: { dependency: DependencyAdvice }) {
  if (dependency.otherPhaseName) {
    return (
      <>
        usually after {dependency.title}, in {dependency.otherPhaseName}
      </>
    );
  }
  return <>usually after {dependency.title}</>;
}

/**
 * A Helpful Link: the label a physician reads, and the domain beneath it so
 * they know where they are about to go. A list, never pills — there is room
 * for the destination and no reason to hide it.
 */
function HelpfulLinkRow({ link }: { link: HelpfulLinkView }) {
  if (!link.href) {
    return (
      <>
        <span className="block text-sm font-medium text-gray-500">
          {link.label}
        </span>
        <span className="block text-xs text-gray-400">no link set</span>
      </>
    );
  }

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <span className="block text-sm font-medium text-primary underline">
        {link.label}
      </span>
      <span className="block text-xs text-gray-500">{link.domain}</span>
    </a>
  );
}
