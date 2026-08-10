/**
 * One row per violation class: a name, the markup planted on line 7 of `/start/`,
 * the rule id that must fire, and a substring of the string the gate must quote
 * back. `/start/` has no allowance on any rule, so a rule that does not fire
 * here does not fire anywhere.
 *
 * Separate from the test file so the controlled-failure table can be generated
 * from the same rows the test asserts on, rather than transcribed beside them.
 */
export const CLASSES = [
  ["act numbering", "<p>Read act one to see the score come apart.</p>", "act-numbering", "act one"],
  ["the three acts", '<a href="/see/">The three acts</a>', "three-acts", "three acts"],
  ["campaign as the public abstraction", "<p>The campaign is what this site is.</p>", "campaign-prose", "campaign"],
  ["a store key in prose", "<p>campaign.adjudication.ADJ-AVP refuted it.</p>", "campaign-machine-key", "campaign.adjudication.ADJ-AVP"],
  ["registered prediction", "<p>The registered prediction was that patching wins.</p>", "registered-prediction", "registered prediction"],
  ["kill criterion", "<p>The registered kill criterion fired.</p>", "kill-criterion", "kill criterion"],
  ["adjudicated", "<p>The card was adjudicated last July.</p>", "adjudicated", "adjudicated"],
  ["trust rung", "<p>Nothing here has reached that rung.</p>", "trust-rung", "rung"],
  ["evidence record id", "<p>Each number carries an evidence record id.</p>", "evidence-record-id", "evidence record id"],
  ["policy deformation", "<p>We measure the policy deformation.</p>", "policy-deformation", "policy deformation"],
  ["metrology", "<p>The metrology is built and tested.</p>", "metrology", "metrology"],
  ["read the audit", '<a href="/log/">Read the audit</a>', "read-the-audit", "Read the audit"],
  ["the four-part inventory", "<p>The reward-lens website: the campaign ledger, the Atlas, the docs, the science.</p>", "four-part-inventory", "campaign ledger, the Atlas"],
  ["ledger", "<p>The ledger records every card.</p>", "ledger", "ledger"],
  ["a hypothesis count", "<p>84 registered hypotheses, all frozen.</p>", "hypothesis-count", "84 registered hypotheses"],
  ["the deprecated correlation", "<p>The correlation is 0.256 on Skywork.</p>", "deprecated-correlation", "0.256"],
  ["production-ready", "<p>A production-ready measurement stack.</p>", "production-ready", "production-ready"],
  ["real-time", "<p>Real-time monitoring of any run.</p>", "real-time", "Real-time"],
  ["a stale enum count", "<p>There are sixteen refusal reasons.</p>", "sixteen-reasons", "sixteen refusal reasons"],
  ["release candidate", "<p>3.0.0 is a release candidate.</p>", "release-candidate", "release candidate"],
  ["a line count as a credential", "<p>104,271 lines of Python.</p>", "line-count", "104,271 lines"],
  ["a test count as a credential", "<p>3,306 collected tests.</p>", "test-count", "3,306 collected tests"],
  ["a module count as a credential", "<p>212 modules.</p>", "module-count", "212 modules"],
  ["an absolute overhead figure", "<p>It adds 42 microseconds per call.</p>", "absolute-overhead", "42 microseconds"],
  ["a reward hacking detector", "<p>A reward hacking detector, shipped.</p>", "reward-hacking-detector", "reward hacking detector"],
  ["proof from measurement", "<p>It proves the model is aligned.</p>", "proof-from-measurement", "proves the model"],
  ["causal on an observational instrument", "<p>The strongest causal head sits at layer 0.</p>", "causal-on-an-observational-instrument", "causal"],
  ["calibrated with no regime", "<p>The estimator is calibrated and ready.</p>", "calibrated-without-a-regime", "calibrated"],
  ["end-to-end across cases", "<p>An end-to-end measurement stack.</p>", "end-to-end-across-cases", "end-to-end"],
  ["ground truth from a grader", "<p>Scored against ground truth by the verifier.</p>", "ground-truth-from-a-grader", "ground truth"],
  ["a proof word", "<p>The approach is validated across models.</p>", "proof-words", "validated"],
];
