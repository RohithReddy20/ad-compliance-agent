# Rule base: telehealth drug advertising (FDA + FTC + platform policy)

The reviewer cites these rules. Each rule has an id, the finding categories it maps to,
the citation to put in `Finding.rule`, a plain-English test, and examples. Findings are
"flagged for human review", not legal conclusions. Quotes from 21 CFR 202.1 are verbatim.

Scope notes:
- FDCA 502(n) and 21 CFR 202.1 apply to **prescription** drug advertising. Telehealth ads for
  Rx drugs (GLP-1s, ED drugs, hair-loss drugs, NAD+ injections, etc.) are in scope even when the
  product is compounded.
- Compounded drugs (FDCA 503A/503B) are **not FDA-approved**. They are exempt from the approval
  requirement, not approved.
- FTC rules apply to every health claim in any ad, Rx or not.

---

## R-FDA-502a — False or misleading in any particular
- **Categories:** false_or_misleading_efficacy, compounded_drug_misrepresentation, unsubstantiated_comparative_claim
- **Citation:** FDCA 502(a) [21 U.S.C. 352(a)]
- **Test:** A drug is misbranded if its labeling (which, for telehealth sites and promotional
  materials that accompany the drug, FDA treats broadly) is "false or misleading in any
  particular". Ask: would a reasonable consumer take away a claim about what the drug is or does
  that the evidence doesn't support? Implied claims count (net impression), not just literal words.
- **Examples:** "Lose 20% of your body weight" with no qualifier about typical results or the
  studied population. "Our semaglutide works just like Wegovy."

## R-FDA-502bb — Compounded drug advertising that is false or misleading
- **Categories:** compounded_drug_misrepresentation, false_fda_approval_claim
- **Citation:** FDCA 502(bb) [21 U.S.C. 352(bb)]; FDCA 502(a) [21 U.S.C. 352(a)]
- **Test:** A compounded drug is misbranded "if the advertising or promotion of a compounded drug
  is false or misleading in any particular." FDA's 2025 telehealth warning letters apply this to
  claims that **imply the compounded product is the same as, equivalent to, or a generic of an
  FDA-approved drug**: "same active ingredient as Ozempic/Wegovy/Mounjaro/Zepbound", "generic
  semaglutide", "compounded Wegovy", brand-name imagery next to a compounded product, or "same
  [ingredient]" price comparisons. FDA's reasoning: "Compounded drug products are not
  FDA-approved. Your claims imply that your products are the same as an FDA-approved product when
  they are not." Applies equally to non-GLP-1 compounded products (e.g. compounded
  sildenafil/tadalafil "contains the active ingredient in Viagra", compounded NAD+ "same NAD+" as
  an IV drip).
- **Examples:** "Compounded semaglutide contains the same active ingredient as branded
  semaglutide." "Get generic Ozempic for $199/mo." "My formula includes sildenafil, the active
  ingredient in Viagra" (for a compounded combo product).

## R-FDA-APPROVAL — Representing an unapproved/compounded drug as FDA-approved
- **Categories:** false_fda_approval_claim
- **Citation:** FDCA 502(bb) and 502(a) [21 U.S.C. 352(bb), 352(a)]; FTC Act §5 [15 U.S.C. 45]
- **Test:** Flag any statement or visual that states or implies FDA approval of a product that is
  not FDA-approved (compounded drugs, unapproved supplements/peptides). Includes "FDA-approved
  ingredients", "FDA-approved semaglutide" for a compounded product, "made in an FDA-approved
  facility" used to imply product approval ("FDA-registered" pharmacies are not "FDA-approved"),
  and FDA logos. Do NOT flag an accurate statement that a compounded drug is NOT FDA-approved, or
  a true statement about an actually approved branded drug.
- **Examples:** "Our FDA-approved GLP-1 program" (selling compounded semaglutide). An FDA seal
  on a compounded tirzepatide vial.

## R-FDA-502n — Rx ad must include a true statement of side effects, contraindications and effectiveness
- **Categories:** missing_risk_information
- **Citation:** FDCA 502(n) [21 U.S.C. 352(n)]; 21 CFR 202.1(e)(1)
- **Test:** An advertisement for a prescription drug must present "a true statement of
  information in brief summary relating to side effects, contraindications ... and
  effectiveness" (21 CFR 202.1(e)(1)). A whole-ad omission is a finding: if the ad names or
  promotes a specific Rx drug/ingredient (semaglutide, tirzepatide, sildenafil, finasteride,
  NAD+ injections...) and makes benefit claims but gives **no risk information at all**, flag
  it. Reminder ads (name only, no claims about use or benefit) are exempt only when R-FDA-REMINDER
  allows it. For a short social/display unit, a prominent link to full safety information can be
  acceptable; total silence about risk alongside efficacy claims is not.
