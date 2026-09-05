import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OutcomeDialog } from "./outcome-dialog";

const defaults = {
  open: true,
  onOpenChange: vi.fn(),
  onSubmit: vi.fn(),
  isPending: false,
  companyName: "Test Account",
  signals: [],
};

describe("outcome recording semantics", () => {
  it("clears the previous outcome when a successful save closes and reopens the dialog", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <OutcomeDialog {...defaults} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByRole("radio", { name: /Closed Won/ }));
    await user.type(screen.getByLabelText("Amount (Optional)"), "25000");
    await user.click(screen.getByTestId("btn-submit-outcome"));
    expect(onSubmit).toHaveBeenCalledWith(
      "won",
      undefined,
      25000,
      undefined,
      undefined,
    );
    rerender(<OutcomeDialog {...defaults} open={false} onSubmit={onSubmit} />);
    rerender(<OutcomeDialog {...defaults} onSubmit={onSubmit} />);
    expect(
      (screen.getByTestId("btn-submit-outcome") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Amount (Optional)") as HTMLInputElement).value,
    ).toBe("");
  });

  it("records the selected local event date without shifting it to the previous calendar day", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<OutcomeDialog {...defaults} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("radio", { name: /Contacted/ }));
    fireEvent.change(screen.getByLabelText("Date (Optional)"), {
      target: { value: "2026-09-01" },
    });
    await user.click(screen.getByTestId("btn-submit-outcome"));
    expect(onSubmit).toHaveBeenCalledWith(
      "contacted",
      undefined,
      undefined,
      new Date("2026-09-01T00:00:00").toISOString(),
      undefined,
    );
  });

  it("describes suppression feedback without claiming the hold is removed", async () => {
    const user = userEvent.setup();
    render(<OutcomeDialog {...defaults} />);
    await user.click(
      screen.getByRole("radio", { name: /Suppression Incorrect/ }),
    );
    expect(screen.getByText(/does not remove a safety hold/)).toBeTruthy();
    expect(screen.queryByText("Overrule safety hold")).toBeNull();
  });

  it("does not accept whitespace as a closed-lost reason", async () => {
    const user = userEvent.setup();
    render(<OutcomeDialog {...defaults} />);
    await user.click(screen.getByRole("radio", { name: /Closed Lost/ }));
    await user.type(screen.getByLabelText("Notes"), "   ");
    expect(
      (screen.getByTestId("btn-submit-outcome") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
