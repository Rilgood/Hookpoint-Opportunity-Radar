import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ComparableAccountsPanel,
  WhatWouldChangePanel,
} from "./company-insights";
import type { CompanyInsightsComparableAccounts } from "@workspace/api-client-react";

const empty: CompanyInsightsComparableAccounts = {
  matched_on: [],
  labeled: 0,
  qualified: 0,
  negative: 0,
  qualified_rate: 0,
  wilson_95_lower: 0,
  wilson_95_upper: 0,
  median_days_signal_to_qualified: null,
  sufficient_sample: false,
  tenant_base_rate: { labeled: 0, qualified_rate: 0 },
  note: "No labeled accounts.",
};

describe("comparable account evidence", () => {
  it("does not display zero rates or a zero-width interval when there are no labeled peers", () => {
    render(<ComparableAccountsPanel comparable={empty} />);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText("qualified (vs — base)")).toBeTruthy();
    expect(
      screen.getByText("95% Range: Unavailable without labeled peers"),
    ).toBeTruthy();
  });
  it("distinguishes an observed zero conversion rate from an unavailable baseline", () => {
    render(
      <ComparableAccountsPanel
        comparable={{ ...empty, labeled: 4, negative: 4, wilson_95_upper: 49 }}
      />,
    );
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("qualified (vs — base)")).toBeTruthy();
    expect(screen.getByText("95% Range: 0% - 49%")).toBeTruthy();
  });
  it("describes a small modeled score change without claiming significance", () => {
    render(
      <WhatWouldChangePanel
        suggestions={[
          {
            action: "Verify location",
            dimension: "fit",
            expected_effect: { score_delta: 0.6, projected_tier: "warm" },
          },
        ]}
      />,
    );
    expect(screen.getByText("+0.6 pts")).toBeTruthy();
    expect(screen.queryByText(/significantly/)).toBeNull();
  });
});
