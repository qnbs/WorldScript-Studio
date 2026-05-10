import type { FC, ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';

type ExecutorFn = (commandId: string) => boolean;

const CommandExecutorContext = createContext<ExecutorFn>(() => false);

export const CommandExecutorProvider: FC<{ execute: ExecutorFn; children: ReactNode }> = ({
  execute,
  children,
}) => {
  const stable = useCallback((id: string) => execute(id), [execute]);
  const value = useMemo(() => stable, [stable]);
  return (
    <CommandExecutorContext.Provider value={value}>{children}</CommandExecutorContext.Provider>
  );
};

export function useCommandExecutor(): ExecutorFn {
  return useContext(CommandExecutorContext);
}
