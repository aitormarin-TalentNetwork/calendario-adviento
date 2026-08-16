"use client";

export function ConfirmSubmitButton({
  label,
  confirmText,
}: {
  label: string;
  confirmText: string;
}) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        if (!confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
