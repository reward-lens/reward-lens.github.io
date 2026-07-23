# Site copy claims

Every campaign number that appears in the site's own copy (homepage bands,
campaign index, method page, science page), tagged with the evidence record
that backs it. `reward-lens claims` runs over this file against the vendored
adjudication store in src/data/claims-store/; a nonzero exit fails the build.
Counts (53, 16/21/16, 27, 4/8/7/8, 8 kills) are derived from the adjudication
records and asserted by scripts/build_data.py and
scripts/checks/data_assertions.mjs; dollar figures are metered sums from
close_summary.json. Numbers below are the measured values.

## Homepage, receipts band

- Attribution recovered the planted key at AUC [[claim value=1.0 ev=ev:a34457e83cd4eec10d080804a2533e82 field=metrics.attribution_recovery_auc tol=1e-4]] while patching recovered it at [[claim value=0.433962 ev=ev:a34457e83cd4eec10d080804a2533e82 field=metrics.patching_recovery_auc tol=1e-4]]: the two instruments disagree about ground truth.
- Certified erasure cut the exploit drift by [[claim value=0.885616 ev=ev:41058731abf1d0b1590d4f2286e8771c field=metrics.exploit_drift_reduction tol=1e-4]] at a published benchmark cost of [[claim value=-0.398752 ev=ev:41058731abf1d0b1590d4f2286e8771c field=metrics.rb2_accuracy_delta_after_erasure tol=1e-4]].
- The reward direction stabilization was monotone: [[claim value=1 ev=ev:01c81c7185640f9b962b9115f360732e field=metrics.w_r_stabilization_monotone tol=1e-4]].
- Susceptibility predicted best-of-n drift ordering at rho [[claim value=0.964286 ev=ev:c978e3958769ecf93dcf079771a3aedb field=metrics.chi_bon_spearman tol=1e-4]].
- Intransitive preference mass measured at [[claim value=0.213976 ev=ev:844ad06a5aeb1d89c21c13c19a28cbd2 field=metrics.intransitive_mass tol=1e-4]].
- The judge's pre-critique verdict matched its final verdict at rate [[claim value=1.0 ev=ev:e7fd3fee89a0c56cf4465212601d0d26 field=metrics.verdict_prefix_match_rate tol=1e-4]].
- The campaign's directional Brier was [[claim value=0.26 ev=ev:3990df7af1488c08ad62786d879b0b0f field=metrics.brier_directional tol=1e-4]] against the registered coin threshold [[claim value=0.25 ev=ev:3990df7af1488c08ad62786d879b0b0f field=thresholds.H-brier tol=1e-4]].

## Homepage, frontier band and lens band

- The calibration transfer gap was [[claim value=0.419 ev=ev:b37f71c015ebfd697d7deb2a7efb5f7e field=metrics.max_abs_auc_difference tol=1e-3]] against the frozen bound [[claim value=0.15 ev=ev:b37f71c015ebfd697d7deb2a7efb5f7e field=thresholds.H-transfer tol=1e-4]].
- The dense localization instrument scored [[claim value=0.282144 ev=ev:46e1500c4d39f9821c137ae0b00ac0da field=metrics.dense_localization_auc tol=1e-4]] against its registered 0.7, firing K-verif.

## Campaign index, walkthrough

- CHI-DRIFT observed [[claim value=0.9643 ev=ev:c978e3958769ecf93dcf079771a3aedb field=metrics.chi_bon_spearman tol=1e-3]] against its registered threshold [[claim value=0.3 ev=ev:c978e3958769ecf93dcf079771a3aedb field=thresholds.H-chi-bon tol=1e-4]].
- CAL-TRANSFER observed [[claim value=0.419 ev=ev:b37f71c015ebfd697d7deb2a7efb5f7e field=metrics.max_abs_auc_difference tol=1e-3]] against its frozen equivalence bound [[claim value=0.15 ev=ev:b37f71c015ebfd697d7deb2a7efb5f7e field=kill_thresholds.K-transfer tol=1e-4]].

## Science page

- Fluctuation-dissipation held at rho [[claim value=0.964286 ev=ev:c978e3958769ecf93dcf079771a3aedb field=metrics.chi_bon_spearman tol=1e-4]] on one model and [[claim value=1.0 ev=ev:c978e3958769ecf93dcf079771a3aedb field=metrics.chi_bon_spearman_second_model tol=1e-4]] on a second.
- Value-convergence excess measured [[claim value=-0.0698739 ev=ev:0c80d9086ebb0ad9704b88a8eefb01fa field=metrics.real_vce tol=1e-4]] against the capability-matched null.
- The tacit fraction at 8B was [[claim value=0.972287 ev=ev:a7ed2d6b81c5f79458dad733defb3803 field=metrics.real_tacit_fraction tol=1e-4]].
- The eval-awareness probe read benchmark-versus-organic at balanced accuracy [[claim value=0.79325 ev=ev:54fb272fd011c8ca07a4959f553341ab field=metrics.real_probe_balanced_acc tol=1e-4]] while steering moved reward by [[claim value=-0.000209509 ev=ev:54fb272fd011c8ca07a4959f553341ab field=metrics.delta_r_per_steer tol=1e-5]].
- The Welch floor slack was [[claim value=0.816398 ev=ev:f9e6a003a5a1e0aa0fe3ff1eca0d9c7b field=metrics.welch_floor_min_slack tol=1e-4]].
- Interval coverage at nominal 0.8 was [[claim value=0.75 ev=ev:3990df7af1488c08ad62786d879b0b0f field=metrics.interval_coverage_0p8 tol=1e-4]].