- **Examples:** A GLP-1 ad promising "Lose up to 20% body weight" with no mention of side effects
  (nausea, pancreatitis, thyroid C-cell tumor warning). An ED ad describing onset and duration
  of action with no risk information.

## R-FDA-REMINDER — "No benefit claim" is not a pass for boxed-warning drugs
- **Categories:** missing_risk_information (+ compounded_drug_misrepresentation when applicable)
- **Citation:** 21 CFR 202.1(e)(2)(i); FDCA 502(n) [21 U.S.C. 352(n)]; FDCA 502(bb) [21 U.S.C. 352(bb)]
- **Test:** The reminder-ad exemption (name + price, no claims) does NOT apply to a drug whose
  labeling carries a boxed warning. GLP-1 receptor agonists (semaglutide, tirzepatide, "GLP-1")
  carry a boxed warning for thyroid C-cell tumors, so any ad that names or shows a GLP-1, by
  ingredient name, "GLP-1", or vial/pen/product imagery, needs risk information even when it
  only states a price or offer. Price + urgency ("ACT NOW", "$5/day", "limited time") with
  product imagery is promotion, not a neutral reminder. Read text inside product photos (vial
  labels, sticky notes, packaging) as part of the ad. If the product is compounded (vial label or
  copy says compounded, or the advertiser is a telehealth compounding pharmacy) and the ad does not
  disclose that it is compounded / not FDA-approved, also consider compounded_drug_misrepresentation
  (pharmaceutical-looking imagery implies an approved product).
- **Examples:** Image ad of three tirzepatide vials with a note "ACT NOW · 1 month GLP-1 for
  $5/day" and no risk information → missing_risk_information (high). "Semaglutide from $99/mo"
  banner with no safety information → missing_risk_information.

## R-FDA-202.1e1-BROADCAST — TV/video "major statement" of risks
- **Categories:** missing_risk_information, inadequate_disclosure_prominence
- **Citation:** 21 CFR 202.1(e)(1)(i)-(ii); FDCA 502(n) [21 U.S.C. 352(n)]
- **Test:** Broadcast/video Rx ads must "Include information relating to the major side effects
  and contraindications ('major statement') of the advertised drugs in the audio or audio and
  visual parts of the presentation". For TV-format ads the major statement must be "clear,
  conspicuous, and neutral": consumer-friendly language; audio "at least as understandable as
  the audio information presented in the rest of the advertisement"; "presented concurrently
  using both audio and text (dual modality)"; text displayed long enough to be read, in a font
  size, contrast and placement that "allow the information to be read easily"; and no "audio or
  visual elements ... likely to interfere with comprehension of the major statement". In a video
  ad: if risks are never **spoken**, that is a missing major statement (missing_risk_information).
  If risks appear only as tiny, fast, low-contrast or crowded on-screen text, that is
  inadequate_disclosure_prominence.
- **Examples:** A 30 s ED-drug spot whose voiceover covers only benefits and delivery, with risk
  text (if any) only in a 2-second super at the bottom of the end card.

## R-FDA-202.1e5 — Fair balance / true statement
- **Categories:** missing_risk_information, false_or_misleading_efficacy
- **Citation:** 21 CFR 202.1(e)(5)(i)-(iii)
- **Test:** An ad fails the true-statement requirement if "(i) It is false or misleading with
  respect to side effects, contraindications, or effectiveness; or (ii) It fails to present a
  fair balance between information relating to side effects and contraindications and
  information relating to effectiveness of the drug ...; or (iii) It fails to reveal facts
  material in the light of its representations". Ask: are benefits presented in greater "scope,
  depth, or detail" than risks? Flag ads where efficacy claims dominate and risk content is a
  token phrase or absent.
- **Examples:** Five benefit bullets and a single "side effects may occur" line.

