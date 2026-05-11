import { ComponentProps, useCallback } from "react";

type NavigableInputProps = Omit<ComponentProps<"input">, "onSubmit" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  dropdownOpen: boolean;
  itemCount: number;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelectIndex: (index: number) => void;
  onSubmit: (value: string) => void;
  onClose: () => void;
};

export function NavigableInput({
  value,
  onChange,
  onFocus,
  dropdownOpen,
  itemCount,
  activeIndex,
  onActiveIndexChange,
  onSelectIndex,
  onSubmit,
  onClose,
  ...restProps
}: NavigableInputProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!dropdownOpen) {
        if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onActiveIndexChange(Math.min(activeIndex + 1, itemCount - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onActiveIndexChange(Math.max(activeIndex - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onClose();
        if (activeIndex >= 0) onSelectIndex(activeIndex);
        else if (value.trim()) onSubmit(value.trim());
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [dropdownOpen, value, activeIndex, itemCount, onSubmit, onActiveIndexChange, onSelectIndex, onClose],
  );

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      {...restProps}
    />
  );
}
