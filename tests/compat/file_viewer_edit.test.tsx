// @vitest-environment jsdom
// Editing contract for the shared file viewer (operator ask 2026-08-19):
// fs-sourced text edits in place and saves through the caller's hub write;
// a refusal renders verbatim WITH the draft preserved; attachments and
// clamped oversize previews never offer an editor.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileViewer, type FileView } from "../../src/ui/team_file_viewer";

const fs_view: FileView = {
  name: "notes/plan.md",
  mode: "md",
  text: "# plan v3",
  meta: "laurent · now · v3",
  version: 3,
  editable: true,
};

describe("file viewer editing", () => {
  it("edits an fs file and saves the draft through the hub write", async () => {
    const on_save = vi.fn(async () => {});
    render(<FileViewer view={fs_view} onClose={() => {}} onSave={on_save} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit notes/plan.md");
    fireEvent.change(box, { target: { value: "# plan v4 — merged" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Edit" }); // back to read mode
    expect(on_save).toHaveBeenCalledWith("# plan v4 — merged");
  });

  it("renders the hub's refusal verbatim and keeps the draft", async () => {
    const on_save = vi.fn(async () => {
      throw new Error("hub_fs_put failed: version conflict: expected 3, stored 5");
    });
    render(<FileViewer view={fs_view} onClose={() => {}} onSave={on_save} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit notes/plan.md"), { target: { value: "# careful merge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/version conflict: expected 3, stored 5/);
    expect((screen.getByLabelText("Edit notes/plan.md") as HTMLTextAreaElement).value).toBe("# careful merge");
  });

  it("offers no editor for attachments or clamped previews", () => {
    const attachment: FileView = { name: "report.md", mode: "md", text: "# report", editable: false };
    const { rerender } = render(<FileViewer view={attachment} onClose={() => {}} onSave={async () => {}} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    rerender(<FileViewer view={{ ...fs_view, editable: false }} onClose={() => {}} onSave={async () => {}} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
