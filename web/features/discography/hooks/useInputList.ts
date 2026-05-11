import { useCallback, useState } from "react";

export function useInputList() {
  const [activeIndex, setActiveIndex] = useState(-1);
  const resetActiveIndex = useCallback(() => setActiveIndex(-1), []);
  return { activeIndex, setActiveIndex, resetActiveIndex };
}
