# Rating backtest report

**Not yet generated for production data.**

No backtest has been run against the real `public.matches` table: the sessions that built the pipeline had no database access. Results from synthetic data are deliberately not stored here, because they say nothing about real performance.

To generate this report:

```
pnpm ratings:backtest
```

That command reads matches with the site's read-only credentials, runs the chronological walk-forward evaluation and the tuning grid, and overwrites this file. Review the recommendation and the unrecognized-method list, record the outcome in `docs/STATUS.md`, and record any adopted default change in `docs/DECISIONS.md` before activating a model with different settings. See `docs/RANKINGS.md` section 4 for the method.
