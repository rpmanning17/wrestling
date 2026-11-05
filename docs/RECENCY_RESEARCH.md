# Recency research — evaluated, not adopted

Experimental PR #6 was evaluated on 67,736 source rows / 64,050 rated bouts. All drift settings failed the predefined adoption threshold. Keep daily Glicko-2, decision score 0.8 and the existing inactivity RD growth. No drift code, configuration or experimental runtime is incorporated into main.

Preserved verbatim from PR #6 head `f43e2415467ad6b3eba4b319e01421b79bf4fa31`:

- RECENCY_EXPERIMENT_REPORT.md and .json
- BACKTEST_EXPANDED_REPORT.md and .json

The experimental runtime remains available in Git history at `4b1439f6b1fae8621f14fff53c87d64d86ea92be`; main does not provide its CLI. The long RATINGS_2025_WORK_HANDOFF.md on PR #6 was reviewed, but is not copied: its older --force, credential and activation-blocker instructions were superseded by PR #7 and the current operations runbook.

Drift 50/100/150/200 RD per square-root year produced tuning log-loss differences of -0.00006886 / -0.00022953 / -0.00037440 / -0.00040505 against production. All are below the required 0.002 improvement; 200 also has a confidence interval crossing zero. None advanced to candidate confirmation. Do not retune using the observed holdout.

Expanded reference-grid evaluation selects the existing daily/decision-0.8 combination: 16,819 confirmation bouts / 56 events; accuracy 69.424%, log loss 0.559318, Brier 0.191714, ECE 0.015520. This is retrospective support for the existing formula, not adoption of drift. The reports' reference-grid “adopt candidate” recommendation refers to daily/decision-0.8, not the rejected recency settings.

Only 185 confirmation bouts have known age context; 16,634 do not. Event bootstrap does not fully account for shared-date/source dependence (including the 4,476-row Poseidon source split across labels). The already selected baseline overlaps earlier 2026 selection data, limiting independence. No age-specific improvement or prospective validation is established. Require genuinely future tournaments for any renewed claim. Return development focus to scouting; further drift experimentation is not required for operational imports.
