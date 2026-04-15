// A sophisticated debounce function to limit how often a function is called after activity ceases.
export const debounce = <F extends (...args: unknown[]) => unknown>(func: F, delay: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: ThisParameterType<F>, ...args: Parameters<F>): void {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
};
