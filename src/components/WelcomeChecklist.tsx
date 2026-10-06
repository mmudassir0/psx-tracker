import Link from "next/link";
import { dismissOnboardingAction } from "@/app/actions";
import type { OnboardingStep } from "@/lib/onboarding";

/** First-run checklist on the dashboard; ticks itself off as you go. */
export function WelcomeChecklist({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Get started</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {done} of {steps.length} done. Your data is private to your account.
          </p>
        </div>
        <form action={dismissOnboardingAction}>
          <button type="submit" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Hide
          </button>
        </form>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className="flex h-full gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-800"
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  step.done ? "bg-emerald-600 text-white" : "border border-slate-300 dark:border-slate-600"
                }`}
              >
                {step.done ? "✓" : ""}
              </span>
              <span className="flex flex-col">
                <span className={`text-sm font-medium ${step.done ? "text-slate-500 line-through dark:text-slate-400" : ""}`}>
                  {step.label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{step.hint}</span>
                <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
