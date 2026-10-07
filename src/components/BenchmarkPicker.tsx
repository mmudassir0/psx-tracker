import { setBenchmarkAction } from "@/app/actions";

/** "Compare with" chips; picking one saves it for every portfolio page. */
export function BenchmarkPicker({
  current,
  codes,
  back,
}: {
  current: string;
  codes: string[];
  /** Page to return to after saving. */
  back: string;
}) {
  return (
    <div className="-mx-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
      <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Compare with</span>
      {codes.map((code) => (
        <form key={code} action={setBenchmarkAction}>
          <input type="hidden" name="index" value={code} />
          <input type="hidden" name="back" value={back} />
          <button
            type="submit"
            aria-pressed={code === current}
            className={
              code === current
                ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {code}
          </button>
        </form>
      ))}
    </div>
  );
}
