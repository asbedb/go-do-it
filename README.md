# go do it

A small time tracker on top of Todoist. Start a stopwatch on any active task,
pause and resume it, and click **Done** to post a session comment on the task
and overwrite its `duration` with the time tracked. Done never completes the task.

## Setup

```sh
npm install
cp .env.example .env   # then paste your Todoist API token
npm run dev
```

Without `TODOIST_API_TOKEN` the app asks for a token in the browser and keeps it
in `localStorage`. Either way, Todoist is only called from the app's server
routes (`src/routes/api`), so the token never ends up in the client bundle.

Timers are saved in `localStorage` (`todoist-timer:v1`) on every change and
survive closing the browser; a running timer keeps counting while it's closed.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest
- `npm run lint` — Prettier, ESLint and svelte-check
- `npm run build` — production build (pick an adapter before deploying)

## Layout

- `src/lib/timer.ts` — pure timer math and the session comment format
- `src/lib/persistence.ts` — load/validate/save the timer map
- `src/lib/done-flow.ts` — the two Done steps, with skip-on-retry
- `src/lib/timers.svelte.ts` — runes store wrapping the above, one shared ticker
- `src/lib/todoist.ts` — every Todoist SDK call
- `src/lib/server/todoist-api.ts` — builds the SDK client per request
- `src/lib/components/` — `TaskList`, `TaskRow`, `TimerControls`, …
