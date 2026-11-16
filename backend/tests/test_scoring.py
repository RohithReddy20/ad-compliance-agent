from app.schemas import EvalRun, Finding, GoldenCase, GoldenFinding, Report
from evals.scoring import aggregate, score_case


def gf(category, required=True, ts=None, claim="golden claim"):
    return GoldenFinding(category=category, claim=claim, severity="high", timestamp_s=ts, required=required)


def pf(category, ts=None, claim="predicted claim"):
    return Finding(
        category=category,
        claim=claim,
        rule="rules.md",
        severity="high",
        rationale="r",
        evidence_channel="audio" if ts else "copy",
        timestamp_s=ts,
    )


def case(cid="c1", verdict="non_compliant", findings=(), modality="text"):
    return GoldenCase(
        id=cid,
        source_type="fda_letter",
        modality=modality,
        vertical="weight_loss",
        title="t",
        company="co",
        ad_content="ad",
        expected_verdict=verdict,
        expected_findings=list(findings),
    )


def report(verdict="non_compliant", findings=(), modality="text", ad_id="c1", latency=1.5):
    return Report(
        ad_id=ad_id,
        modality=modality,
        verdict=verdict,
        summary="s",
        findings=list(findings),
        model="m",
        latency_s=latency,
        usage={"input_tokens": 10, "output_tokens": 5},
    )


# ------------------------------------------------------------------ matching


def test_category_match_hits_must_catch():
    c = case(findings=[gf("compounded_drug_misrepresentation")])
    s = score_case(c, report(findings=[pf("compounded_drug_misrepresentation")]), None)
    assert s.verdict_ok
    assert (s.must_catch_total, s.must_catch_hit) == (1, 1)
    assert s.missed == [] and s.false_flags == []
    assert s.latency_s == 1.5


def test_wrong_category_is_miss_and_false_flag():
    c = case(findings=[gf("compounded_drug_misrepresentation", claim="same active ingredient")])
    s = score_case(c, report(findings=[pf("off_label_promotion", claim="treats PCOS")]), None)
    assert s.must_catch_hit == 0
    assert s.missed == ["compounded_drug_misrepresentation: same active ingredient"]
    assert s.false_flags == ["off_label_promotion: treats PCOS"]


def test_each_golden_finding_matches_once():
    c = case(findings=[gf("missing_risk_information"), gf("missing_risk_information")])
    s = score_case(c, report(findings=[pf("missing_risk_information")]), None)
    assert (s.must_catch_total, s.must_catch_hit) == (2, 1)
    assert len(s.missed) == 1


def test_required_findings_matched_first():
    # one prediction, an optional and a required golden finding of the same category:
    # the prediction must go to the required one
    c = case(findings=[gf("missing_risk_information", required=False), gf("missing_risk_information", required=True)])
    s = score_case(c, report(findings=[pf("missing_risk_information")]), None)
    assert (s.must_catch_total, s.must_catch_hit) == (1, 1)


# ------------------------------------------------------------------ timestamps


def test_timestamp_overlap_within_tolerance():
    c = case(modality="video", findings=[gf("false_or_misleading_efficacy", ts=(35.0, 39.0))])
    near = score_case(c, report(modality="video", findings=[pf("false_or_misleading_efficacy", ts=(40.5, 42.0))]), None)
    assert near.must_catch_hit == 1
    assert (near.timestamp_total, near.timestamp_hits) == (1, 1)


def test_timestamp_outside_tolerance_is_miss_and_false_flag():
    c = case(modality="video", findings=[gf("false_or_misleading_efficacy", ts=(35.0, 39.0))])
    far = score_case(c, report(modality="video", findings=[pf("false_or_misleading_efficacy", ts=(45.0, 48.0))]), None)
    assert far.must_catch_hit == 0
    assert len(far.false_flags) == 1
    assert far.timestamp_total == 0


def test_prediction_without_timestamp_matches_but_is_not_a_timestamp_hit():
    c = case(modality="video", findings=[gf("missing_risk_information", ts=(0.0, 30.0))])
    s = score_case(c, report(modality="video", findings=[pf("missing_risk_information")]), None)
    assert s.must_catch_hit == 1
    assert (s.timestamp_total, s.timestamp_hits) == (1, 0)


def test_best_overlap_first():
    # two golden windows; prediction overlapping the second more should take the second,
    # leaving the first free for the other prediction
    c = case(
        modality="video",
        findings=[
            gf("inadequate_disclosure_prominence", ts=(10.0, 12.0)),
            gf("inadequate_disclosure_prominence", ts=(13.0, 20.0)),
        ],
    )
    preds = [
        pf("inadequate_disclosure_prominence", ts=(13.0, 19.0)),
        pf("inadequate_disclosure_prominence", ts=(9.0, 11.0)),
    ]
    s = score_case(c, report(modality="video", findings=preds), None)
    assert s.must_catch_hit == 2 and s.false_flags == []


# ------------------------------------------------------------------ optional findings


def test_optional_finding_not_penalised_when_missed():
    c = case(findings=[gf("compounded_drug_misrepresentation"), gf("inadequate_disclosure_prominence", required=False)])
    s = score_case(c, report(findings=[pf("compounded_drug_misrepresentation")]), None)
    assert (s.must_catch_total, s.must_catch_hit) == (1, 1)
    assert s.missed == []