## R-FDA-202.1e6 — Specific practices that are false, lacking fair balance, or misleading
- **Categories:** false_or_misleading_efficacy, unsubstantiated_comparative_claim, off_label_promotion, missing_risk_information
- **Citation:** 21 CFR 202.1(e)(6) (cite the sub-paragraph: (e)(6)(i), (ii), (iv), (xviii)...)
- **Test:** An Rx ad is false/misleading if it, among other things:
  - (e)(6)(i) represents "that a drug is better, more effective, useful in a broader range of
    conditions or patients ..., safer, has fewer, or less incidence of, or less serious side
    effects or contraindications than has been demonstrated by substantial evidence or
    substantial clinical experience" — overstated efficacy, faster onset, longer duration, or
    broader use than labeling supports;
  - (e)(6)(ii) "Contains a drug comparison that represents or suggests that a drug is safer or
    more effective than another drug in some particular when it has not been demonstrated" —
    "works faster than pills", "better than Viagra", "same results as IV therapy";
  - (e)(6)(iv) represents "that a drug is safer than it has been demonstrated to be" — "safe",
    "no side effects", "gentle", "natural" for an Rx drug (minimised risk);
  - (e)(6)(xviii) "Uses headline, subheadline, or pictorial or other graphic matter in a way
    that is misleading."
- **Examples:** "Dissolves under your tongue, that's for speed" (implied faster onset vs pills,
  not shown for the compounded product). "Clinically proven to work in 15 minutes."

## R-FDA-202.1e7 — Practices that may be misleading (emphasis, readability, mechanism)
- **Categories:** inadequate_disclosure_prominence, false_or_misleading_efficacy
- **Citation:** 21 CFR 202.1(e)(7) (e.g. (e)(7)(vi), (vii), (viii))
- **Test:** An ad may be misleading if it "(vi) Contains claims concerning the mechanism or site of
  drug action that are not generally regarded as established"; "(vii) Fails to provide
  sufficient emphasis for the information relating to side effects and contraindications ...
  because of repetition or other emphasis ... of claims for effectiveness"; or "(viii) Fails to
  present information relating to side effects and contraindications with a prominence and
  readability reasonably comparable with the presentation of information relating to
  effectiveness of the drug, taking into account all implementing factors such as typography,
  layout, contrast, headlines, paragraphing, white space". Use this for distracting or
  de-emphasised risk presentation (tiny grey fine print under a giant headline).
- **Examples:** Bold 60-pt "LOSE THE WEIGHT" vs 6-pt grey safety text; risk scroll that runs
  while upbeat music and visuals compete for attention.

## R-FDA-OFFLABEL — Unapproved / off-label uses
- **Categories:** off_label_promotion
- **Citation:** 21 CFR 202.1(e)(4)(i)(a); 21 CFR 202.1(e)(6)(i); FDCA 502(a) [21 U.S.C. 352(a)]
- **Test:** An Rx ad "shall not recommend or suggest any use that is not in the labeling" (21 CFR
  202.1(e)(4)(i)(a)). Flag promotion of a drug for a use outside its approved indication
  (semaglutide for "anti-aging", "longevity", "inflammation"; Rx drug for cosmetic weight loss
  in people without obesity/overweight-with-comorbidity; NAD+ for "brain fog" or "reverse
  aging"), or suggesting use in a broader population than labeled.
- **Examples:** "Microdose GLP-1s for longevity and focus." "Metformin: the anti-aging pill."

## R-FTC-SUBSTANTIATION — Health claims need competent and reliable scientific evidence
- **Categories:** false_or_misleading_efficacy, unsubstantiated_comparative_claim
- **Citation:** FTC Act §§5, 12 [15 U.S.C. 45, 52]; FTC Health Products Compliance Guidance (Dec. 2022)
- **Test:** Any objective health-benefit claim, express or implied, must be substantiated at the
  time it is made by "competent and reliable scientific evidence" — generally well-controlled
  human clinical testing of the product (or an essentially equivalent one) that supports the
  specific claim, its magnitude and its timeframe. Flag specific numbers ("lose 30 lbs"),
  timeframes ("from your very first dose", "in 2 weeks"), mechanism claims, and comparative
  superiority/equivalence claims ("same as IV drips", "better than the brand") that the ad does
  not and likely cannot substantiate. Puffery that is not measurable ("feel your best") is
  lower severity; specific measurable promises are high.
- **Examples:** "NAD+, Look & Feel Younger — starting with your very first dose." "IV drips are
  $500. This is $99. Same NAD+." (equivalence of an injection to IV therapy).

## R-FTC-ENDORSE — Testimonials and endorsements
- **Categories:** misleading_testimonial_or_results
- **Citation:** FTC Endorsement Guides, 16 CFR Part 255 (255.2(b) typical results; 255.5 material connections); FTC Act §5 [15 U.S.C. 45]
- **Test:** A consumer testimonial about a key attribute (pounds lost, speed of results) will be
  read as representing typical results; unless the advertiser can substantiate that, it must
  clearly and conspicuously disclose what consumers generally achieve. "Results may vary" /
  "results not typical" alone is not adequate. Paid celebrity/influencer endorsers, employees,
  or people given free product must have the material connection disclosed unless obvious.
  Endorsers can't make claims the advertiser couldn't substantiate.
- **Examples:** "I lost 45 lbs in 3 months!" with only "Individual results vary." An influencer
  post about a GLP-1 program with no #ad disclosure.

## R-FTC-CLEAR — Clear-and-conspicuous disclosures
- **Categories:** inadequate_disclosure_prominence
- **Citation:** FTC Act §5 [15 U.S.C. 45]; 16 CFR 255.0(f) ("clearly and conspicuously"); FTC ".com Disclosures" guidance (2013)
- **Test:** A disclosure needed to prevent deception must be difficult to miss and easily
  understandable: in the same means as the claim it qualifies (a spoken claim needs a spoken
  disclosure in video), close to the claim, prominent in size/contrast, on screen long enough to
  read, not buried in a footer, behind a link, or contradicted by the main message. Flag key
  qualifiers (compounded/not FDA-approved, prescription required/eligibility, results vary,
  risks) that appear only as tiny, fast, low-contrast, or distant fine print.
- **Examples:** "Compounded drugs are not FDA-approved" in small grey text on the end card for
  2 seconds of a video whose voiceover claims "the active ingredient in Viagra".

## R-FTC-NATIVE — Deceptively formatted advertising
- **Categories:** misleading_testimonial_or_results, inadequate_disclosure_prominence
- **Citation:** FTC Enforcement Policy Statement on Deceptively Formatted Advertisements (Dec. 2015); FTC Act §5 [15 U.S.C. 45]
- **Test:** An ad must not mislead consumers about its commercial nature. Advertorials, fake news
  articles, "doctor's review" pages, or organic-looking user posts that are actually paid ads
  need a clear "Ad"/"Sponsored" disclosure up front.
- **Examples:** A "Health News: Doctors stunned by new weight loss shot" page that is a telehealth
  ad with no sponsorship label.

## R-PLATFORM-HEALTH — Meta / Google health ad policies
- **Categories:** misleading_testimonial_or_results, false_or_misleading_efficacy
- **Citation:** Meta Advertising Standards (Personal Health and Appearance; Prescription Drugs); Google Ads Healthcare and medicines policy; Google Ads Misrepresentation policy (unreliable claims)
- **Test:** Platform policies (not law, but they get ads rejected) prohibit: before-and-after
  images and images showing unlikely results for weight loss/health; guaranteed results or
  timeframes ("guaranteed to lose 20 lbs", "results in 7 days"); content implying negative
  self-perception to sell weight loss; and promoting prescription drugs without platform
  certification. Prescription-drug ads must make clear a prescription/clinician evaluation is
  required.
- **Examples:** Split-screen "Before / After 90 days" photo in a GLP-1 ad. "Guaranteed results or
  your money back — lose 15 lbs in 30 days."

---

## Compliant patterns — do NOT flag these by themselves
- Accurate disclaimers: "Compounded drugs are not FDA-approved", "not reviewed by FDA for
  safety, effectiveness, or quality", "Prescription required", "if eligible", "if prescribed",
  "requires an online consultation with a licensed provider".
- A proper Important Safety Information (ISI) section or a spoken major statement of risks.
- Brand names, URLs, prices, shipping/discreet-packaging/logistics claims, company names. (A price
  is not a violation by itself, but a priced promotion of a named/pictured Rx drug still needs risk
  information unless R-FDA-REMINDER exempts it; for GLP-1s it never does.)
- True statements about an FDA-approved branded drug made in its own labeled indication, with
  fair balance.
- Pure puffery with no health claim ("Healthcare, made easy").
A disclaimer can still be a finding when it is NOT prominent enough (R-FTC-CLEAR) — flag the
prominence problem, not the existence of the disclaimer.