def test_flagging_optional_finding_is_not_false_flag():
    c = case(findings=[gf("inadequate_disclosure_prominence", required=False)])
    s = score_case(c, report(findings=[pf("inadequate_disclosure_prominence")]), None)
    assert s.false_flags == []
    assert s.must_catch_total == 0


# ------------------------------------------------------------------ verdicts


def test_needs_review_accepts_non_compliant_and_needs_review():
    c = case(verdict="needs_review")
    assert score_case(c, report(verdict="needs_review"), None).verdict_ok
    assert score_case(c, report(verdict="non_compliant"), None).verdict_ok
    assert not score_case(c, report(verdict="compliant"), None).verdict_ok


def test_other_verdicts_exact():
    assert not score_case(case(verdict="compliant"), report(verdict="needs_review"), None).verdict_ok
    assert not score_case(case(verdict="non_compliant"), report(verdict="needs_review"), None).verdict_ok
    assert score_case(case(verdict="compliant"), report(verdict="compliant"), None).verdict_ok


def test_error_case():
    c = case(findings=[gf("compounded_drug_misrepresentation")])
    s = score_case(c, None, "boom")
    assert s.error == "boom" and not s.verdict_ok and s.predicted_verdict is None
    assert (s.must_catch_total, s.must_catch_hit) == (1, 0)


# ------------------------------------------------------------------ aggregate


def _run(cases, reports, baseline=None):
    scores = [score_case(c, r, None) for c, r in zip(cases, reports)]
    return aggregate(scores, cases, reports, "m", baseline)


def test_aggregate_metrics():
    cases = [
        case("a", findings=[gf("compounded_drug_misrepresentation"), gf("missing_risk_information")]),
        case("b", verdict="compliant"),
    ]
    reports = [
        report(ad_id="a", findings=[pf("compounded_drug_misrepresentation")]),
        report(ad_id="b", verdict="non_compliant", findings=[pf("off_label_promotion")]),
    ]
    run = _run(cases, reports)
    assert run.n_cases == 2
    assert run.verdict_accuracy == 0.5
    assert run.must_catch_recall == 0.5
    assert run.precision == 0.5
    assert run.false_flags_on_compliant == 1
    assert run.timestamp_hit_rate is None
    assert run.per_category["compounded_drug_misrepresentation"] == {"recall": 1.0, "support": 1}
    assert run.per_category["missing_risk_information"] == {"recall": 0.0, "support": 1}
    assert run.usage == {"input_tokens": 20, "output_tokens": 10}
    assert run.total_latency_s == 3.0
    assert run.baseline_run_id is None and run.regressions == []


def _baseline(**kw):
    base = dict(
        run_id="base",
        created_at="2026-11-17T00:00:00Z",
        model="m",
        n_cases=2,
        verdict_accuracy=1.0,
        must_catch_recall=1.0,
        precision=1.0,
        false_flags_on_compliant=0,
        timestamp_hit_rate=None,
        per_category={},
        cases=[],
    )
    base.update(kw)
    return EvalRun(**base)


def test_regression_detected_on_recall_verdict_and_false_flags():
    cases = [case("a", findings=[gf("compounded_drug_misrepresentation")]), case("b", verdict="compliant")]
    reports = [report(ad_id="a", verdict="compliant"), report(ad_id="b", findings=[pf("off_label_promotion")])]
    run = _run(cases, reports, _baseline())
    assert run.baseline_run_id == "base"
    assert run.deltas["must_catch_recall"] == -1.0
    assert run.deltas["verdict_accuracy"] == -1.0
    assert run.deltas["false_flags_on_compliant"] == 1
    assert len(run.regressions) == 3


def test_small_drop_is_not_regression():
    cases = [case("a", findings=[gf("compounded_drug_misrepresentation")])]
    reports = [report(ad_id="a", findings=[pf("compounded_drug_misrepresentation")])]
    run = _run(cases, reports, _baseline(must_catch_recall=1.0, verdict_accuracy=1.0))
    assert run.regressions == []
    base = _baseline(must_catch_recall=0.96, verdict_accuracy=0.97, false_flags_on_compliant=2)
    run = _run(cases, reports, base)
    assert run.regressions == []  # improvements are not regressions
    assert run.deltas["false_flags_on_compliant"] == -2


def test_omissions_on_regulator_excerpts_are_neutral_not_false_flags():
    # A text case from an FDA letter is an excerpt, not the whole ad: the letter quotes
    # the offending lines, so "no risk info" can't be judged from it either way.
    c = case(findings=[gf("compounded_drug_misrepresentation")])
    r = report(findings=[
        pf("compounded_drug_misrepresentation"),
        pf("missing_risk_information"),
        pf("inadequate_disclosure_prominence"),
    ])
    s = score_case(c, r, None)
    assert s.false_flags == []
    run = aggregate([s], [c], [r], "m", None)
    assert run.precision == 1.0  # neutral predictions leave precision untouched


def test_omissions_still_count_as_false_flags_on_full_ads():
    c = case(findings=[], verdict="compliant", modality="video").model_copy(update={"source_type": "real_video"})
    r = report(verdict="compliant", findings=[pf("missing_risk_information", ts=(0.0, 30.0))], modality="video")
    assert len(score_case(c, r, None).false_flags) == 1
